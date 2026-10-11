-- Migration: 20261011010000_coach_tiers.sql
-- Description: Coach tiers (Personal / Coach / Coach Pro), computed athlete limits, athlete AI entitlement, and grandfather extension.

-- 1. Effective max athletes computation
CREATE OR REPLACE FUNCTION public.effective_max_athletes(p_uid uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_paid_until timestamptz;
  v_coach_tier text;
  v_has_pro boolean;
BEGIN
  IF p_uid IS NULL THEN
    RETURN 3;
  END IF;

  SELECT plan, paid_until, coach_tier
  INTO v_plan, v_paid_until, v_coach_tier
  FROM public.users
  WHERE id = p_uid;

  IF NOT FOUND THEN
    RETURN 3;
  END IF;

  v_has_pro := (v_plan = 'pro' AND v_paid_until IS NOT NULL AND v_paid_until > now());

  IF v_has_pro AND v_coach_tier = 'enterprise' THEN
    RETURN 25;
  ELSIF v_has_pro THEN
    RETURN 10;
  ELSE
    RETURN 3;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.effective_max_athletes(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_max_athletes(uuid) TO service_role;

-- 2. Coach limits for authenticated user
CREATE OR REPLACE FUNCTION public.my_coach_limits()
RETURNS TABLE(athlete_count integer, athlete_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.coach_athlete_links
  WHERE coach_id = v_uid
    AND status = 'active';

  v_limit := public.effective_max_athletes(v_uid);

  RETURN QUERY SELECT coalesce(v_count, 0), coalesce(v_limit, 3);
END;
$$;

REVOKE ALL ON FUNCTION public.my_coach_limits() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_coach_limits() TO authenticated, service_role;

-- 3. Update link_to_coach to enforce effective_max_athletes
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

  v_max_athletes := public.effective_max_athletes(v_coach_id);

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
GRANT EXECUTE ON FUNCTION public.link_to_coach(text) TO authenticated, service_role;

-- 4. Update ai_plan_for to include athlete plan precedence
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

  -- 3. Check athlete of active pro coach within coach's effective capacity
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        cal.coach_id,
        cal.athlete_id,
        row_number() OVER (
          PARTITION BY cal.coach_id
          ORDER BY cal.linked_at ASC, cal.id ASC
        ) AS athlete_rank
      FROM public.coach_athlete_links cal
      WHERE cal.status = 'active'
        AND cal.coach_id IN (
          SELECT l.coach_id
          FROM public.coach_athlete_links l
          JOIN public.users u ON u.id = l.coach_id
          WHERE l.athlete_id = p_user_id
            AND l.status = 'active'
            AND u.plan = 'pro'
            AND u.paid_until IS NOT NULL
            AND u.paid_until > now()
        )
    ) ranked
    WHERE ranked.athlete_id = p_user_id
      AND ranked.athlete_rank <= public.effective_max_athletes(ranked.coach_id)
  ) THEN
    RETURN 'athlete';
  END IF;

  -- 4. Free
  RETURN 'free';
END;
$$;

REVOKE ALL ON FUNCTION public.ai_plan_for(uuid) FROM public, anon, authenticated;

-- 5. Update quota configuration and consume_ai_quota
UPDATE public.app_config
SET value = jsonb_set(
  jsonb_set(value, '{plans,basic}', '{"period":"day","limit":5}'::jsonb, true),
  '{plans,athlete}', '{"period":"day","limit":5}'::jsonb, true
),
updated_at = now()
WHERE key = 'ai_quota_limits';

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
  c_default_limits constant jsonb := '{"photo_cost":2,"plans":{"trial":{"period":"day","limit":30},"basic":{"period":"day","limit":5},"pro":{"period":"day","limit":30},"athlete":{"period":"day","limit":5},"free":{"period":"month","limit":0}},"trial_days":14}'::jsonb;
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

-- 6. Grandfather extension to Coach Pro until 2035-10-10
ALTER TABLE public.billing_grandfather
  ADD COLUMN IF NOT EXISTS prev_coach_tier text NULL,
  ADD COLUMN IF NOT EXISTS prev_granted_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS extended_at timestamptz NULL;

UPDATE public.billing_grandfather bg
SET
  prev_coach_tier = coalesce(bg.prev_coach_tier, u.coach_tier),
  prev_granted_until = coalesce(bg.prev_granted_until, bg.granted_until),
  extended_at = coalesce(bg.extended_at, now()),
  granted_until = greatest(bg.granted_until, '2035-10-10T00:00:00Z'::timestamptz)
FROM public.users u
WHERE u.id = bg.user_id;

UPDATE public.users u
SET
  plan = 'pro',
  coach_tier = 'enterprise',
  paid_until = greatest(coalesce(u.paid_until, now()), '2035-10-10T00:00:00Z'::timestamptz)
FROM public.billing_grandfather bg
WHERE u.id = bg.user_id;

-- 7. grandfather_user function for granting one user Coach Pro until 2035-10-10
CREATE OR REPLACE FUNCTION public.grandfather_user(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user record;
  v_bg record;
  v_target_until constant timestamptz := '2035-10-10T00:00:00Z'::timestamptz;
  v_new_paid_until timestamptz;
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, plan, paid_until, coach_tier
  INTO v_user
  FROM public.users
  WHERE id = p_uid;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_new_paid_until := greatest(coalesce(v_user.paid_until, now()), v_target_until);

  SELECT * INTO v_bg
  FROM public.billing_grandfather
  WHERE user_id = p_uid;

  IF NOT FOUND THEN
    INSERT INTO public.billing_grandfather (
      user_id,
      prev_plan,
      prev_paid_until,
      prev_coach_tier,
      prev_granted_until,
      granted_until,
      granted_at,
      extended_at
    ) VALUES (
      p_uid,
      v_user.plan,
      v_user.paid_until,
      v_user.coach_tier,
      NULL,
      v_new_paid_until,
      now(),
      now()
    );

    UPDATE public.users
    SET plan = 'pro',
        coach_tier = 'enterprise',
        paid_until = v_new_paid_until
    WHERE id = p_uid;

    RETURN true;
  ELSE
    IF v_bg.granted_until < v_target_until
       OR v_user.coach_tier IS DISTINCT FROM 'enterprise'
       OR v_user.plan IS DISTINCT FROM 'pro'
       OR v_user.paid_until < v_new_paid_until THEN

      UPDATE public.billing_grandfather
      SET prev_coach_tier = coalesce(prev_coach_tier, v_user.coach_tier),
          prev_granted_until = coalesce(prev_granted_until, granted_until),
          extended_at = coalesce(extended_at, now()),
          granted_until = greatest(granted_until, v_target_until)
      WHERE user_id = p_uid;

      UPDATE public.users
      SET plan = 'pro',
          coach_tier = 'enterprise',
          paid_until = greatest(coalesce(paid_until, now()), v_target_until)
      WHERE id = p_uid;

      RETURN true;
    END IF;

    RETURN false;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.grandfather_user(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grandfather_user(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
