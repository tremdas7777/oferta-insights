// UmbrellaPag: pagamentos via Pix. Somente servidor.
// Chave: a cadastrada no /admin (tabela private_settings, só service role) ou, sem ela, o secret
// UMBRELLA_API_KEY. Projeto sem Supabase: faça savedKey() devolver null e use só o secret.
const API = "https://api-gateway.umbrellapag.com/api/user/transactions";
// Exigido pela Umbrella em todas as chamadas.
const USER_AGENT = "UMBRELLAB2B/1.0";

const KEY = "umbrella_api_key";
// A tela do pedido consulta o status a cada poucos segundos: guarda a chave por 1 minuto.
const CACHE_MS = 60_000;
let cache: { value: string | null; at: number } | null = null;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Chave salva no /admin (se houver). */
async function savedKey(): Promise<string | null> {
  const { data } = await (
    await db()
  )
    .from("private_settings")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  return (data?.value as string | null) || null;
}

/** Chave em uso: a do /admin ou, sem ela, o secret. */
export async function getUmbrellaKey(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = (await savedKey()) || process.env["UMBRELLA_API_KEY"] || null;
  cache = { value, at: Date.now() };
  return value;
}

/** De onde vem a chave em uso (para mostrar no /admin). */
export async function getUmbrellaKeySource(): Promise<{
  key: string | null;
  source: "admin" | "secret" | null;
}> {
  const saved = await savedKey();
  if (saved) return { key: saved, source: "admin" };
  const env = process.env["UMBRELLA_API_KEY"] || null;
  return { key: env, source: env ? "secret" : null };
}

export async function saveUmbrellaKey(value: string): Promise<void> {
  const { error } = await (
    await db()
  )
    .from("private_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  cache = null;
}

export async function deleteUmbrellaKey(): Promise<void> {
  const { error } = await (await db()).from("private_settings").delete().eq("key", KEY);
  if (error) throw new Error(error.message);
  cache = null;
}

async function headers(): Promise<Record<string, string>> {
  const key = await getUmbrellaKey();
  if (!key) throw new Error("Pagamento indisponível no momento.");
  return {
    "x-api-key": key,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Status que contam como pagamento confirmado. "approved" NÃO entra: alguns gateways usam esse
 * status para Pix gerado e ainda não pago.
 */
const PAID_STATUSES = new Set(["paid", "pago", "completed", "concluido", "concluida", "confirmed"]);

export const isUmbrellaPaid = (status: string | null | undefined) =>
  PAID_STATUSES.has(
    String(status ?? "")
      .trim()
      .toLowerCase(),
  );

/** Texto legível de uma mensagem do gateway (pode vir como texto, lista ou objeto). */
function gatewayText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return v.map(gatewayText).filter(Boolean).join("; ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      gatewayText(o["description"] ?? o["message"] ?? o["reason"] ?? o["error"]) ??
      JSON.stringify(v).slice(0, 200)
    );
  }
  return String(v);
}

/**
 * Pix copia e cola da resposta. A documentação não traz um exemplo de Pix gerado, então aceitamos
 * os formatos usados pela plataforma: `pix.qrcode`, `pix.qrCode`, `pix` como texto ou `qrCode`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta do gateway sem tipo
export function umbrellaQrcode(d: any): string | null {
  const pix = d?.pix;
  const v =
    (typeof pix === "string" ? pix : null) ??
    pix?.qrcode ??
    pix?.qrCode ??
    pix?.copyPaste ??
    pix?.copiaECola ??
    pix?.emv ??
    pix?.payload ??
    d?.qrCode ??
    d?.qrcode ??
    null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Testa a chave sem criar cobrança: consulta uma transação inexistente (404 = chave aceita). */
export async function testUmbrellaKey(): Promise<{
  ok: boolean;
  status?: number | undefined;
  error?: string | undefined;
}> {
  try {
    const res = await fetch(`${API}/00000000-0000-0000-0000-000000000000`, {
      headers: await headers(),
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, status: res.status, error: "Chave recusada pela Umbrella" };
    return { ok: res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de conexão" };
  }
}

export type UmbrellaAddress = {
  street: string;
  number: string;
  complement?: string | undefined;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
};

/** Gera a cobrança Pix. Valor em centavos (a Umbrella também trabalha em centavos). */
export async function createUmbrellaPix(o: {
  amount: number;
  customer: { name: string; email: string; phone: string; cpf: string };
  address?: UmbrellaAddress | undefined;
  /** Título do item na cobrança. */
  description: string;
  postbackUrl: string;
  ip?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Promise<{ id: string; qrcode: string; status: string }> {
  const address = o.address
    ? {
        street: o.address.street,
        streetNumber: o.address.number,
        complement: o.address.complement || "Sem complemento",
        zipCode: o.address.zipcode,
        neighborhood: o.address.neighborhood,
        city: o.address.city,
        state: o.address.state.toUpperCase(),
        country: "BR",
      }
    : undefined;
  const res = await fetch(API, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify({
      amount: o.amount,
      currency: "BRL",
      paymentMethod: "PIX",
      installments: 1,
      customer: {
        name: o.customer.name,
        email: o.customer.email,
        phone: o.customer.phone,
        document: { number: o.customer.cpf, type: "CPF" },
        ...(address ? { address } : {}),
      },
      ...(address ? { shipping: { fee: 0, address } } : {}),
      items: [{ title: o.description, unitPrice: o.amount, quantity: 1, tangible: true }],
      pix: { expiresInDays: 1 },
      postbackUrl: o.postbackUrl,
      metadata: JSON.stringify({ origem: "checkout", ...(o.metadata ?? {}) }),
      traceable: false,
      ...(o.ip ? { ip: o.ip } : {}),
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta do gateway sem tipo
  const json = (await res.json().catch(() => null)) as any;
  const d = json?.data ?? json;
  const id = d?.id;
  const qrcode = umbrellaQrcode(d);
  if (!res.ok || !id || !qrcode) {
    // Resposta completa (sem dados de cartão) para enviar ao suporte da Umbrella.
    console.error(
      "Umbrella error",
      res.status,
      gatewayText(d?.refusedReason ?? json?.message ?? json?.error) ?? "",
      JSON.stringify(json)?.slice(0, 1500),
    );
    throw new Error("Não foi possível gerar o Pix. Confira seus dados e tente novamente.");
  }
  console.log("umbrella-create", id, d?.status);
  return {
    id: String(id),
    qrcode,
    status: String(d?.status ?? "waiting_payment").toLowerCase(),
  };
}

/** Status atual da transação (valor em centavos). */
export async function getUmbrellaTransaction(
  id: string,
): Promise<{ status: string; amount: number; metadata?: Record<string, unknown> } | null> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, { headers: await headers() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta do gateway sem tipo
  const json = (await res.json().catch(() => null)) as any;
  const d = json?.data ?? json;
  console.log("umbrella-status", id, res.status, JSON.stringify(d?.status));
  if (!res.ok || !d?.id) return null;
  return {
    status: String(d.status ?? "waiting_payment").toLowerCase(),
    amount: Number(d.amount ?? 0),
    metadata:
      typeof d.metadata === "string"
        ? (() => {
            try {
              return JSON.parse(d.metadata) as Record<string, unknown>;
            } catch {
              return undefined;
            }
          })()
        : d.metadata && typeof d.metadata === "object"
          ? (d.metadata as Record<string, unknown>)
          : undefined,
  };
}
