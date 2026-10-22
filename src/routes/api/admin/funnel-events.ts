import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import { listFunnelEvents } from "@/lib/admin-data.server";

export const Route = createFileRoute("/api/admin/funnel-events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAdminRequest(request)))
          return Response.json({ error: "Não autorizado." }, { status: 401 });
        try {
          const events = await listFunnelEvents(150);
          return Response.json({ events });
        } catch (error) {
          console.error("[Admin] unable to load funnel events", error);
          return Response.json(
            { error: "Aplique a migration de eventos do funil no banco conectado." },
            { status: 503 },
          );
        }
      },
    },
  },
});
