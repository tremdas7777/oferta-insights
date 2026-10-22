import { createFileRoute } from "@tanstack/react-router";
import {
  createSagacePaySale,
  notifySaleEvent,
  toPublicApiError,
  webhookUrl,
  type CreateSaleInput,
} from "@/lib/sagacepay.server";
import { recordOrder } from "@/lib/admin-data.server";
import { sendUtmfyOrder } from "@/lib/utmfy.server";
import {
  checkPublicRateLimit,
  getClientKey,
  rateLimitResponse,
  reserveIdempotencyKey,
} from "@/lib/public-rate-limit.server";

const MAX_TEXT_LENGTH = 160;
const MAX_BODY_BYTES = 16_000;
const DOCUMENT_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidCpf(document: string): boolean {
  if (!DOCUMENT_PATTERN.test(document) || /^(\d)\1{10}$/.test(document)) return false;
  let first = 0;
  let second = 0;
  for (let index = 0; index < 9; index += 1) first += Number(document[index]) * (10 - index);
  let firstCheck = (first * 10) % 11;
  if (firstCheck === 10) firstCheck = 0;
  if (firstCheck !== Number(document[9])) return false;
  for (let index = 0; index < 10; index += 1) second += Number(document[index]) * (11 - index);
  let secondCheck = (second * 10) % 11;
  if (secondCheck === 10) secondCheck = 0;
  return secondCheck === Number(document[10]);
}

function optionalText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function getForwardedIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || undefined;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/sagacepay/sales")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const limit = checkPublicRateLimit(`sale:${getClientKey(request)}`, {
            limit: 5,
            windowMs: 10 * 60_000,
          });
          if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
          const contentLength = Number(request.headers.get("content-length") ?? 0);
          if (contentLength > MAX_BODY_BYTES) return jsonError("Solicitação muito grande.", 413);
          const input = (await request.json()) as Record<string, unknown>;
          const customer = (input["customer"] ?? {}) as Record<string, unknown>;
          const document =
            typeof customer["document"] === "string" ? customer["document"].replace(/\D/g, "") : "";
          const idempotencyKey = optionalText(input["idempotencyKey"], 120);
          const externalId = optionalText(input["externalId"], 120);

          if (!isValidCpf(document)) {
            return jsonError("Informe um CPF válido para gerar o PIX.", 400);
          }
          if (!idempotencyKey || !externalId) {
            return jsonError(
              "Não foi possível identificar o pedido. Recarregue a página e tente novamente.",
              400,
            );
          }
          const email = optionalText(customer["email"], 240);
          const name = optionalText(customer["name"]);
          const phone = optionalText(customer["phone"], 40);
          if (!name || name.length < 3) {
            return jsonError("Informe seu nome completo.", 400);
          }
          if (!email || !EMAIL_PATTERN.test(email)) {
            return jsonError("Informe um e-mail válido.", 400);
          }
          const phoneDigits = phone?.replace(/\D/g, "") ?? "";
          if (!phone || (phoneDigits.length !== 10 && phoneDigits.length !== 11)) {
            return jsonError("Informe um telefone válido com DDD.", 400);
          }
          if (!reserveIdempotencyKey(idempotencyKey)) {
            return jsonError("Esta cobrança já foi processada. Aguarde o resultado do PIX.", 409);
          }

          const trackingInput = (input["tracking"] ?? {}) as Record<string, unknown>;
          const tracking: Record<string, string> = {};
          for (const key of [
            "utmSource",
            "utmMedium",
            "utmCampaign",
            "utmContent",
            "utmTerm",
            "src",
            "sck",
            "xcod",
            "fbclid",
            "ttclid",
            "gclid",
            "fbp",
            "fbc",
            "eventId",
          ]) {
            const value = optionalText(trackingInput[key], 500);
            if (value) tracking[key] = value;
          }

          const userAgent = optionalText(request.headers.get("user-agent"), 500);
          const clientIpAddress = getForwardedIp(request);
          if (userAgent) tracking["clientUserAgent"] = userAgent;
          if (clientIpAddress) tracking["clientIpAddress"] = clientIpAddress;
          const postbackUrl = webhookUrl(request);

          const saleInput: CreateSaleInput = {
            customer: {
              document,
              name,
              email,
              phone: phoneDigits,
            },
            externalId,
            idempotencyKey,
            ...(Object.keys(tracking).length > 0 ? { tracking } : {}),
            postbackUrl,
          };

          const sale = await createSagacePaySale(saleInput);
          if (typeof sale.id === "string") {
            const createdAt = new Date().toISOString();
            const amount = typeof sale.amount === "number" ? sale.amount : 137;
            const status = typeof sale.status === "string" ? sale.status : "pending";
            try {
              await recordOrder({
                saleId: sale.id,
                externalId,
                status,
                amount,
                customer: saleInput.customer,
                rawData: { ...sale, utmfyCreatedAt: createdAt },
                tracking,
              });
            } catch (storageError) {
              console.warn("[SagacePay] unable to persist order", storageError);
            }
            await notifySaleEvent({
              event: "sale.pending",
              saleId: sale.id,
              externalId,
              status: "pending",
              amount,
              customer: saleInput.customer,
            });
            await sendUtmfyOrder({
              orderId: sale.id,
              status: "waiting_payment",
              amount,
              customer: saleInput.customer,
              tracking,
              createdAt,
            });
          }
          return Response.json({
            id: sale.id,
            status: sale.status,
            amount: sale.amount,
            pixCode: sale.pixCode,
            pixQrCode: sale.pixQrCode,
          });
        } catch (error) {
          console.error("[SagacePay] create sale failed", error);
          const publicError = toPublicApiError(error);
          return jsonError(publicError.message, publicError.status);
        }
      },
    },
  },
});
