import { createFileRoute } from "@tanstack/react-router";
import { isAdminRequest } from "@/lib/admin-auth.server";
import { readSagacePaySettings, saveSagacePaySettings } from "@/lib/admin-data.server";
import { notifySaleEvent, webhookUrl } from "@/lib/sagacepay.server";
import { getUmbrellaKeySource, saveUmbrellaKey } from "@/lib/umbrella.server";

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
        const umbrella = await getUmbrellaKeySource();
        const utmfyApiToken =
          settings?.utmfy_api_token?.trim() || process.env["UTMFY_API_TOKEN"]?.trim() || "";
        return Response.json({
          configured: Boolean(apiKey || process.env["SAGACEPAY_API_KEY"]),
          apiKeyLast4: apiKey
            ? apiKey.slice(-4)
            : (process.env["SAGACEPAY_API_KEY"]?.slice(-4) ?? ""),
          webhookConfigured: Boolean(
            settings?.webhook_secret || process.env["SAGACEPAY_WEBHOOK_SECRET"],
          ),
          utmfyConfigured: Boolean(utmfyApiToken),
          utmfyTokenLast4: utmfyApiToken.slice(-4),
          umbrellaConfigured: Boolean(umbrella.key),
          umbrellaKeyLast4: umbrella.key?.slice(-4) ?? "",
          umbrellaKeySource: umbrella.source,
          postbackUrl: webhookUrl(request),
          amount: Number(settings?.amount ?? 137),
          notificationWebhookUrl: settings?.notification_webhook_url ?? "",
          productName: settings?.product_name ?? "Ebook Amoroso",
        });
      },
      POST: async ({ request }) => {
        if (!(await isAdminRequest(request))) return unauthorized();
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const current = (await readSagacePaySettings()) ?? {};
        const currentUmbrella = await getUmbrellaKeySource();
        if (body["testNotification"] === true) {
          const notificationEndpoint =
            current.notification_webhook_url?.trim() ||
            process.env["SAGACEPAY_NOTIFICATION_WEBHOOK_URL"]?.trim() ||
            process.env["PUSHCUT_NOTIFICATION_URL"]?.trim();
          if (!notificationEndpoint) {
            return Response.json(
              {
                error: "Configure SAGACEPAY_NOTIFICATION_WEBHOOK_URL no ambiente antes de testar.",
              },
              { status: 400 },
            );
          }
          const delivered = await notifySaleEvent({
            event: "sale.test",
            saleId: `TESTE-${Date.now()}`,
            status: "paid",
            amount: Number(current.amount ?? 137),
            productName: current.product_name ?? "Ebook Amoroso",
          });
          if (!delivered) {
            return Response.json(
              { error: "O webhook de teste não respondeu com sucesso." },
              { status: 502 },
            );
          }
          return Response.json({ ok: true, test: true });
        }
        const apiKey =
          typeof body["apiKey"] === "string" && body["apiKey"].trim()
            ? body["apiKey"].trim()
            : current.api_key?.trim() || process.env["SAGACEPAY_API_KEY"] || "";
        const webhookSecret =
          typeof body["webhookSecret"] === "string" && body["webhookSecret"].trim()
            ? body["webhookSecret"].trim()
            : current.webhook_secret?.trim() || process.env["SAGACEPAY_WEBHOOK_SECRET"] || "";
        const utmfyApiToken =
          typeof body["utmfyApiToken"] === "string" && body["utmfyApiToken"].trim()
            ? body["utmfyApiToken"].trim()
            : current.utmfy_api_token?.trim() || process.env["UTMFY_API_TOKEN"]?.trim() || "";
        const umbrellaApiKey =
          typeof body["umbrellaApiKey"] === "string" && body["umbrellaApiKey"].trim()
            ? body["umbrellaApiKey"].trim()
            : null;
        const amount = Number(body["amount"] ?? current.amount ?? 137);
        const notificationWebhookUrl =
          typeof body["notificationWebhookUrl"] === "string"
            ? body["notificationWebhookUrl"].trim()
            : (current.notification_webhook_url ?? "");
        const productName =
          typeof body["productName"] === "string" && body["productName"].trim()
            ? body["productName"].trim().slice(0, 120)
            : current.product_name?.trim() || "Ebook Amoroso";
        if (
          (!apiKey || !webhookSecret) &&
          !umbrellaApiKey &&
          !currentUmbrella.key &&
          !process.env["UMBRELLA_API_KEY"]?.trim()
        ) {
          return Response.json(
            {
              error: "Configure a chave Umbrella ou informe API key e webhook secret da SagacePay.",
            },
            { status: 400 },
          );
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          return Response.json({ error: "Informe um valor válido." }, { status: 400 });
        }
        if (notificationWebhookUrl) {
          try {
            const parsedUrl = new URL(notificationWebhookUrl);
            if (parsedUrl.protocol !== "https:") throw new Error("HTTPS required");
          } catch {
            return Response.json(
              { error: "O webhook de notificações deve ser uma URL HTTPS válida." },
              { status: 400 },
            );
          }
        }
        try {
          await saveSagacePaySettings({
            api_key: apiKey,
            webhook_secret: webhookSecret,
            utmfy_api_token: utmfyApiToken || null,
            postback_url: null,
            notification_webhook_url: notificationWebhookUrl || null,
            product_name: productName,
            amount,
          });
          if (umbrellaApiKey) await saveUmbrellaKey(umbrellaApiKey);
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
