alter table public.sagacepay_settings
  add column if not exists notification_webhook_url text,
  add column if not exists product_name text not null default 'Ebook Amoroso',
  add column if not exists utmfy_api_token text;

alter table public.funnel_events enable row level security;

grant select, insert on public.funnel_events to anon;
grant select, insert, update, delete on public.funnel_events to authenticated;