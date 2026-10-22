import { createFileRoute } from "@tanstack/react-router";
import { getWebhookSecret, notifySaleEvent } from "@/lib/sagacepay.server";
import { readOrder, recordOrder } from "@/lib/admin-data.server";
import { sendUtmfyOrder, statusFromGateway } from "@/lib/utmfy.server";

const REPLAY_WINDOW_SECONDS = 300;

type WebhookPayload = {
  event?: unknown;
  data?: {
    id?: unknown;
    status?: unknown;
    externalId?: unknown;
    amount?: unknown;
    customer?: {
      name?: unknown;
      email?: unknown;
      document?: unknown;
      phone?: unknown;
    };
  };
};

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const Route = createFileRoute("/api/sagacepay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = await getWebhookSecret();
        if (!secret) {
          console.error("[SagacePay] webhook secret is not configured");
          return Response.json({ error: "Webhook não configurado." }, { status: 503 });
        }

        const timestamp = request.headers.get("x-sagacepay-timestamp");
        const signature = request.headers.get("x-sagacepay-signature");
        const rawBody = await request.text();
        const timestampSeconds = Number(timestamp);
        const age = Math.floor(Date.now() / 1000) - timestampSeconds;

        if (
          !timestamp ||
          !signature ||
          !Number.isFinite(timestampSeconds) ||
          Math.abs(age) > REPLAY_WINDOW_SECONDS
        ) {
          return Response.json({ error: "Assinatura expirada ou ausente." }, { status: 401 });
        }

        const expectedSignature = await hmacSha256(secret, `${timestamp}.${rawBody}`);
        if (!constantTimeEqual(signature, expectedSignature)) {
          return Response.json({ error: "Assinatura inválida." }, { status: 401 });
        }

        let payload: WebhookPayload;
        try {
          payload = JSON.parse(rawBody) as WebhookPayload;
        } catch {
          return Response.json({ error: "Payload JSON inválido." }, { status: 400 });
        }

        const event = typeof payload.event === "string" ? payload.event : "unknown";
        const saleId = typeof payload.data?.id === "string" ? payload.data.id : "unknown";
        console.info(`[SagacePay] webhook received event=${event} sale=${saleId}`);

        if (saleId !== "unknown" && payload.data) {
          const status =
            typeof payload.data.status === "string"
              ? payload.data.status
              : event.replace("sale.", "");
          const amount = typeof payload.data.amount === "number" ? payload.data.amount : 137;
          let previousOrder: { raw_data?: unknown; created_at?: string } | null = null;
          try {
            previousOrder = await readOrder(saleId);
          } catch (readError) {
            console.warn("[SagacePay] unable to read original order metadata", readError);
          }
          const previousRawData =
            previousOrder?.raw_data &&
            typeof previousOrder.raw_data === "object" &&
            !Array.isArray(previousOrder.raw_data)
              ? (previousOrder.raw_data as Record<string, unknown>)
              : {};
          const createdAt =
            typeof previousRawData.utmfyCreatedAt === "string"
              ? previousRawData.utmfyCreatedAt
              : typeof previousOrder?.created_at === "string"
                ? previousOrder.created_at
                : new Date().toISOString();
          const customer = payload.data.customer;
          const customerDetails = customer
            ? {
                ...(typeof customer.name === "string" ? { name: customer.name } : {}),
                ...(typeof customer.email === "string" ? { email: customer.email } : {}),
                ...(typeof customer.document === "string" ? { document: customer.document } : {}),
                ...(typeof customer.phone === "string" ? { phone: customer.phone } : {}),
              }
            : undefined;
          const tracking =
            previousRawData.tracking &&
            typeof previousRawData.tracking === "object" &&
            !Array.isArray(previousRawData.tracking)
              ? (previousRawData.tracking as Record<string, string>)
              : undefined;
          try {
            await recordOrder({
              saleId,
              externalId:
                typeof payload.data.externalId === "string" ? payload.data.externalId : undefined,
              status,
              amount,
              paidAt: event === "sale.paid" ? new Date().toISOString() : undefined,
              rawData: payload,
            });
          } catch (storageError) {
            console.error("[SagacePay] unable to persist webhook order", storageError);
            return Response.json(
              { error: "Não foi possível registrar o webhook." },
              { status: 500 },
            );
          }
          await sendUtmfyOrder({
            orderId: saleId,
            status: statusFromGateway(status),
            amount,
            customer: customerDetails,
            tracking,
            createdAt,
            approvedDate:
              event === "sale.paid" || status === "paid" ? new Date().toISOString() : null,
          });
          if (event === "sale.paid" || status === "paid") {
            const paidExternalId =
              typeof payload.data.externalId === "string" ? payload.data.externalId : undefined;
            await notifySaleEvent({
              event: "sale.paid",
              saleId,
              status: "paid",
              amount,
              ...(customerDetails ? { customer: customerDetails } : {}),
              ...(paidExternalId ? { externalId: paidExternalId } : {}),
            });
          }
        }

        return Response.json({ received: true });
      },
    },
  },
});
