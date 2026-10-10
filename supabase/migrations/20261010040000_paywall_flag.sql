-- Migration: 20261010040000_paywall_flag.sql
-- Description: Insert paywall_enabled feature flag (default false) into app_config.
-- Expand-only: safe to run concurrently with running application versions.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'paywall_enabled',
  'false'::jsonb,
  'Enables paywall UI, upgrade prompts, and subscription settings cards.'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
