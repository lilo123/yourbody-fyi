-- Migration: 20261012020000_refund_ai_quota.sql
-- Description: Refund AI quota uses upon upstream AI failure or unparseable output.

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
  c_default_limits constant jsonb := '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"day","limit":5},"pro":{"period":"day","limit":30},"athlete":{"period":"day","limit":5},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb;
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
