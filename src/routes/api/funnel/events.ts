import { createFileRoute } from "@tanstack/react-router";
import { recordFunnelEvent } from "@/lib/admin-data.server";

const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{1,48}$/;

export const Route = createFileRoute("/api/funnel/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const sessionId = typeof body["sessionId"] === "string" ? body["sessionId"].trim() : "";
          const eventName = typeof body["eventName"] === "string" ? body["eventName"].trim() : "";
          if (!sessionId || sessionId.length > 100 || !EVENT_PATTERN.test(eventName)) {
            return Response.json({ error: "Evento inválido." }, { status: 400 });
          }
          const metadata =
            body["metadata"] && typeof body["metadata"] === "object"
              ? Object.fromEntries(Object.entries(body["metadata"]).slice(0, 12))
              : {};
          await recordFunnelEvent({
            sessionId,
            eventName,
            path: typeof body["path"] === "string" ? body["path"].slice(0, 200) : undefined,
            metadata,
          });
          return new Response(null, {
            status: 204,
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.warn("[Funnel] unable to record event", error);
          return Response.json(
            { error: "Não foi possível registrar o evento do funil." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
