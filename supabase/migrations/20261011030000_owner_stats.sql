-- ============================================================================
-- Yourbody — Owner Statistics RPC (Read-Only)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_owner_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tiers jsonb;
  v_ai_today jsonb;
  v_total_ai_uses integer;
  v_distinct_ai_users integer;
  v_ai_by_plan jsonb;
  v_result jsonb;
BEGIN
  -- 1. Tier census matching Query 1 of docs/ops.md
  WITH config AS (
    SELECT COALESCE((value->>'trial_days')::integer, 14) AS trial_days
    FROM public.app_config
    WHERE key = 'ai_quota_limits'
  ),
  tiers (tier, sort_order) AS (
    VALUES
      ('Personal', 1),
      ('Coach', 2),
      ('Coach Pro', 3),
      ('Trial', 4),
      ('Free', 5)
  ),
  user_classification AS (
    SELECT
      u.id,
      CASE
        WHEN u.plan = 'basic' AND u.paid_until > now() THEN 'Personal'
        WHEN u.plan = 'pro' AND u.coach_tier = 'enterprise' AND u.paid_until > now() THEN 'Coach Pro'
        WHEN u.plan = 'pro' AND (u.coach_tier = 'pro' OR u.coach_tier IS NULL OR u.coach_tier = 'free') AND u.paid_until > now() THEN 'Coach'
        WHEN now() < COALESCE(u.trial_ends_at, u.created_at + make_interval(days => COALESCE((SELECT trial_days FROM config), 14))) THEN 'Trial'
        ELSE 'Free'
      END AS tier,
      CASE
        WHEN bg.user_id IS NOT NULL AND bg.granted_until > now() THEN 'grandfathered'
        WHEN u.billing_customer_id IS NOT NULL THEN 'paying'
        ELSE 'unpaid'
      END AS billing_status
    FROM public.users u
    LEFT JOIN public.billing_grandfather bg ON bg.user_id = u.id
  ),
  tier_summary AS (
    SELECT
      t.tier,
      COUNT(u.id) FILTER (WHERE u.billing_status = 'paying')::integer AS paying_count,
      COUNT(u.id) FILTER (WHERE u.billing_status = 'grandfathered')::integer AS grandfathered_count,
      COUNT(u.id) FILTER (WHERE u.billing_status = 'unpaid')::integer AS unpaid_count,
      COUNT(u.id)::integer AS total_count
    FROM tiers t
    LEFT JOIN user_classification u ON u.tier = t.tier
    GROUP BY t.tier, t.sort_order
    ORDER BY t.sort_order
  )
  SELECT jsonb_object_agg(
    lower(replace(tier, ' ', '_')),
    jsonb_build_object(
      'paying', paying_count,
      'grandfathered', grandfathered_count,
      'unpaid', unpaid_count,
      'total', total_count
    )
  ) INTO v_tiers
  FROM tier_summary;

  -- 2. AI usage today matching Query 3A of docs/ops.md
  SELECT
    COALESCE(SUM(a.count), 0)::integer,
    COUNT(DISTINCT a.user_id)::integer
  INTO
    v_total_ai_uses,
    v_distinct_ai_users
  FROM public.ai_usage a
  WHERE a.period_kind = 'day'
    AND a.period_start = (now() AT TIME ZONE 'UTC')::date;

  WITH plan_breakdown AS (
    SELECT
      COALESCE(public.ai_plan_for(a.user_id), 'unknown') AS plan,
      COALESCE(SUM(a.count), 0)::integer AS uses_today
    FROM public.ai_usage a
    WHERE a.period_kind = 'day'
      AND a.period_start = (now() AT TIME ZONE 'UTC')::date
    GROUP BY 1
    ORDER BY uses_today DESC
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'plan', plan,
        'uses', uses_today
      )
    ),
    '[]'::jsonb
  ) INTO v_ai_by_plan
  FROM plan_breakdown;

  v_ai_today := jsonb_build_object(
    'total_uses', v_total_ai_uses,
    'distinct_users', v_distinct_ai_users,
    'by_plan', v_ai_by_plan
  );

  v_result := jsonb_build_object(
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'tiers', v_tiers,
    'ai_today', v_ai_today
  );

  RETURN v_result;
END;
$$;

-- Revoke execute from public, anon, authenticated
REVOKE EXECUTE ON FUNCTION public.get_owner_stats() FROM PUBLIC, anon, authenticated;

-- Grant execute only to service_role
GRANT EXECUTE ON FUNCTION public.get_owner_stats() TO service_role;
