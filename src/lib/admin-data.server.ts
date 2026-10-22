import { supabaseAdmin } from "@/lib/supabase-admin.server";

export type SagacePaySettings = {
  gateway_provider?: "sagacepay" | "umbrella" | null | undefined;
  api_key?: string | null | undefined;
  webhook_secret?: string | null | undefined;
  utmfy_api_token?: string | null | undefined;
  postback_url?: string | null | undefined;
  notification_webhook_url?: string | null | undefined;
  product_name?: string | null | undefined;
  amount?: number | string | null | undefined;
};

export type PaymentGateway = "sagacepay" | "umbrella";

/** Resolve o gateway de forma consistente com o painel e o valor predefinido do banco. */
export function getPaymentGateway(settings: SagacePaySettings | null | undefined): PaymentGateway {
  // Versões antigas guardavam a seleção da SagacePay em postback_url.
  if (settings?.postback_url === "gateway:sagacepay") return "sagacepay";
  if (settings?.postback_url === "gateway:umbrella") return "umbrella";
  if (settings?.gateway_provider === "sagacepay" || settings?.gateway_provider === "umbrella") {
    return settings.gateway_provider;
  }
  // Umbrella é o padrão do painel e da migração Supabase.
  return "umbrella";
}

export type OrderInput = {
  saleId: string;
  externalId?: string | undefined;
  status: string;
  amount: number;
  customer?: { name?: string; email?: string; document?: string; phone?: string } | undefined;
  rawData?: unknown;
  tracking?: Record<string, string>;
  paidAt?: string | undefined;
};

function adminDb(): any {
  return supabaseAdmin as any;
}

const PRIVATE_UTMFY_KEY = "utmfy_api_token";

async function readPrivateSetting(key: string): Promise<string | null> {
  try {
    const { data, error } = await adminDb()
      .from("private_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    return typeof data?.value === "string" ? data.value : null;
  } catch (error) {
    console.warn(`[Admin] unable to read private setting ${key}`, error);
    return null;
  }
}

async function savePrivateSetting(key: string, value: string | null): Promise<void> {
  try {
    const client = adminDb();
    const { error: deleteError } = await client.from("private_settings").delete().eq("key", key);
    if (deleteError) throw deleteError;
    if (value) {
      const { error } = await client.from("private_settings").insert({ key, value });
      if (error) throw error;
    }
  } catch (error) {
    console.warn(`[Admin] unable to save private setting ${key}`, error);
  }
}

export async function readSagacePaySettings(): Promise<SagacePaySettings | null> {
  try {
    const { data, error } = await adminDb()
      .from("sagacepay_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    const utmfy_api_token = await readPrivateSetting(PRIVATE_UTMFY_KEY);
    return { ...(data as SagacePaySettings | null), utmfy_api_token };
  } catch (error) {
    console.warn("[Admin] unable to read SagacePay settings", error);
    return null;
  }
}

export async function saveSagacePaySettings(settings: SagacePaySettings): Promise<void> {
  const { utmfy_api_token, ...databaseSettings } = settings;
  const { error } = await adminDb()
    .from("sagacepay_settings")
    .upsert({ id: true, ...databaseSettings, updated_at: new Date().toISOString() });
  if (error) throw error;
  await savePrivateSetting(PRIVATE_UTMFY_KEY, utmfy_api_token ?? null);
}

export async function recordOrder(input: OrderInput): Promise<void> {
  const now = new Date().toISOString();
  let previousTracking: Record<string, string> = {};
  let previousRawData: Record<string, unknown> = {};
  if (!input.tracking || input.rawData) {
    const { data: existing } = await adminDb()
      .from("sagacepay_orders")
      .select("raw_data")
      .eq("sale_id", input.saleId)
      .maybeSingle();
    const existingRaw = existing?.raw_data;
    if (existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)) {
      previousRawData = existingRaw as Record<string, unknown>;
      const stored = (existingRaw as Record<string, unknown>)["tracking"];
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        previousTracking = stored as Record<string, string>;
      }
    }
  }
  const tracking = input.tracking ?? previousTracking;
  const { error } = await adminDb()
    .from("sagacepay_orders")
    .upsert(
      {
        sale_id: input.saleId,
        external_id: input.externalId ?? null,
        status: input.status,
        amount: input.amount,
        customer_name: input.customer?.name ?? null,
        customer_email: input.customer?.email ?? null,
        customer_document: input.customer?.document ?? null,
        customer_phone: input.customer?.phone ?? null,
        paid_at: input.paidAt ?? (input.status === "paid" ? now : null),
        updated_at: now,
        raw_data: {
          ...previousRawData,
          ...(input.rawData && typeof input.rawData === "object" && !Array.isArray(input.rawData)
            ? (input.rawData as Record<string, unknown>)
            : { gateway_response: input.rawData ?? {} }),
          tracking,
        },
      },
      { onConflict: "sale_id" },
    );
  if (error) throw error;
}

export async function readOrder(saleId: string) {
  const { data, error } = await adminDb()
    .from("sagacepay_orders")
    .select("*")
    .eq("sale_id", saleId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateOrderTotal(
  saleId: string,
  amount: number,
  rawData: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminDb()
    .from("sagacepay_orders")
    .update({ amount, raw_data: rawData, updated_at: new Date().toISOString() })
    .eq("sale_id", saleId);
  if (error) throw error;
}

export type FunnelEventInput = {
  sessionId: string;
  eventName: string;
  path?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export async function recordFunnelEvent(input: FunnelEventInput): Promise<void> {
  const { error } = await adminDb()
    .from("funnel_events")
    .insert({
      session_id: input.sessionId,
      event_name: input.eventName,
      path: input.path ?? null,
      metadata: input.metadata ?? {},
    });
  if (error) throw error;
}

export async function listFunnelEvents(limit = 100) {
  const { data, error } = await adminDb()
    .from("funnel_events")
    .select("id, session_id, event_name, path, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listOrders(filters: {
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
}) {
  let query = adminDb()
    .from("sagacepay_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 500);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
