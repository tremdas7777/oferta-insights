import { createFileRoute } from "@tanstack/react-router";
import { getSagacePayPublicConfig } from "@/lib/sagacepay.server";

export const Route = createFileRoute("/api/sagacepay/config")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const config = await getSagacePayPublicConfig();
          return Response.json(config, {
            headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
          });
        } catch (error) {
          console.error("[SagacePay] unable to load public config", error);
          return Response.json(
            { amount: 137, productName: "Ebook Amoroso" },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
