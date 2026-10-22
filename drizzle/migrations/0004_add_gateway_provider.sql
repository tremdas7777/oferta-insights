alter table public.sagacepay_settings
  add column if not exists gateway_provider text
  check (gateway_provider in ('sagacepay', 'umbrella'));

comment on column public.sagacepay_settings.gateway_provider is 'Gateway de pagamento ativo: sagacepay (padrão) ou umbrella';
comment on column public.sagacepay_settings.postback_url is 'DEPRECATED: webhook é derivado do domínio da requisição; gateway agora vem de gateway_provider';