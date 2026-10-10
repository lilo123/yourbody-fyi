-- Migration: 20261010030000_billing_entitlement.sql
-- Description: Billing schema, webhook events, and user entitlement helpers.

-- 1. Add plan, paid_until, and billing_customer_id to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS paid_until timestamptz,
  ADD COLUMN IF NOT EXISTS billing_customer_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_plan_check
      CHECK (plan IS NULL OR plan IN ('free', 'basic', 'pro'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_billing_customer_id
  ON public.users (billing_customer_id)
  WHERE billing_customer_id IS NOT NULL;

-- 2. Trigger function to protect billing/trial fields from client updates
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

  IF (NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at)
     OR (NEW.plan IS DISTINCT FROM OLD.plan)
     OR (NEW.paid_until IS DISTINCT FROM OLD.paid_until)
     OR (NEW.billing_customer_id IS DISTINCT FROM OLD.billing_customer_id) THEN
    IF current_user IN ('anon', 'authenticated') OR (v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: Billing and trial fields can only be modified by administrative services.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Billing events log table (service_role only)
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  customer_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_events FROM public, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_billing_events_user_id ON public.billing_events(user_id);

-- 4. public.has_pro helper function
CREATE OR REPLACE FUNCTION public.has_pro(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text;
  v_is_service boolean;
  v_result boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  v_is_service := (v_jwt_role = 'service_role') OR (current_user = 'service_role') OR (current_user = 'postgres' AND v_jwt_role IS NULL);

  IF NOT v_is_service AND (p_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_user_id
      AND plan = 'pro'
      AND paid_until > now()
  ) INTO v_result;

  RETURN coalesce(v_result, false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_pro(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_pro(uuid) TO authenticated;

-- 5. public.has_paid_plan helper function
CREATE OR REPLACE FUNCTION public.has_paid_plan(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_role text;
  v_is_service boolean;
  v_plan text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  v_is_service := (v_jwt_role = 'service_role') OR (current_user = 'service_role') OR (current_user = 'postgres' AND v_jwt_role IS NULL);

  IF NOT v_is_service AND (p_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT plan INTO v_plan
  FROM public.users
  WHERE id = p_user_id
    AND plan IN ('basic', 'pro')
    AND paid_until > now();

  RETURN v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.has_paid_plan(uuid) FROM public, anon, authenticated;

-- 6. Update public.ai_plan_for to check paid plans first
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
  v_paid_plan text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'free';
  END IF;

  -- 1. Check paid plan first
  v_paid_plan := public.has_paid_plan(p_user_id);
  IF v_paid_plan IS NOT NULL THEN
    RETURN v_paid_plan;
  END IF;

  -- 2. Check trial
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

  -- 3. Free
  RETURN 'free';
END;
$$;

REVOKE ALL ON FUNCTION public.ai_plan_for(uuid) FROM public, anon, authenticated;

-- 7. public.get_my_entitlement function
CREATE OR REPLACE FUNCTION public.get_my_entitlement()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_user record;
  v_trial_days integer := 14;
  v_config jsonb;
  v_trial_ends_at_effective timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT plan, paid_until, trial_ends_at, created_at INTO v_user
  FROM public.users
  WHERE id = v_uid;

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

  IF v_user.created_at IS NOT NULL THEN
    v_trial_ends_at_effective := COALESCE(v_user.trial_ends_at, v_user.created_at + make_interval(days => v_trial_days));
  ELSE
    v_trial_ends_at_effective := v_user.trial_ends_at;
  END IF;

  RETURN jsonb_build_object(
    'plan_effective', public.ai_plan_for(v_uid),
    'plan', v_user.plan,
    'paid_until', to_jsonb(v_user.paid_until),
    'trial_ends_at_effective', to_jsonb(v_trial_ends_at_effective),
    'has_pro', public.has_pro(v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_entitlement() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_entitlement() TO authenticated;

-- 8. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
