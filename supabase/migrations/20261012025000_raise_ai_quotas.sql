-- Migration: 20261012025000_raise_ai_quotas.sql
-- Description: Raise Personal (basic) AI quota to 20/day and coached athlete AI quota to 10/day.

-- 1. Update app_config quota limits
UPDATE public.app_config
SET value = jsonb_set(
  jsonb_set(value, '{plans,basic}', '{"period":"day","limit":20}'::jsonb, true),
  '{plans,athlete}', '{"period":"day","limit":10}'::jsonb, true
),
updated_at = now()
WHERE key = 'ai_quota_limits';

-- 2. Update consume_ai_quota built-in fallback constants
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
  c_default_limits constant jsonb := '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"day","limit":20},"pro":{"period":"day","limit":30},"athlete":{"period":"day","limit":10},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb;
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
    IF v_plan NOT IN ('trial', 'free', 'basic', 'pro', 'athlete') THEN
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
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(integer) TO authenticated, service_role;

-- 3. Update refund_ai_quota built-in fallback constants
CREATE OR REPLACE FUNCTION public.refund_ai_quota(p_user_id uuid, p_amount integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_config jsonb;
  v_plans jsonb;
  v_plan_cfg jsonb;
  v_period text;
  v_period_start date;
  v_new_count integer := 0;
  c_default_limits constant jsonb := '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"day","limit":20},"pro":{"period":"day","limit":30},"athlete":{"period":"day","limit":10},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT count INTO v_new_count
    FROM public.ai_usage
    WHERE user_id = p_user_id
    ORDER BY updated_at DESC
    LIMIT 1;
    RETURN coalesce(v_new_count, 0);
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

  -- Resolve user plan
  v_plan := public.ai_plan_for(p_user_id);

  v_plans := v_config->'plans';
  IF v_plans IS NOT NULL AND jsonb_typeof(v_plans) = 'object' AND v_plans ? v_plan THEN
    v_plan_cfg := v_plans->v_plan;
  ELSE
    IF v_plans IS NOT NULL AND jsonb_typeof(v_plans) = 'object' AND v_plans ? 'free' THEN
      v_plan_cfg := v_plans->'free';
    ELSE
      v_plan_cfg := '{"period":"month","limit":0}'::jsonb;
    END IF;
    IF v_plan NOT IN ('trial', 'free', 'basic', 'pro', 'athlete') THEN
      v_plan := 'free';
    END IF;
  END IF;

  v_period := coalesce(v_plan_cfg->>'period', 'month');
  IF v_period NOT IN ('day', 'month') THEN
    v_period := 'month';
  END IF;

  IF v_period = 'day' THEN
    v_period_start := (now() AT TIME ZONE 'UTC')::date;
  ELSE
    v_period_start := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  END IF;

  UPDATE public.ai_usage
  SET count = greatest(0, count - p_amount),
      updated_at = now()
  WHERE user_id = p_user_id
    AND period_kind = v_period
    AND period_start = v_period_start
  RETURNING count INTO v_new_count;

  IF v_new_count IS NULL THEN
    v_new_count := 0;
  END IF;

  RETURN v_new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_quota(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
