import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import {
  createSagacePaySale,
  notifySaleEvent,
  toPublicApiError,
  webhookUrl,
} from "@/lib/sagacepay.server";
import { recordOrder } from "@/lib/admin-data.server";

const TEST_CPF = "52998224725";

function unauthorized() {
  return Response.json({ error: "Não autorizado." }, { status: 401 });
}

export const Route = createFileRoute("/api/admin/test-order")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAdminRequest(request))) return unauthorized();

        const now = Date.now();
        const customer = {
          name: "Cliente de Teste",
          document: TEST_CPF,
          email: "teste@exemplo.com",
          phone: "11999999999",
        };

        try {
          const sale = await createSagacePaySale({
            customer,
            externalId: `wpp-test-${now}`,
            idempotencyKey: `admin-test-${now}`,
            postbackUrl: webhookUrl(request),
            tracking: { utmSource: "admin", utmMedium: "test", utmCampaign: "admin_test_order" },
          });
          const saleId = typeof sale.id === "string" ? sale.id : `teste-${now}`;
          const externalId = `wpp-test-${now}`;
          const amount = typeof sale.amount === "number" ? sale.amount : 137;
          const status = typeof sale.status === "string" ? sale.status : "pending";
          await recordOrder({
            saleId,
            externalId,
            status,
            amount,
            customer,
            rawData: { ...sale, test: true, source: "admin_test_order" },
            tracking: { utmSource: "admin", utmMedium: "test", utmCampaign: "admin_test_order" },
          });
          const notified = await notifySaleEvent({
            event: "sale.test",
            saleId,
            externalId,
            status: "pending",
            amount,
            customer,
          });

          return Response.json({
            ok: true,
            id: saleId,
            status,
            amount,
            notified,
            gateway: true,
          });
        } catch (error) {
          console.error("[Admin] test order failed", error);
          const publicError = toPublicApiError(error);
          return Response.json(
            { error: `Teste da UmbrellaPag falhou: ${publicError.message}` },
            { status: publicError.status },
          );
        }
      },
    },
  },
});
