-- Migration: 20261010010000_ai_quota.sql
-- Description: AI parse quota tracking, rate limits, and billing trial protection.

-- 1. Add trial_ends_at column to users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

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

  IF (NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at) THEN
    IF current_user IN ('anon', 'authenticated') OR (v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: Billing and trial fields can only be modified by administrative services.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_billing_fields ON public.users;
CREATE TRIGGER trg_protect_user_billing_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_billing_fields();

-- 3. AI Usage table
CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_kind text NOT NULL CHECK (period_kind IN ('day', 'month')),
  period_start date NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_kind, period_start)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_usage FROM anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;

DROP POLICY IF EXISTS "ai_usage_own_rows_select" ON public.ai_usage;
CREATE POLICY "ai_usage_own_rows_select"
  ON public.ai_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 4. Seed app_config defaults for AI quota
INSERT INTO public.app_config (key, value, description)
VALUES
  ('ai_quota_enabled', 'false'::jsonb, 'Enforce AI parse quotas in parse-nutrition'),
  ('ai_quota_limits', '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"month","limit":100},"pro":{"period":"day","limit":30},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb, 'AI parse quota limits and period configuration by plan')
ON CONFLICT (key) DO NOTHING;

-- 5. Helper function to determine AI plan for a user
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

-- 6. RPC: consume_ai_quota
CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_cost integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_plan text;
  v_config jsonb;
  v_plans jsonb;
  v_plan_cfg jsonb;
  v_period text;
  v_limit integer;
  v_period_start date;
  v_resets_at timestamptz;
  v_new_count integer;
  v_current_count integer;
  v_allowed boolean;
  v_used integer;
  c_default_limits constant jsonb := '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"month","limit":100},"pro":{"period":"day","limit":30},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_cost IS NULL OR p_cost < 1 OR p_cost > 10 THEN
    RAISE EXCEPTION 'Cost must be between 1 and 10' USING ERRCODE = '22023';
  END IF;

  -- Read ai_quota_limits from app_config, fallback to built-in default
  BEGIN
    SELECT value INTO v_config
    FROM public.app_config
    WHERE key = 'ai_quota_limits';

    IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
      v_config := c_default_limits;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_config := c_default_limits;
  END;

  -- Resolve plan
  v_plan := public.ai_plan_for(v_uid);

  v_plans := v_config->'plans';
  IF v_plans IS NOT NULL AND jsonb_typeof(v_plans) = 'object' AND v_plans ? v_plan THEN
    v_plan_cfg := v_plans->v_plan;
  ELSE
    IF v_plans IS NOT NULL AND jsonb_typeof(v_plans) = 'object' AND v_plans ? 'free' THEN
      v_plan_cfg := v_plans->'free';
    ELSE
      v_plan_cfg := '{"period":"month","limit":0}'::jsonb;
    END IF;
    IF v_plan NOT IN ('trial', 'free', 'basic', 'pro') THEN
      v_plan := 'free';
    END IF;
  END IF;

  v_period := coalesce(v_plan_cfg->>'period', 'month');
  IF v_period NOT IN ('day', 'month') THEN
    v_period := 'month';
  END IF;

  BEGIN
    v_limit := coalesce((v_plan_cfg->>'limit')::integer, 0);
  EXCEPTION WHEN OTHERS THEN
    v_limit := 0;
  END;
  IF v_limit < 0 THEN
    v_limit := 0;
  END IF;

  IF v_period = 'day' THEN
    v_period_start := (now() AT TIME ZONE 'UTC')::date;
    v_resets_at := ((now() AT TIME ZONE 'UTC')::date + interval '1 day') AT TIME ZONE 'UTC';
  ELSE
    v_period_start := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
    v_resets_at := (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC';
  END IF;

  -- Atomic quota consumption
  INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
  SELECT v_uid, v_period, v_period_start, p_cost
  WHERE p_cost <= v_limit
  ON CONFLICT (user_id, period_kind, period_start)
  DO UPDATE SET count = public.ai_usage.count + EXCLUDED.count, updated_at = now()
  WHERE public.ai_usage.count + EXCLUDED.count <= v_limit
  RETURNING count INTO v_new_count;

  IF v_new_count IS NOT NULL THEN
    v_allowed := true;
    v_used := v_new_count;
  ELSE
    v_allowed := false;
    SELECT count INTO v_current_count
    FROM public.ai_usage
    WHERE user_id = v_uid AND period_kind = v_period AND period_start = v_period_start;
    v_used := coalesce(v_current_count, 0);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'plan', v_plan,
    'limit', v_limit,
    'used', v_used,
    'cost', p_cost,
    'period', v_period,
    'resets_at', to_jsonb(v_resets_at)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(integer) TO authenticated;

-- 7. Schema reload notification
NOTIFY pgrst, 'reload schema';
