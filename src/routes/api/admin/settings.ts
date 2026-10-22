import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import { readSagacePaySettings, saveSagacePaySettings } from "@/lib/admin-data.server";

function unauthorized() {
  return Response.json({ error: "Não autorizado." }, { status: 401 });
}

export const Route = createFileRoute("/api/admin/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAdminRequest(request))) return unauthorized();
        const settings = await readSagacePaySettings();
        const apiKey = settings?.api_key?.trim() ?? "";
        return Response.json({
          configured: Boolean(apiKey || process.env["SAGACEPAY_API_KEY"]),
          apiKeyLast4: apiKey
            ? apiKey.slice(-4)
            : (process.env["SAGACEPAY_API_KEY"]?.slice(-4) ?? ""),
          webhookConfigured: Boolean(
            settings?.webhook_secret || process.env["SAGACEPAY_WEBHOOK_SECRET"],
          ),
          postbackUrl: settings?.postback_url ?? process.env["SAGACEPAY_POSTBACK_URL"] ?? "",
          amount: Number(settings?.amount ?? 137),
        });
      },
      POST: async ({ request }) => {
        if (!(await isAdminRequest(request))) return unauthorized();
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const current = (await readSagacePaySettings()) ?? {};
        const apiKey =
          typeof body["apiKey"] === "string" && body["apiKey"].trim()
            ? body["apiKey"].trim()
            : current.api_key;
        const webhookSecret =
          typeof body["webhookSecret"] === "string" && body["webhookSecret"].trim()
            ? body["webhookSecret"].trim()
            : current.webhook_secret;
        const postbackUrl =
          typeof body["postbackUrl"] === "string"
            ? body["postbackUrl"].trim()
            : current.postback_url;
        const amount = Number(body["amount"] ?? current.amount ?? 137);
        if (!apiKey || !webhookSecret || !Number.isFinite(amount) || amount <= 0) {
          return Response.json(
            { error: "Informe API key, webhook secret e um valor válido." },
            { status: 400 },
          );
        }
        if (postbackUrl && !postbackUrl.startsWith("https://")) {
          return Response.json(
            { error: "A URL do webhook deve começar com https://." },
            { status: 400 },
          );
        }
        try {
          await saveSagacePaySettings({
            api_key: apiKey,
            webhook_secret: webhookSecret,
            postback_url: postbackUrl,
            amount,
          });
          return Response.json({ ok: true });
        } catch (error) {
          console.error("[Admin] unable to save settings", error);
          return Response.json(
            {
              error:
                "Não foi possível salvar. Aplique a migration e configure o Supabase Service Role.",
            },
            { status: 503 },
          );
        }
      },
    },
  },
});
