import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import { listOrders } from "@/lib/admin-data.server";

export const Route = createFileRoute("/api/admin/orders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAdminRequest(request)))
          return Response.json({ error: "Não autorizado." }, { status: 401 });
        const url = new URL(request.url);
        try {
          const orders = await listOrders({
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            status: url.searchParams.get("status") ?? "all",
            limit: 500,
          });
          return Response.json({ orders });
        } catch (error) {
          console.error("[Admin] unable to load orders", error);
          return Response.json(
            {
              error:
                "Aplique a migration do painel e configure o Supabase Service Role no servidor.",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
