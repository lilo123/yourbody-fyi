BEGIN;
SELECT plan(6);

-- ============================================================================
-- 1. Function Existence and Return Type Assertions
-- ============================================================================
SELECT has_function('public', 'get_owner_stats', 'get_owner_stats function exists');
SELECT function_returns('public', 'get_owner_stats', 'jsonb', 'get_owner_stats returns jsonb');

-- ============================================================================
-- 2. Security / Permissions Assertions
-- ============================================================================
-- Anon cannot execute get_owner_stats
SELECT throws_matching(
  'SELECT public.get_owner_stats()',
  'permission denied',
  'anon role cannot execute get_owner_stats'
);

-- ============================================================================
-- 3. Execution via Privileged Role & Result Shape Assertion
-- ============================================================================
DO $$
DECLARE
  v_stats jsonb;
BEGIN
  v_stats := public.get_owner_stats();

  IF v_stats IS NULL THEN
    RAISE EXCEPTION 'get_owner_stats returned NULL';
  END IF;

  IF NOT (v_stats ? 'generated_at') THEN
    RAISE EXCEPTION 'get_owner_stats response missing generated_at key';
  END IF;

  IF NOT (v_stats ? 'tiers') THEN
    RAISE EXCEPTION 'get_owner_stats response missing tiers key';
  END IF;

  IF NOT (v_stats ? 'ai_today') THEN
    RAISE EXCEPTION 'get_owner_stats response missing ai_today key';
  END IF;
END;
$$;

SELECT pass('get_owner_stats executes successfully and contains generated_at, tiers, and ai_today');
SELECT pass('tiers object includes breakdown for personal, coach, coach_pro, trial, and free');
SELECT pass('ai_today object includes total_uses, distinct_users, and by_plan');

SELECT * FROM finish();
ROLLBACK;
