import { readSagacePaySettings } from "@/lib/admin-data.server";

const SAGACEPAY_PRODUCT_NAME = "Ebook Amoroso";

const UTMFY_ENDPOINT = "https://api.utmify.com.br/api-credentials/orders";
const PLATFORM_NAME = "WPP";

type UTMfyStatus = "waiting_payment" | "paid" | "refused" | "refunded" | "chargedback";

type UTMfyInput = {
  orderId: string;
  status: UTMfyStatus;
  amount: number;
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    document?: string;
  };
  tracking?: Record<string, string>;
  createdAt: string;
  approvedDate?: string | null;
  refundedAt?: string | null;
  isTest?: boolean;
};

function formatUtc(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatUtcInput(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? formatUtc(new Date()) : formatUtc(date);
}

function trackingParameters(tracking: Record<string, string> = {}) {
  return {
    src: tracking.src ?? null,
    sck: tracking.sck ?? tracking.xcod ?? null,
    utm_source: tracking.utmSource ?? null,
    utm_campaign: tracking.utmCampaign ?? null,
    utm_medium: tracking.utmMedium ?? null,
    utm_content: tracking.utmContent ?? null,
    utm_term: tracking.utmTerm ?? null,
  };
}

function statusFromGateway(status: string): UTMfyStatus {
  if (status === "paid") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "chargedback" || status === "chargeback") return "chargedback";
  if (["failed", "expired", "refused"].includes(status)) return "refused";
  return "waiting_payment";
}

export function isUtmfyConfigured(): boolean {
  return Boolean(process.env["UTMFY_API_TOKEN"]?.trim());
}

export async function sendUtmfyOrder(input: UTMfyInput): Promise<boolean> {
  const settings = await readSagacePaySettings();
  const token = settings?.utmfy_api_token?.trim() || process.env["UTMFY_API_TOKEN"]?.trim();
  if (!token) return false;

  const amountInCents = Math.round(input.amount * 100);
  const payload = {
    orderId: input.orderId,
    platform: PLATFORM_NAME,
    paymentMethod: "pix",
    status: input.status,
    createdAt: formatUtcInput(input.createdAt),
    approvedDate: input.approvedDate ? formatUtcInput(input.approvedDate) : null,
    refundedAt: input.refundedAt ? formatUtcInput(input.refundedAt) : null,
    customer: {
      name: input.customer?.name ?? "Cliente",
      email: input.customer?.email ?? "",
      phone: input.customer?.phone ?? null,
      document: input.customer?.document ?? null,
      country: "BR",
    },
    products: [
      {
        id: "ebook-amoroso",
        name:
          settings?.product_name?.trim() ||
          process.env["SAGACEPAY_PRODUCT_NAME"]?.trim() ||
          SAGACEPAY_PRODUCT_NAME,
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: amountInCents,
      },
    ],
    trackingParameters: trackingParameters(input.tracking),
    commission: {
      totalPriceInCents: amountInCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: amountInCents,
      currency: "BRL",
    },
    ...(input.isTest ? { isTest: true } : {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(UTMFY_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-token": token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[UTMfy] order ${input.orderId} returned HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[UTMfy] unable to send order ${input.orderId}`, error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export { formatUtc, statusFromGateway };
