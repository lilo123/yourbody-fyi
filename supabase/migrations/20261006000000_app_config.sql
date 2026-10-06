-- Migration: 20261006000000_app_config.sql
-- Description: Server-side application configuration and feature flags table.
-- Clients have read-only access (SELECT for authenticated users).
-- Mutations are restricted to service_role (which bypasses RLS).

CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY CONSTRAINT app_config_key_check CHECK (key ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  value jsonb NOT NULL DEFAULT 'false'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_config FROM anon, authenticated;
GRANT SELECT ON public.app_config TO authenticated;

DROP POLICY IF EXISTS "app_config_authenticated_select" ON public.app_config;
CREATE POLICY "app_config_authenticated_select"
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
