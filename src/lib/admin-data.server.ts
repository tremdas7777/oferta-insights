import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SagacePaySettings = {
  api_key?: string | null | undefined;
  webhook_secret?: string | null | undefined;
  postback_url?: string | null | undefined;
  notification_webhook_url?: string | null | undefined;
  product_name?: string | null | undefined;
  amount?: number | string | null | undefined;
};

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

export async function readSagacePaySettings(): Promise<SagacePaySettings | null> {
  try {
    const { data, error } = await adminDb()
      .from("sagacepay_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    return data as SagacePaySettings | null;
  } catch (error) {
    console.warn("[Admin] unable to read SagacePay settings", error);
    return null;
  }
}

export async function saveSagacePaySettings(settings: SagacePaySettings): Promise<void> {
  const { error } = await adminDb()
    .from("sagacepay_settings")
    .upsert({ id: true, ...settings, updated_at: new Date().toISOString() });
  if (error) throw error;
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
