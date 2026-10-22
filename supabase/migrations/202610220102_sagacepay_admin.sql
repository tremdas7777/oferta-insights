create extension if not exists pgcrypto;

create table if not exists public.sagacepay_settings (
  id boolean primary key default true check (id = true),
  api_key text,
  webhook_secret text,
  postback_url text,
  amount numeric(12, 2) not null default 137.00,
  updated_at timestamptz not null default now()
);

create table if not exists public.sagacepay_orders (
  id uuid primary key default gen_random_uuid(),
  sale_id text not null unique,
  external_id text,
  status text not null default 'pending',
  amount numeric(12, 2) not null,
  customer_name text,
  customer_email text,
  customer_document text,
  customer_phone text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  raw_data jsonb not null default '{}'::jsonb
);

create index if not exists sagacepay_orders_created_at_idx on public.sagacepay_orders (created_at desc);
create index if not exists sagacepay_orders_status_idx on public.sagacepay_orders (status);

alter table public.sagacepay_settings enable row level security;
alter table public.sagacepay_orders enable row level security;

revoke all on public.sagacepay_settings from anon, authenticated;
revoke all on public.sagacepay_orders from anon, authenticated;
