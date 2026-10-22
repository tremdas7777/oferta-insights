import { createFileRoute } from "@tanstack/react-router";
import { readOrder, recordOrder, updateOrderTotal } from "@/lib/admin-data.server";
import { sendUtmfyOrder } from "@/lib/utmfy.server";
import { getUmbrellaTransaction, isUmbrellaPaid } from "@/lib/umbrella.server";
import { notifySaleEvent } from "@/lib/sagacepay.server";

function sourceSaleIdFromExternalId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("wpp-upsell-")) return null;
  const encoded = value.slice("wpp-upsell-".length).split("-")[0];
  try {
    return encoded ? atob(encoded) : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/umbrella-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const nestedId =
          body?.data && typeof body.data === "object"
            ? (body.data as Record<string, unknown>).id
            : undefined;
        const id = String(body?.objectId ?? nestedId ?? body?.id ?? "");
        if (!/^[\w-]{1,128}$/.test(id)) return Response.json({ ok: true });
        try {
          const transaction = await getUmbrellaTransaction(id);
          if (!transaction || !isUmbrellaPaid(transaction.status))
            return Response.json({ ok: true });
          const metadata = transaction.metadata ?? {};
          const externalId = metadata.externalId;
          const sourceSaleId = sourceSaleIdFromExternalId(externalId);
          const amount = transaction.amount / 100;
          if (sourceSaleId) {
            const sourceOrder = await readOrder(sourceSaleId);
            if (!sourceOrder || sourceOrder.status !== "paid") return Response.json({ ok: true });
            const sourceRawData =
              sourceOrder.raw_data &&
              typeof sourceOrder.raw_data === "object" &&
              !Array.isArray(sourceOrder.raw_data)
                ? (sourceOrder.raw_data as Record<string, unknown>)
                : {};
            if (sourceRawData.upsellApplied === true) return Response.json({ ok: true });
            const totalAmount = Number(sourceOrder.amount ?? 0) + amount;
            await updateOrderTotal(sourceSaleId, totalAmount, {
              ...sourceRawData,
              upsellApplied: true,
              upsellAmount: amount,
              upsellSaleId: id,
              upsellPaidAt: new Date().toISOString(),
            });
            await sendUtmfyOrder({
              orderId: sourceSaleId,
              status: "paid",
              amount: totalAmount,
              customer: {
                name: sourceOrder.customer_name ?? undefined,
                email: sourceOrder.customer_email ?? undefined,
                document: sourceOrder.customer_document ?? undefined,
                phone: sourceOrder.customer_phone ?? undefined,
              },
              tracking: sourceRawData.tracking as Record<string, string> | undefined,
              createdAt: String(sourceRawData.utmfyCreatedAt ?? sourceOrder.created_at),
              approvedDate: sourceOrder.paid_at ?? new Date().toISOString(),
            });
            return Response.json({ ok: true });
          }
          const order = await readOrder(id);
          if (!order || order.status === "paid") return Response.json({ ok: true });
          const customer = {
            name: order.customer_name ?? undefined,
            email: order.customer_email ?? undefined,
            document: order.customer_document ?? undefined,
            phone: order.customer_phone ?? undefined,
          };
          await recordOrder({
            saleId: id,
            externalId:
              typeof externalId === "string" ? externalId : (order.external_id ?? undefined),
            status: "paid",
            amount,
            customer,
            paidAt: new Date().toISOString(),
            rawData: { ...metadata, umbrellaTransaction: transaction },
          });
          const rawData =
            order.raw_data && typeof order.raw_data === "object" && !Array.isArray(order.raw_data)
              ? (order.raw_data as Record<string, unknown>)
              : {};
          await sendUtmfyOrder({
            orderId: id,
            status: "paid",
            amount,
            customer,
            tracking: rawData.tracking as Record<string, string> | undefined,
            createdAt: String(rawData.utmfyCreatedAt ?? order.created_at),
            approvedDate: new Date().toISOString(),
          });
          await notifySaleEvent({
            event: "sale.paid",
            saleId: id,
            externalId:
              typeof externalId === "string" ? externalId : (order.external_id ?? undefined),
            status: "paid",
            amount,
            customer,
          });
        } catch (error) {
          console.error("[Umbrella] webhook failed", error);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
