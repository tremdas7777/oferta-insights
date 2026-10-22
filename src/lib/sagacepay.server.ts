import { readSagacePaySettings } from "@/lib/admin-data.server";

const DEFAULT_SAGACEPAY_BASE_URL = "https://sagacepay.com/api";

export const SAGACEPAY_AMOUNT = 137;
export const SAGACEPAY_PRODUCT_NAME = "Acesso WPP — 1 ano";

export type SagacePayRuntimeConfig = {
  apiKey: string;
  webhookSecret: string;
  postbackUrl?: string;
  baseUrl: string;
  amount: number;
};

type SagacePayErrorPayload = {
  message?: unknown;
  statusCode?: unknown;
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
  const apiKey = settings?.api_key?.trim() || process.env["SAGACEPAY_API_KEY"] || "";
  const webhookSecret =
    settings?.webhook_secret?.trim() || process.env["SAGACEPAY_WEBHOOK_SECRET"] || "";
  const configuredPostbackUrl =
    settings?.postback_url?.trim() || process.env["SAGACEPAY_POSTBACK_URL"]?.trim();
  const configuredBaseUrl = process.env["SAGACEPAY_BASE_URL"] ?? DEFAULT_SAGACEPAY_BASE_URL;
  const configuredAmount = Number(settings?.amount ?? SAGACEPAY_AMOUNT);

  if (!apiKey) {
    throw new SagacePayConfigError("SAGACEPAY_API_KEY não está configurada no servidor.");
  }

  return {
    apiKey,
    webhookSecret,
    ...(configuredPostbackUrl ? { postbackUrl: configuredPostbackUrl } : {}),
    baseUrl: configuredBaseUrl.replace(/\/$/, ""),
    amount:
      Number.isFinite(configuredAmount) && configuredAmount > 0
        ? configuredAmount
        : SAGACEPAY_AMOUNT,
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
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `A SagacePay respondeu com HTTP ${response.status}.`;
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
  const body: Record<string, unknown> = {
    amount: config.amount,
    description: SAGACEPAY_PRODUCT_NAME,
    expirationInSeconds: 86400,
    externalId: input.externalId,
    customer: {
      document: input.customer.document,
      ...(input.customer.name ? { name: input.customer.name } : {}),
      ...(input.customer.email ? { email: input.customer.email } : {}),
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    },
    items: [
      {
        description: SAGACEPAY_PRODUCT_NAME,
        quantity: 1,
        unitPrice: config.amount,
        tangible: false,
      },
    ],
    ...(input.tracking && Object.keys(input.tracking).length > 0
      ? { tracking: input.tracking }
      : {}),
  };

  if (input.postbackUrl) body["postbackUrl"] = input.postbackUrl;

  return sagacePayRequest(
    "/sales",
    {
      method: "POST",
      headers: {
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    config,
  );
}

export async function getSagacePaySale(id: string): Promise<SaleResponse> {
  const config = await getSagacePayRuntimeConfig();
  return sagacePayRequest(`/sales/${encodeURIComponent(id)}`, { method: "GET" }, config);
}

export async function getWebhookSecret(): Promise<string> {
  try {
    return (await getSagacePayRuntimeConfig()).webhookSecret;
  } catch {
    return "";
  }
}

export async function getPostbackUrl(): Promise<string | undefined> {
  try {
    return (await getSagacePayRuntimeConfig()).postbackUrl;
  } catch {
    return undefined;
  }
}

export function toPublicApiError(error: unknown): { message: string; status: number } {
  if (error instanceof SagacePayConfigError) {
    return {
      message:
        "O pagamento ainda não está configurado. Configure a integração SagacePay no servidor.",
      status: 503,
    };
  }

  if (error instanceof SagacePayApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        message: "A configuração da SagacePay foi rejeitada. Verifique a API key no servidor.",
        status: 502,
      };
    }
    if (error.status === 429) {
      return {
        message:
          "A SagacePay recebeu muitas tentativas. Aguarde alguns instantes e tente novamente.",
        status: 429,
      };
    }
    return { message: error.message, status: error.status >= 500 ? 502 : 400 };
  }

  return { message: "Não foi possível criar a cobrança PIX. Tente novamente.", status: 500 };
}
