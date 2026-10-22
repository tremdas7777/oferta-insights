-- Só precisa se o projeto ainda não tem a tabela private_settings (chave cadastrada pelo /admin).
-- Sem policies de propósito: só o service role (servidor) lê e grava.
CREATE TABLE IF NOT EXISTS public.private_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.private_settings TO service_role;
ALTER TABLE public.private_settings ENABLE ROW LEVEL SECURITY;
