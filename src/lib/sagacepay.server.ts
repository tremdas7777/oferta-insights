import { readSagacePaySettings } from "@/lib/admin-data.server";
import { createUmbrellaPix, getUmbrellaKey, getUmbrellaTransaction } from "@/lib/umbrella.server";

const DEFAULT_SAGACEPAY_BASE_URL = "https://sagacepay.com/api";

export const SAGACEPAY_AMOUNT = 137;
export const SAGACEPAY_PRODUCT_NAME = "Ebook Amoroso";
export const IMMEDIATE_ACCESS_AMOUNT = 29.9;
export const IMMEDIATE_ACCESS_PRODUCT_NAME = "Liberação imediata — Ebook Amoroso";

export type SagacePayRuntimeConfig = {
  gateway: "sagacepay" | "umbrella";
  apiKey: string;
  webhookSecret: string;
  baseUrl: string;
  amount: number;
  productName: string;
};

export type SagacePayPublicConfig = {
  amount: number;
  productName: string;
};

type SagacePayErrorPayload = {
  message?: unknown;
  statusCode?: unknown;
  error?: unknown;
  errors?: unknown;
};

export type CreateSaleInput = {
  customer: {
    name?: string;
    document: string;
    email?: string;
    phone?: string;
  };
  externalId: string;
  idempotencyKey: string;
  tracking?: Record<string, string>;
  postbackUrl?: string;
  amount?: number;
  productName?: string;
};

export type SaleResponse = {
  id?: string;
  status?: string;
  amount?: number;
  pixCode?: string;
  pixQrCode?: string;
  transactionId?: string;
  [key: string]: unknown;
};

export async function getSagacePayRuntimeConfig(): Promise<SagacePayRuntimeConfig> {
  const settings = await readSagacePaySettings();
  // SagacePay é o gateway padrão; UmbrellaPag só quando explicitamente selecionada.
  const gateway =
    settings?.gateway_provider === "umbrella" || settings?.postback_url === "gateway:umbrella"
      ? "umbrella"
      : "sagacepay";
  const apiKey = settings?.api_key?.trim() || process.env["SAGACEPAY_API_KEY"] || "";
  const webhookSecret =
    settings?.webhook_secret?.trim() || process.env["SAGACEPAY_WEBHOOK_SECRET"] || "";
  const configuredBaseUrl = process.env["SAGACEPAY_BASE_URL"] ?? DEFAULT_SAGACEPAY_BASE_URL;
  const configuredAmount = Number(settings?.amount ?? SAGACEPAY_AMOUNT);
  const productName = settings?.product_name?.trim() || SAGACEPAY_PRODUCT_NAME;

  if (gateway === "sagacepay" && !apiKey) {
    throw new SagacePayConfigError("SAGACEPAY_API_KEY não está configurada no servidor.");
  }
  if (gateway === "umbrella" && !(await getUmbrellaKey())) {
    throw new SagacePayConfigError("UMBRELLA_API_KEY não está configurada no servidor.");
  }

  return {
    gateway,
    apiKey,
    webhookSecret,
    baseUrl: configuredBaseUrl.replace(/\/$/, ""),
    productName,
    amount:
      Number.isFinite(configuredAmount) && configuredAmount > 0
        ? configuredAmount
        : SAGACEPAY_AMOUNT,
  };
}

export async function getSagacePayPublicConfig(): Promise<SagacePayPublicConfig> {
  const settings = await readSagacePaySettings();
  const configuredAmount = Number(settings?.amount ?? SAGACEPAY_AMOUNT);
  return {
    amount:
      Number.isFinite(configuredAmount) && configuredAmount > 0
        ? configuredAmount
        : SAGACEPAY_AMOUNT,
    productName: settings?.product_name?.trim() || SAGACEPAY_PRODUCT_NAME,
  };
}

export class SagacePayConfigError extends Error {
  readonly code = "SAGACEPAY_NOT_CONFIGURED";
}

export class SagacePayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SagacePayApiError";
  }
}

async function parseApiResponse(response: Response): Promise<SaleResponse> {
  const raw = await response.text();
  let payload: SaleResponse & SagacePayErrorPayload = {};

  try {
    payload = (raw ? JSON.parse(raw) : {}) as SaleResponse & SagacePayErrorPayload;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = payload.message ?? payload.error ?? payload.errors;
    const message =
      typeof detail === "string"
        ? detail
        : detail
          ? `A UmbrellaPag recusou a solicitação: ${JSON.stringify(detail)}`
          : `A UmbrellaPag respondeu com HTTP ${response.status}.`;
    throw new SagacePayApiError(message, response.status);
  }

  return payload;
}

async function sagacePayRequest(
  path: string,
  init: RequestInit,
  config: SagacePayRuntimeConfig,
): Promise<SaleResponse> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      ...(init.headers ?? {}),
    },
  });

  return parseApiResponse(response);
}

export async function createSagacePaySale(input: CreateSaleInput): Promise<SaleResponse> {
  const config = await getSagacePayRuntimeConfig();
  const amount = input.amount ?? config.amount;
  const productName = input.productName ?? config.productName;
  if (config.gateway === "sagacepay") {
    const body: Record<string, unknown> = {
      amount,
      description: productName,
      expirationInSeconds: 86400,
      externalId: input.externalId,
      customer: {
        document: input.customer.document,
        ...(input.customer.name ? { name: input.customer.name } : {}),
        ...(input.customer.email ? { email: input.customer.email } : {}),
        ...(input.customer.phone ? { phone: input.customer.phone } : {}),
      },
      items: [{ description: productName, quantity: 1, unitPrice: amount, tangible: false }],
      ...(input.tracking && Object.keys(input.tracking).length > 0
        ? { tracking: input.tracking }
        : {}),
    };
    if (input.postbackUrl) body["postbackUrl"] = input.postbackUrl;
    return sagacePayRequest(
      "/sales",
      {
        method: "POST",
        headers: { "idempotency-key": input.idempotencyKey },
        body: JSON.stringify(body),
      },
      config,
    );
  }
  const umbrella = await createUmbrellaPix({
    amount: Math.round(amount * 100),
    customer: {
      name: input.customer.name ?? "Cliente",
      email: input.customer.email ?? "",
      phone: input.customer.phone ?? "",
      cpf: input.customer.document,
    },
    description: productName,
    postbackUrl: input.postbackUrl ?? "",
    metadata: { externalId: input.externalId },
  });
  const pixQrCode = `https://quickchart.io/qr?size=300&text=${encodeURIComponent(umbrella.qrcode)}`;
  return {
    id: umbrella.id,
    status: umbrella.status,
    amount,
    pixCode: umbrella.qrcode,
    pixQrCode,
  };
}

export async function getSagacePaySale(id: string): Promise<SaleResponse> {
  const config = await getSagacePayRuntimeConfig();
  if (config.gateway === "sagacepay") {
    return sagacePayRequest(`/sales/${encodeURIComponent(id)}`, { method: "GET" }, config);
  }
  const transaction = await getUmbrellaTransaction(id);
  if (!transaction) throw new SagacePayApiError("Cobrança não encontrada.", 404);
  return {
    id,
    status: transaction.status,
    amount: transaction.amount / 100,
  };
}

export async function getWebhookSecret(): Promise<string> {
  try {
    return (await getSagacePayRuntimeConfig()).webhookSecret;
  } catch {
    return "";
  }
}

export type SaleNotificationInput = {
  event: "sale.pending" | "sale.paid" | "sale.test";
  saleId: string;
  externalId?: string;
  status: "pending" | "paid";
  amount: number;
  productName?: string;
  customer?: { name?: string; email?: string; document?: string; phone?: string };
};

export async function notifySaleEvent(input: SaleNotificationInput): Promise<boolean> {
  const settings = await readSagacePaySettings();
  const endpoint =
    settings?.notification_webhook_url?.trim() ||
    process.env["SAGACEPAY_NOTIFICATION_WEBHOOK_URL"]?.trim() ||
    process.env["PUSHCUT_NOTIFICATION_URL"]?.trim() ||
    "";
  if (!endpoint) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("Webhook de notificação deve usar HTTPS.");
  } catch (error) {
    console.warn("[Notifications] invalid notification webhook URL", error);
    return false;
  }

  const productName =
    input.productName?.trim() ||
    settings?.product_name?.trim() ||
    process.env["SAGACEPAY_PRODUCT_NAME"]?.trim() ||
    SAGACEPAY_PRODUCT_NAME;
  const payload = {
    title: input.status === "paid" ? "Venda aprovada 💸" : "Venda pendente",
    text: `${productName} — ${input.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    event: input.event,
    status: input.status,
    statusLabel:
      input.event === "sale.test" ? "teste" : input.status === "paid" ? "paga" : "pendente",
    test: input.event === "sale.test",
    saleId: input.saleId,
    externalId: input.externalId ?? null,
    amount: input.amount,
    amountFormatted: input.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    currency: "BRL",
    product: productName,
    productName,
    infoProduto: productName,
    "Info produto": productName,
    occurredAt: new Date().toISOString(),
    customer: input.customer ?? null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[Notifications] webhook returned HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notifications] unable to deliver sale notification", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// O webhook é sempre derivado do domínio da requisição: qualquer domínio
// conectado ao projeto funciona sem configuração extra.
export async function webhookUrl(request: Request): Promise<string> {
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    "";
  const settings = await readSagacePaySettings();
  const gateway =
    settings?.gateway_provider === "umbrella" || settings?.postback_url === "gateway:umbrella"
      ? "umbrella"
      : "sagacepay";
  return gateway === "sagacepay"
    ? `${proto}://${host}/api/sagacepay/webhook`
    : `${proto}://${host}/api/public/umbrella-webhook`;
}

export function toPublicApiError(error: unknown): { message: string; status: number } {
  if (error instanceof SagacePayConfigError) {
    return {
      message:
        "O pagamento ainda não está configurado. Configure a chave da UmbrellaPag no servidor.",
      status: 503,
    };
  }

  if (error instanceof SagacePayApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        message: "A configuração da UmbrellaPag foi rejeitada. Verifique a chave no servidor.",
        status: 502,
      };
    }
    if (error.status === 429) {
      return {
        message:
          "A UmbrellaPag recebeu muitas tentativas. Aguarde alguns instantes e tente novamente.",
        status: 429,
      };
    }
    return { message: error.message, status: error.status >= 500 ? 502 : 400 };
  }

  return { message: "Não foi possível criar a cobrança PIX. Tente novamente.", status: 500 };
}
