import { createFileRoute } from "@tanstack/react-router";
import {
  createSagacePaySale,
  getPostbackUrl,
  toPublicApiError,
  type CreateSaleInput,
} from "@/lib/sagacepay.server";
import { recordOrder } from "@/lib/admin-data.server";

const MAX_TEXT_LENGTH = 160;
const DOCUMENT_PATTERN = /^(?:\d{11}|\d{14})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
          const input = (await request.json()) as Record<string, unknown>;
          const customer = (input["customer"] ?? {}) as Record<string, unknown>;
          const document =
            typeof customer["document"] === "string" ? customer["document"].replace(/\D/g, "") : "";
          const idempotencyKey = optionalText(input["idempotencyKey"], 120);
          const externalId = optionalText(input["externalId"], 120);

          if (!document || !DOCUMENT_PATTERN.test(document)) {
            return jsonError("Informe um CPF ou CNPJ válido para gerar o PIX.", 400);
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
          if (email && !EMAIL_PATTERN.test(email)) {
            return jsonError("Informe um e-mail válido.", 400);
          }

          const trackingInput = (input["tracking"] ?? {}) as Record<string, unknown>;
          const tracking: Record<string, string> = {};
          for (const key of [
            "utmSource",
            "utmMedium",
            "utmCampaign",
            "utmContent",
            "utmTerm",
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
          const postbackUrl = await getPostbackUrl();

          const saleInput: CreateSaleInput = {
            customer: {
              document,
              ...(name ? { name } : {}),
              ...(email ? { email } : {}),
              ...(phone ? { phone } : {}),
            },
            externalId,
            idempotencyKey,
            ...(Object.keys(tracking).length > 0 ? { tracking } : {}),
            ...(postbackUrl ? { postbackUrl } : {}),
          };

          const sale = await createSagacePaySale(saleInput);
          if (typeof sale.id === "string") {
            try {
              await recordOrder({
                saleId: sale.id,
                externalId,
                status: typeof sale.status === "string" ? sale.status : "pending",
                amount: typeof sale.amount === "number" ? sale.amount : 137,
                customer: saleInput.customer,
                rawData: sale,
              });
            } catch (storageError) {
              console.warn("[SagacePay] unable to persist order", storageError);
            }
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
