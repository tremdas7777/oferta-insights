alter table public.sagacepay_settings
  add column if not exists utmfy_api_token text;
