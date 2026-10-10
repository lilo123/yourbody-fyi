-- ============================================================================
-- Yourbody — Rollback Billing schema & Entitlement
-- Reverses 20261010030000_billing_entitlement.sql
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_my_entitlement();

-- Restore PR6 public.ai_plan_for definition
CREATE OR REPLACE FUNCTION public.ai_plan_for(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user record;
  v_trial_days integer := 14;
  v_config jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'free';
  END IF;

  SELECT created_at, trial_ends_at INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'free';
  END IF;

  BEGIN
    SELECT value INTO v_config
    FROM public.app_config
    WHERE key = 'ai_quota_limits';

    IF v_config IS NOT NULL AND jsonb_typeof(v_config) = 'object' THEN
      IF (v_config->>'trial_days') IS NOT NULL THEN
        v_trial_days := (v_config->>'trial_days')::integer;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_trial_days := 14;
  END;

  IF now() < COALESCE(v_user.trial_ends_at, v_user.created_at + make_interval(days => v_trial_days)) THEN
    RETURN 'trial';
  END IF;

  RETURN 'free';
END;
$$;

REVOKE ALL ON FUNCTION public.ai_plan_for(uuid) FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.has_paid_plan(uuid);
DROP FUNCTION IF EXISTS public.has_pro(uuid);

-- Restore PR6 public.protect_user_billing_fields definition
CREATE OR REPLACE FUNCTION public.protect_user_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF (NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at) THEN
    IF current_user IN ('anon', 'authenticated') OR (v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: Billing and trial fields can only be modified by administrative services.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TABLE IF EXISTS public.billing_events CASCADE;

DROP INDEX IF EXISTS public.idx_users_billing_customer_id;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS billing_customer_id,
  DROP COLUMN IF EXISTS paid_until,
  DROP COLUMN IF EXISTS plan;

NOTIFY pgrst, 'reload schema';
