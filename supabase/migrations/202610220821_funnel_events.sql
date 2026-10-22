create extension if not exists pgcrypto;

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event_name text not null,
  path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_created_at_idx on public.funnel_events (created_at desc);
create index if not exists funnel_events_session_id_idx on public.funnel_events (session_id);

alter table public.funnel_events enable row level security;
revoke all on public.funnel_events from anon, authenticated;
