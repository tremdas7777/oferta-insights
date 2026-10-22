import { createFileRoute } from "@tanstack/react-router";
import {
  adminCookie,
  adminLogoutCookie,
  createAdminSession,
  isAdminPasswordConfigured,
  isAdminRequest,
  verifyAdminPassword,
} from "@/lib/admin-auth.server";

export const Route = createFileRoute("/api/admin/auth")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        Response.json({
          authenticated: await isAdminRequest(request),
          configured: isAdminPasswordConfigured(),
        }),
      POST: async ({ request }) => {
        if (!isAdminPasswordConfigured()) {
          return Response.json(
            { error: "ADMIN_PASSWORD não está configurada no servidor." },
            { status: 503 },
          );
        }
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const password = typeof body["password"] === "string" ? body["password"] : "";
        if (!(await verifyAdminPassword(password))) {
          return Response.json({ error: "Senha inválida." }, { status: 401 });
        }
        const token = await createAdminSession();
        const secure = new URL(request.url).protocol === "https:";
        return new Response(null, {
          status: 204,
          headers: { "Set-Cookie": adminCookie(token, undefined, secure) },
        });
      },
      DELETE: async ({ request }) =>
        new Response(null, {
          status: 204,
          headers: { "Set-Cookie": adminLogoutCookie(new URL(request.url).protocol === "https:") },
        }),
    },
  },
});
