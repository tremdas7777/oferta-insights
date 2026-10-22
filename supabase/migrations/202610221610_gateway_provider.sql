alter table if exists public.sagacepay_settings
  add column if not exists gateway_provider text not null default 'umbrella';

alter table if exists public.sagacepay_settings
  drop constraint if exists sagacepay_settings_gateway_provider_check;

alter table if exists public.sagacepay_settings
  add constraint sagacepay_settings_gateway_provider_check
  check (gateway_provider in ('sagacepay', 'umbrella'));
