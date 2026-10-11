-- Rollback: 20261011010000_down.sql
-- Description: Revert coach tiers, grandfather extension, quota limits, and restored RPC definitions.

-- 1. Revert grandfather extension only for unchanged users
UPDATE public.users u
SET coach_tier = coalesce(bg.prev_coach_tier, 'free'),
    paid_until = coalesce(bg.prev_granted_until, bg.prev_paid_until),
    plan = CASE WHEN bg.prev_granted_until IS NULL THEN coalesce(bg.prev_plan, 'free') ELSE u.plan END
FROM public.billing_grandfather bg
WHERE u.id = bg.user_id
  AND u.coach_tier = 'enterprise'
  AND u.paid_until = bg.granted_until;

DELETE FROM public.billing_grandfather
WHERE prev_granted_until IS NULL AND extended_at IS NOT NULL;

UPDATE public.billing_grandfather
SET granted_until = coalesce(prev_granted_until, granted_until)
WHERE extended_at IS NOT NULL;

ALTER TABLE public.billing_grandfather
  DROP COLUMN IF EXISTS prev_coach_tier,
  DROP COLUMN IF EXISTS prev_granted_until,
  DROP COLUMN IF EXISTS extended_at;

-- 2. Drop new functions
DROP FUNCTION IF EXISTS public.grandfather_user(uuid);
DROP FUNCTION IF EXISTS public.my_coach_limits();
DROP FUNCTION IF EXISTS public.effective_max_athletes(uuid);

-- 3. Restore quota configuration: basic back to 100/month, remove athlete
UPDATE public.app_config
SET value = jsonb_set(value #- '{plans,athlete}', '{plans,basic}', '{"period":"month","limit":100}'::jsonb),
    updated_at = now()
WHERE key = 'ai_quota_limits';

-- 4. Restore previous consume_ai_quota definition
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

-- 5. Restore previous ai_plan_for definition
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

-- 6. Restore previous link_to_coach definition
CREATE OR REPLACE FUNCTION public.link_to_coach(input_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_athlete_id uuid := auth.uid();
  v_coach_id uuid;
  v_coach_name text;
  v_max_athletes int;
  v_current_athletes int;
  v_clean_code text := UPPER(TRIM(input_code));
BEGIN
  IF v_athlete_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_clean_code IS NULL OR LENGTH(v_clean_code) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please enter a valid coach code.');
  END IF;

  SELECT id, username, max_athletes 
  INTO v_coach_id, v_coach_name, v_max_athletes
  FROM public.users
  WHERE UPPER(coach_code) = v_clean_code AND is_coach_mode = true
  FOR UPDATE;

  IF v_coach_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or inactive coach code. Please verify with your coach.');
  END IF;

  IF v_coach_id = v_athlete_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot link to your own coach code.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coach_athlete_links
    WHERE coach_id = v_coach_id AND athlete_id = v_athlete_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object(
      'success', true, 
      'coach', jsonb_build_object('id', v_coach_id, 'username', v_coach_name),
      'already_linked', true
    );
  END IF;

  SELECT COUNT(*) INTO v_current_athletes
  FROM public.coach_athlete_links
  WHERE coach_id = v_coach_id AND status = 'active';

  IF v_current_athletes >= COALESCE(v_max_athletes, 3) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'This coach has reached their maximum athlete capacity (' || v_current_athletes || '/' || v_max_athletes || '). Ask your coach to upgrade their tier.'
    );
  END IF;

  UPDATE public.coach_athlete_links
  SET status = 'disconnected', disconnected_at = now()
  WHERE athlete_id = v_athlete_id AND status = 'active';

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach_id, v_athlete_id, 'active', now());

  RETURN jsonb_build_object(
    'success', true, 
    'coach', jsonb_build_object('id', v_coach_id, 'username', v_coach_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_to_coach(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.link_to_coach(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
