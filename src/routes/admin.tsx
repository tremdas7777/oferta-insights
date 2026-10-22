import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export const Route = createFileRoute("/admin")({ component: AdminPage });

type Metrics = {
  totalOrders: number;
  paidOrders: number;
  pendingOrders: number;
  failedOrders: number;
  refundedOrders: number;
  grossRevenue: number;
  averageTicket: number;
  approvalRate: number;
};

type Order = {
  sale_id: string;
  external_id: string | null;
  status: string;
  amount: number;
  customer_name: string | null;
  customer_email: string | null;
  created_at: string;
  paid_at: string | null;
  raw_data?: Record<string, unknown> | null;
};

type FunnelEvent = {
  id: string;
  session_id: string;
  event_name: string;
  path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const emptyMetrics: Metrics = {
  totalOrders: 0,
  paidOrders: 0,
  pendingOrders: 0,
  failedOrders: 0,
  refundedOrders: 0,
  grossRevenue: 0,
  averageTicket: 0,
  approvalRate: 0,
};
const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateInput = (date: Date) => date.toISOString().slice(0, 10);

function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "live" | "orders" | "settings">("dashboard");
  const [from, setFrom] = useState(dateInput(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(dateInput(new Date()));
  const [status, setStatus] = useState("all");
  const [metrics, setMetrics] = useState<Metrics>(emptyMetrics);
  const [orders, setOrders] = useState<Order[]>([]);
  const [funnelEvents, setFunnelEvents] = useState<FunnelEvent[]>([]);
  const [liveWindowMinutes, setLiveWindowMinutes] = useState(15);
  const [chart, setChart] = useState<
    { date: string; paid: number; orders: number; revenue: number }[]
  >([]);
  const [settings, setSettings] = useState({
    apiKey: "",
    webhookSecret: "",
    utmfyApiToken: "",
    amount: "137",
    notificationWebhookUrl: "",
    productName: "Ebook Amoroso",
  });
  const [webhookEndpoint, setWebhookEndpoint] = useState("");
  const [settingsMeta, setSettingsMeta] = useState({
    configured: false,
    webhookConfigured: false,
    apiKeyLast4: "",
  });
  const [saved, setSaved] = useState("");
  const [testingNotification, setTestingNotification] = useState(false);
  const [testNotificationMessage, setTestNotificationMessage] = useState("");
  const [creatingTestOrder, setCreatingTestOrder] = useState(false);
  const [testOrderMessage, setTestOrderMessage] = useState("");

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Não foi possível concluir a operação.");
    return body;
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const query = `?from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}`;
      const [analytics, orderData] = await Promise.all([
        request(`/api/admin/analytics${query}`),
        request(`/api/admin/orders${query}&status=${encodeURIComponent(status)}`),
      ]);
      setMetrics(analytics.metrics ?? emptyMetrics);
      setChart(analytics.byDay ?? []);
      setOrders(orderData.orders ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar o painel.");
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await request("/api/admin/settings");
      setSettingsMeta(data);
      setWebhookEndpoint(data.postbackUrl ?? "");
      setSettings((current) => ({
        ...current,
        utmfyApiToken: "",
        amount: String(data.amount ?? 137),
        notificationWebhookUrl: String(data.notificationWebhookUrl ?? ""),
        productName: String(data.productName ?? "Ebook Amoroso"),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar configurações.");
    }
  };

  const loadFunnelEvents = async () => {
    try {
      const data = await request("/api/admin/funnel-events");
      setFunnelEvents(data.events ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar o Live View.");
    }
  };

  useEffect(() => {
    fetch("/api/admin/auth", { credentials: "include" })
      .then((response) => response.json())
      .then((data) => {
        setAuthenticated(data.authenticated);
        setConfigured(data.configured);
      })
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (authenticated) {
      void loadDashboard();
      void loadSettings();
    }
  }, [authenticated, from, to, status]);

  useEffect(() => {
    if (!authenticated || tab !== "live") return;
    void loadFunnelEvents();
    const timer = window.setInterval(() => void loadFunnelEvents(), 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, tab]);

  const maxRevenue = useMemo(() => Math.max(...chart.map((item) => item.revenue), 1), [chart]);

  if (authenticated === null)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        Carregando painel...
      </div>
    );
  if (!authenticated)
    return (
      <LoginScreen
        configured={configured}
        password={password}
        setPassword={setPassword}
        error={error}
        setError={setError}
        onLogin={async () => {
          setError("");
          setLoading(true);
          try {
            await request("/api/admin/auth", {
              method: "POST",
              body: JSON.stringify({ password }),
            });
            setAuthenticated(true);
            setPassword("");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Senha inválida.");
          } finally {
            setLoading(false);
          }
        }}
        loading={loading}
      />
    );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
              WPP / Operação
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Painel administrativo</h1>
          </div>
          <button
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            onClick={async () => {
              await request("/api/admin/auth", { method: "DELETE" });
              setAuthenticated(false);
            }}
          >
            Sair
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-5 py-6">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <nav className="flex flex-wrap gap-2">
          <Tab active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
            Visão geral
          </Tab>
          <Tab active={tab === "live"} onClick={() => setTab("live")}>
            Live View
          </Tab>
          <Tab active={tab === "orders"} onClick={() => setTab("orders")}>
            Pedidos
          </Tab>
          <Tab active={tab === "settings"} onClick={() => setTab("settings")}>
            Integrações
          </Tab>
        </nav>
        {tab !== "settings" && tab !== "live" && (
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              De
              <input
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Até
              <input
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <button
              className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-slate-950"
              onClick={() => {
                const start = new Date();
                start.setDate(start.getDate() - 6);
                setFrom(dateInput(start));
                setTo(dateInput(new Date()));
              }}
            >
              7 dias
            </button>
            <button
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
              onClick={() => {
                const start = new Date();
                start.setDate(start.getDate() - 29);
                setFrom(dateInput(start));
                setTo(dateInput(new Date()));
              }}
            >
              30 dias
            </button>
            <button
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
              onClick={() => void loadDashboard()}
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
            {tab === "orders" && (
              <select
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Todos os status</option>
                <option value="paid">Pagos</option>
                <option value="pending">Pendentes</option>
                <option value="failed">Falhos</option>
                <option value="expired">Expirados</option>
                <option value="refunded">Estornados</option>
              </select>
            )}
          </div>
        )}
        {tab === "dashboard" && (
          <Dashboard metrics={metrics} chart={chart} maxRevenue={maxRevenue} />
        )}
        {tab === "live" && (
          <LiveView
            events={funnelEvents}
            windowMinutes={liveWindowMinutes}
            onWindowChange={setLiveWindowMinutes}
            onRefresh={() => void loadFunnelEvents()}
          />
        )}
        {tab === "orders" && <Orders orders={orders} />}
        {tab === "settings" && (
          <Settings
            settings={settings}
            setSettings={setSettings}
            meta={settingsMeta}
            webhookEndpoint={webhookEndpoint}
            saved={saved}
            testingNotification={testingNotification}
            testNotificationMessage={testNotificationMessage}
            creatingTestOrder={creatingTestOrder}
            testOrderMessage={testOrderMessage}
            onTest={async () => {
              setTestNotificationMessage("");
              setError("");
              setTestingNotification(true);
              try {
                await request("/api/admin/settings", {
                  method: "POST",
                  body: JSON.stringify({ testNotification: true }),
                });
                setTestNotificationMessage("Notificação de teste enviada.");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Não foi possível testar.");
              } finally {
                setTestingNotification(false);
              }
            }}
            onCreateTestOrder={async () => {
              setTestOrderMessage("");
              setError("");
              setCreatingTestOrder(true);
              try {
                const result = await request("/api/admin/test-order", { method: "POST" });
                setTestOrderMessage(
                  `SagacePay respondeu e criou o pedido ${result.id} como ${result.status}. ${result.notified ? "A notificação Pushcut foi enviada." : "O pedido foi criado, mas o Pushcut ainda não está configurado."}`,
                );
                await loadDashboard();
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Não foi possível gerar o pedido de teste.",
                );
              } finally {
                setCreatingTestOrder(false);
              }
            }}
            onSave={async () => {
              setSaved("");
              setError("");
              try {
                await request("/api/admin/settings", {
                  method: "POST",
                  body: JSON.stringify(settings),
                });
                setSaved("Configurações salvas com segurança.");
                setSettings((current) => ({
                  ...current,
                  apiKey: "",
                  webhookSecret: "",
                  utmfyApiToken: "",
                }));
                await loadSettings();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
              }
            }}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen({
  configured,
  password,
  setPassword,
  error,
  setError,
  onLogin,
  loading,
}: {
  configured: boolean;
  password: string;
  setPassword: (value: string) => void;
  error: string;
  setError: (value: string) => void;
  onLogin: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
          Área restrita
        </p>
        <h1 className="mt-3 text-3xl font-bold">Painel admin</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Acesse pedidos, métricas de aprovação e configurações do checkout.
        </p>
        {!configured && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Defina <code>ADMIN_PASSWORD</code> no ambiente do servidor antes de entrar.
          </div>
        )}
        <label className="mt-6 block text-sm font-medium text-slate-300">
          Senha
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") onLogin();
            }}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none ring-emerald-500 focus:ring-2"
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button
          disabled={loading || !configured}
          onClick={onLogin}
          className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </div>
    </div>
  );
}

function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${active ? "bg-emerald-500 text-slate-950" : "border border-slate-800 text-slate-400 hover:bg-slate-900"}`}
    >
      {children}
    </button>
  );
}
function Dashboard({
  metrics,
  chart,
  maxRevenue,
}: {
  metrics: Metrics;
  chart: { date: string; paid: number; orders: number; revenue: number }[];
  maxRevenue: number;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Faturamento pago" value={money(metrics.grossRevenue)} accent />
        <Metric
          label="Taxa de aprovação"
          value={`${metrics.approvalRate.toFixed(1)}%`}
          hint={`${metrics.paidOrders} pagamentos aprovados`}
        />
        <Metric
          label="Pedidos"
          value={String(metrics.totalOrders)}
          hint={`${metrics.pendingOrders} pendentes`}
        />
        <Metric
          label="Ticket médio"
          value={money(metrics.averageTicket)}
          hint={`${metrics.failedOrders} falhos/expirados`}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Receita por dia</h2>
              <p className="mt-1 text-xs text-slate-500">Somente pagamentos confirmados</p>
            </div>
            <span className="text-xs text-slate-500">{chart.length} dias com movimento</span>
          </div>
          <div className="mt-7 flex h-56 items-end gap-1.5">
            {chart.length ? (
              chart.map((item) => (
                <div key={item.date} className="group flex h-full flex-1 flex-col justify-end">
                  <div
                    title={`${item.date}: ${money(item.revenue)}`}
                    className="min-h-1 rounded-t bg-emerald-400/80 transition group-hover:bg-emerald-300"
                    style={{
                      height: `${Math.max((item.revenue / maxRevenue) * 100, item.revenue ? 5 : 1)}%`,
                    }}
                  />
                  <span className="mt-2 truncate text-center text-[9px] text-slate-600">
                    {item.date.slice(5)}
                  </span>
                </div>
              ))
            ) : (
              <p className="w-full self-center text-center text-sm text-slate-500">
                Nenhum pedido no período.
              </p>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold">Funil de pagamentos</h2>
          <div className="mt-6 space-y-4">
            <Funnel
              label="Pagos"
              value={metrics.paidOrders}
              total={metrics.totalOrders}
              color="bg-emerald-400"
            />
            <Funnel
              label="Pendentes"
              value={metrics.pendingOrders}
              total={metrics.totalOrders}
              color="bg-amber-400"
            />
            <Funnel
              label="Falhos / expirados"
              value={metrics.failedOrders}
              total={metrics.totalOrders}
              color="bg-red-400"
            />
            <Funnel
              label="Estornados"
              value={metrics.refundedOrders}
              total={metrics.totalOrders}
              color="bg-purple-400"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-3 text-2xl font-bold ${accent ? "text-emerald-400" : "text-slate-100"}`}>
        {value}
      </p>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
function Funnel({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold">
          {value} <span className="text-xs text-slate-600">({percentage.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-800">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
function LiveView({
  events,
  windowMinutes,
  onWindowChange,
  onRefresh,
}: {
  events: FunnelEvent[];
  windowMinutes: number;
  onWindowChange: (value: number) => void;
  onRefresh: () => void;
}) {
  const labels: Record<string, string> = {
    page_view: "Visitou a oferta",
    phone_submitted: "Informou o telefone",
    analysis_started: "Iniciou a análise",
    checkout_opened: "Abriu o checkout",
    pix_submitted: "Enviou os dados do PIX",
    pix_generated: "Gerou o PIX",
  };
  const activeSince = windowMinutes > 0 ? Date.now() - windowMinutes * 60 * 1000 : 0;
  const active = events.filter(
    (event) => windowMinutes === 0 || new Date(event.created_at).getTime() >= activeSince,
  );
  const sessions = new Set(active.map((event) => event.session_id)).size;
  const windowLabel =
    windowMinutes === 0 ? "todo o histórico" : `últimos ${formatWindow(windowMinutes)}`;
  const stages = Object.keys(labels).map((eventName) => ({
    eventName,
    label: labels[eventName] ?? eventName,
    sessions: new Set(
      active.filter((event) => event.event_name === eventName).map((event) => event.session_id),
    ).size,
  }));
  const stageRate = (eventName: string) => {
    const stage = stages.find((item) => item.eventName === eventName);
    return sessions && stage ? (stage.sessions / sessions) * 100 : 0;
  };
  const traffic = new Map<string, { sessions: Set<string>; events: number; pix: Set<string> }>();
  active.forEach((event) => {
    const metadata = event.metadata ?? {};
    const sourceValue =
      metadata["utmSource"] ??
      metadata["utm_source"] ??
      metadata["source"] ??
      (metadata["fbclid"] ? "Meta Ads" : metadata["gclid"] ? "Google Ads" : "Direto");
    const source =
      typeof sourceValue === "string" && sourceValue.trim() ? sourceValue.trim() : "Direto";
    const row = traffic.get(source) ?? {
      sessions: new Set<string>(),
      events: 0,
      pix: new Set<string>(),
    };
    row.sessions.add(event.session_id);
    row.events += 1;
    if (event.event_name === "pix_generated") row.pix.add(event.session_id);
    traffic.set(source, row);
  });
  const trafficRows = Array.from(traffic.entries())
    .map(([source, row]) => ({
      source,
      sessions: row.sessions.size,
      events: row.events,
      pix: row.pix.size,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.events - a.events);
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
            <h2 className="font-semibold">Live View do funil</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Eventos reais de {windowLabel} · atualização a cada 5 segundos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Período
            <select
              className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-100"
              value={windowMinutes}
              onChange={(event) => onWindowChange(Number(event.target.value))}
            >
              <option value={5}>5 minutos</option>
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
              <option value={180}>3 horas</option>
              <option value={360}>6 horas</option>
              <option value={720}>12 horas</option>
              <option value={1440}>24 horas</option>
              <option value={0}>Todo o histórico</option>
            </select>
          </label>
          <button
            onClick={onRefresh}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Atualizar agora
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Sessões ativas"
          value={String(sessions)}
          hint={`Com evento em ${windowLabel}`}
          accent
        />
        {stages.map((stage) => (
          <Metric
            key={stage.eventName}
            label={stage.label}
            value={String(stage.sessions)}
            hint={`${((stage.sessions / (sessions || 1)) * 100).toFixed(1)}% das sessões`}
          />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Eventos registrados" value={String(active.length)} hint={windowLabel} />
        <Metric
          label="Taxa telefone"
          value={`${stageRate("phone_submitted").toFixed(1)}%`}
          hint="Das sessões do período"
        />
        <Metric
          label="Taxa checkout"
          value={`${stageRate("checkout_opened").toFixed(1)}%`}
          hint="Das sessões do período"
        />
        <Metric
          label="Taxa geração PIX"
          value={`${stageRate("pix_generated").toFixed(1)}%`}
          hint="Das sessões do período"
          accent
        />
      </div>
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-5">
          <h2 className="font-semibold">Origem do tráfego</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sessões e geração de PIX agrupadas por UTM ou plataforma detectada
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Origem</th>
                <th className="px-5 py-3">Sessões</th>
                <th className="px-5 py-3">Eventos</th>
                <th className="px-5 py-3">PIX gerados</th>
                <th className="px-5 py-3">Taxa PIX</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {trafficRows.map((row) => (
                <tr key={row.source} className="hover:bg-slate-800/40">
                  <td className="px-5 py-3 font-medium text-slate-200">{row.source}</td>
                  <td className="px-5 py-3 text-slate-300">{row.sessions}</td>
                  <td className="px-5 py-3 text-slate-400">{row.events}</td>
                  <td className="px-5 py-3 text-emerald-300">{row.pix}</td>
                  <td className="px-5 py-3 text-slate-400">
                    {((row.pix / (row.sessions || 1)) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {!trafficRows.length && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                    Nenhuma origem registrada no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-5">
          <h2 className="font-semibold">Atividade recente</h2>
          <p className="mt-1 text-sm text-slate-500">Visitantes em {windowLabel}</p>
        </div>
        <div className="divide-y divide-slate-800">
          {active.slice(0, 50).map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <span className="text-slate-200">{labels[event.event_name] || event.event_name}</span>
              <span className="font-mono text-xs text-slate-500">
                {event.session_id.slice(0, 8)} ·{" "}
                {new Date(event.created_at).toLocaleTimeString("pt-BR")}
              </span>
            </div>
          ))}
          {!active.length && (
            <p className="px-5 py-12 text-center text-slate-500">Nenhum evento recente ainda.</p>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-5">
          <h2 className="font-semibold">Histórico do funil</h2>
          <p className="mt-1 text-sm text-slate-500">
            Últimos {events.length} eventos salvos, incluindo visitantes que já saíram
          </p>
        </div>
        <div className="divide-y divide-slate-800">
          {events.slice(0, 150).map((event) => (
            <div
              key={`history-${event.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
            >
              <div>
                <p className="text-slate-200">{labels[event.event_name] || event.event_name}</p>
                {Object.keys(event.metadata ?? {}).length > 0 && (
                  <p className="mt-1 max-w-xl truncate text-xs text-slate-500">
                    {Object.entries(event.metadata)
                      .slice(0, 3)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <span className="font-mono text-xs text-slate-500">
                {event.session_id.slice(0, 8)} ·{" "}
                {new Date(event.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
          {!events.length && (
            <p className="px-5 py-12 text-center text-slate-500">Nenhum evento histórico ainda.</p>
          )}
        </div>
      </section>
    </section>
  );
}

function formatWindow(minutes: number) {
  if (minutes < 60) return `${minutes} minutos`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hora" : "horas"}`;
}

function Orders({ orders }: { orders: Order[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 p-5">
        <h2 className="font-semibold">Pedidos</h2>
        <p className="mt-1 text-sm text-slate-500">Últimos pedidos do período selecionado</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Pedido</th>
              <th className="px-5 py-3">Cliente</th>
              <th className="px-5 py-3">Valor</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Origem</th>
              <th className="px-5 py-3">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {orders.map((order) => (
              <tr key={order.sale_id} className="hover:bg-slate-800/40">
                <td className="px-5 py-4 font-mono text-xs text-slate-400">
                  {order.sale_id.slice(0, 12)}...
                </td>
                <td className="px-5 py-4">
                  <p>{order.customer_name || "Não informado"}</p>
                  <p className="text-xs text-slate-500">{order.customer_email || "—"}</p>
                </td>
                <td className="px-5 py-4 font-semibold">{money(Number(order.amount))}</td>
                <td className="px-5 py-4">
                  <Status value={order.status} />
                </td>
                <td className="px-5 py-4 text-xs text-slate-400">
                  <TrafficSource order={order} />
                </td>
                <td className="px-5 py-4 text-xs text-slate-500">
                  {new Date(order.created_at).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-slate-500">
                  Nenhum pedido encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function TrafficSource({ order }: { order: Order }) {
  const tracking = order.raw_data?.["tracking"];
  if (!tracking || typeof tracking !== "object") return <span>Direto</span>;
  const attribution = tracking as Record<string, unknown>;
  const source = attribution["utmSource"] || attribution["utm_source"];
  const medium = attribution["utmMedium"] || attribution["utm_medium"];
  const campaign = attribution["utmCampaign"] || attribution["utm_campaign"];
  const parts = [source, medium, campaign].filter(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
  return <span title={parts.join(" / ")}>{parts.join(" / ") || "Direto"}</span>;
}
function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    paid: "Pago",
    pending: "Pendente",
    failed: "Falhou",
    expired: "Expirado",
    refunded: "Estornado",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${value === "paid" ? "bg-emerald-400/15 text-emerald-300" : value === "pending" ? "bg-amber-400/15 text-amber-300" : "bg-red-400/15 text-red-300"}`}
    >
      {labels[value] || value}
    </span>
  );
}
function Settings({
  settings,
  setSettings,
  meta,
  webhookEndpoint,
  saved,
  testingNotification,
  testNotificationMessage,
  creatingTestOrder,
  testOrderMessage,
  onTest,
  onCreateTestOrder,
  onSave,
}: {
  settings: {
    apiKey: string;
    webhookSecret: string;
    utmfyApiToken: string;
    amount: string;
    notificationWebhookUrl: string;
    productName: string;
  };
  setSettings: (value: {
    apiKey: string;
    webhookSecret: string;
    utmfyApiToken: string;
    amount: string;
    notificationWebhookUrl: string;
    productName: string;
  }) => void;
  meta: {
    configured: boolean;
    webhookConfigured: boolean;
    apiKeyLast4: string;
    utmfyConfigured?: boolean;
    utmfyTokenLast4?: string;
  };
  webhookEndpoint: string;
  saved: string;
  testingNotification: boolean;
  testNotificationMessage: string;
  creatingTestOrder: boolean;
  testOrderMessage: string;
  onTest: () => void;
  onCreateTestOrder: () => void;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-semibold">Configuração da SagacePay</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Os segredos são gravados apenas no backend. Depois de salvos, não são devolvidos ao
          navegador.
        </p>
        <div className="mt-6 space-y-4">
          <Field
            label="API Key"
            type="password"
            placeholder={
              meta.apiKeyLast4 ? `Salva · termina em ${meta.apiKeyLast4}` : "sk_live_..."
            }
            value={settings.apiKey}
            onChange={(value) => setSettings({ ...settings, apiKey: value })}
          />
          <Field
            label="Webhook Secret"
            type="password"
            placeholder={
              meta.webhookConfigured ? "Salvo · informe apenas para substituir" : "Signing secret"
            }
            value={settings.webhookSecret}
            onChange={(value) => setSettings({ ...settings, webhookSecret: value })}
          />
          <Field
            label="Token da UTMfy"
            type="password"
            placeholder={
              meta.utmfyTokenLast4
                ? `Salvo · termina em ${meta.utmfyTokenLast4}`
                : "Cole aqui o x-api-token da UTMfy"
            }
            value={settings.utmfyApiToken}
            onChange={(value) => setSettings({ ...settings, utmfyApiToken: value })}
          />
          <p className="-mt-2 text-xs leading-5 text-slate-500">
            Crie a credencial em UTMfy → Integrações → Webhooks → Credenciais de API. O token fica
            salvo apenas no backend.
          </p>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              URL do webhook (automática)
            </label>
            <div className="mt-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-300 break-all">
              {webhookEndpoint || "…"}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              Gerada a partir do domínio que estiver no ar — funciona com qualquer domínio
              conectado, sem precisar configurar nada.
            </p>
          </div>
          <Field
            label="Ticket (R$)"
            type="number"
            value={settings.amount}
            onChange={(value) => setSettings({ ...settings, amount: value })}
          />
          <Field
            label="Webhook de notificações (Pushcut)"
            placeholder="https://api.pushcut.io/..."
            value={settings.notificationWebhookUrl}
            onChange={(value) => setSettings({ ...settings, notificationWebhookUrl: value })}
          />
          <Field
            label="Info produto (gateway e notificações)"
            placeholder="Ebook Amoroso"
            value={settings.productName}
            onChange={(value) => setSettings({ ...settings, productName: value })}
          />
        </div>
        {saved && <p className="mt-4 text-sm text-emerald-300">{saved}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onSave}
            className="rounded-xl bg-emerald-500 px-4 py-3 font-bold text-slate-950"
          >
            Salvar configuração
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={testingNotification}
            className="rounded-xl border border-amber-400/50 px-4 py-3 font-bold text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testingNotification ? "Enviando teste..." : "Testar notificação"}
          </button>
          <button
            type="button"
            onClick={onCreateTestOrder}
            disabled={creatingTestOrder}
            className="rounded-xl border border-sky-400/50 px-4 py-3 font-bold text-sky-200 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creatingTestOrder ? "Gerando pedido..." : "Gerar pedido de teste"}
          </button>
        </div>
        {testNotificationMessage && (
          <p className="mt-3 text-sm text-amber-200">{testNotificationMessage}</p>
        )}
        {testOrderMessage && <p className="mt-3 text-sm text-sky-200">{testOrderMessage}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="font-semibold">Checklist de ativação</h2>
        <ul className="mt-5 space-y-4 text-sm text-slate-400">
          <li>{meta.configured ? "✓" : "○"} API Key configurada</li>
          <li>{meta.webhookConfigured ? "✓" : "○"} Webhook Secret configurado</li>
          <li>○ Migração Supabase aplicada</li>
          <li>{settings.notificationWebhookUrl ? "✓" : "○"} Webhook de notificações configurado</li>
          <li>
            {meta.utmfyConfigured ? "✓" : "○"} Integração UTMfy configurada
            {meta.utmfyTokenLast4 ? ` · termina em ${meta.utmfyTokenLast4}` : ""}
          </li>
          <li>✓ Eventos enviados: venda pendente e venda paga</li>
        </ul>
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-500">
          Endpoint: <code className="text-slate-300">/api/sagacepay/webhook</code>
          <br />
          Eventos de gateway: <code className="text-slate-300">sale.paid</code>,{" "}
          <code className="text-slate-300">sale.failed</code>,{" "}
          <code className="text-slate-300">sale.expired</code>
          <br />O webhook de notificações recebe o mesmo endpoint para os eventos pendente e pago.
        </div>
      </section>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-300">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-emerald-400"
      />
    </label>
  );
}
