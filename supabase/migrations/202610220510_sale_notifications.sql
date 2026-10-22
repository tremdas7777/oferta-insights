alter table public.sagacepay_settings
  add column if not exists notification_webhook_url text,
  add column if not exists product_name text not null default 'Ebook Amoroso';
