BEGIN;
SELECT plan(9);

-- ============================================================================
-- 1. Function existence and return type
-- ============================================================================
SELECT has_function('public', 'get_owner_stats', 'get_owner_stats function exists');
SELECT function_returns('public', 'get_owner_stats', 'jsonb', 'get_owner_stats returns jsonb');

-- ============================================================================
-- 2. Permissions: only service_role (and the owner) may execute
-- ============================================================================
SET LOCAL ROLE anon;
SELECT throws_matching(
  'SELECT public.get_owner_stats()',
  'permission denied',
  'anon role cannot execute get_owner_stats'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_matching(
  'SELECT public.get_owner_stats()',
  'permission denied',
  'authenticated role cannot execute get_owner_stats'
);
RESET ROLE;

SELECT ok(
  has_function_privilege('service_role', 'public.get_owner_stats()', 'EXECUTE'),
  'service_role can execute get_owner_stats'
);

-- ============================================================================
-- 3. Result shape (counts only)
-- ============================================================================
SET LOCAL ROLE service_role;
SELECT ok(
  (public.get_owner_stats()) ?& ARRAY['generated_at', 'tiers', 'ai_today'],
  'result has generated_at, tiers and ai_today'
);
SELECT ok(
  (public.get_owner_stats() -> 'tiers') ?& ARRAY['personal', 'coach', 'coach_pro', 'trial', 'free'],
  'tiers has personal, coach, coach_pro, trial and free'
);
SELECT ok(
  (public.get_owner_stats() -> 'ai_today') ?& ARRAY['total_uses', 'distinct_users', 'by_plan'],
  'ai_today has total_uses, distinct_users and by_plan'
);
SELECT ok(
  public.get_owner_stats()::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    AND position('@' in public.get_owner_stats()::text) = 0,
  'result contains no user ids or email addresses'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
