import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import { listOrders } from "@/lib/admin-data.server";

function dayKey(value: string): string {
  return value.slice(0, 10);
}

export const Route = createFileRoute("/api/admin/analytics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAdminRequest(request)))
          return Response.json({ error: "Não autorizado." }, { status: 401 });
        const url = new URL(request.url);
        const now = new Date();
        const from =
          url.searchParams.get("from") ?? new Date(now.getTime() - 29 * 86400000).toISOString();
        const to = url.searchParams.get("to") ?? now.toISOString();
        let orders;
        try {
          orders = await listOrders({ from, to, status: "all", limit: 5000 });
        } catch (error) {
          console.error("[Admin] unable to load analytics", error);
          return Response.json(
            {
              error:
                "Aplique a migration do painel e configure o Supabase Service Role no servidor.",
            },
            { status: 503 },
          );
        }
        const paid = orders.filter((order: any) => order.status === "paid");
        const terminal = orders.filter((order: any) =>
          ["paid", "failed", "expired", "refunded"].includes(order.status),
        );
        const gross = paid.reduce((sum: number, order: any) => sum + Number(order.amount || 0), 0);
        const byDay = new Map<string, { orders: number; paid: number; revenue: number }>();
        for (const order of orders as any[]) {
          const key = dayKey(order.created_at);
          const current = byDay.get(key) ?? { orders: 0, paid: 0, revenue: 0 };
          current.orders += 1;
          if (order.status === "paid") {
            current.paid += 1;
            current.revenue += Number(order.amount || 0);
          }
          byDay.set(key, current);
        }
        return Response.json({
          from,
          to,
          metrics: {
            totalOrders: orders.length,
            paidOrders: paid.length,
            pendingOrders: orders.filter((order: any) => order.status === "pending").length,
            failedOrders: orders.filter((order: any) =>
              ["failed", "expired"].includes(order.status),
            ).length,
            refundedOrders: orders.filter((order: any) => order.status === "refunded").length,
            grossRevenue: gross,
            averageTicket: paid.length ? gross / paid.length : 0,
            approvalRate: terminal.length ? (paid.length / terminal.length) * 100 : 0,
          },
          byDay: Array.from(byDay.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, values]) => ({ date, ...values })),
        });
      },
    },
  },
});
