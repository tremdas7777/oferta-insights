import { createFileRoute } from "@tanstack/react-router";
import { getSagacePaySale, toPublicApiError } from "@/lib/sagacepay.server";

export const Route = createFileRoute("/api/sagacepay/sales/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          if (!params.id || params.id.length > 120) {
            return Response.json({ error: "Cobrança inválida." }, { status: 400 });
          }

          const sale = await getSagacePaySale(params.id);
          return Response.json({
            id: sale.id,
            status: sale.status,
            amount: sale.amount,
            pixCode: sale.pixCode,
            pixQrCode: sale.pixQrCode,
          });
        } catch (error) {
          console.error("[SagacePay] get sale failed", error);
          const publicError = toPublicApiError(error);
          return Response.json({ error: publicError.message }, { status: publicError.status });
        }
      },
    },
  },
});
