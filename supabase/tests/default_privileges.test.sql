BEGIN;
SELECT plan(17);

-- Create a new function in public schema after default privileges are revoked.
CREATE FUNCTION public.test_locked_new_rpc()
RETURNS text
LANGUAGE sql
AS $$ SELECT 'locked_ok'::text; $$;

-- 1. Verify anon lacks EXECUTE on the new function by default
SELECT ok(
  NOT has_function_privilege('anon', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'anon cannot execute new function by default'
);

-- 2. Verify public lacks EXECUTE on the new function by default
SELECT ok(
  NOT has_function_privilege('public', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'public cannot execute new function by default'
);

-- 3. Verify authenticated lacks EXECUTE on the new function by default
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'authenticated cannot execute new function by default'
);

-- 4. Verify service_role retains EXECUTE on the new function
SELECT ok(
  has_function_privilege('service_role', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'service_role can execute new function'
);

-- 5. Grant EXECUTE to authenticated and verify privilege
GRANT EXECUTE ON FUNCTION public.test_locked_new_rpc() TO authenticated;

SELECT ok(
  has_function_privilege('authenticated', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'authenticated can execute new function after explicit grant'
);

-- 6. Verify anon still lacks EXECUTE after grant to authenticated
SELECT ok(
  NOT has_function_privilege('anon', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'anon still cannot execute new function after grant to authenticated'
);

-- 7. Verify public still lacks EXECUTE after grant to authenticated
SELECT ok(
  NOT has_function_privilege('public', 'public.test_locked_new_rpc()', 'EXECUTE'),
  'public still cannot execute new function after grant to authenticated'
);

-- 8. Behavioral test: anon execution raises insufficient_privilege
DO $$
BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    PERFORM public.test_locked_new_rpc();
    RAISE EXCEPTION 'anon was able to execute locked function';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('anon execution attempt raises insufficient_privilege');

-- 9. Behavioral test: authenticated execution succeeds
DO $$
DECLARE
  v_result text;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);

  v_result := public.test_locked_new_rpc();
  IF v_result <> 'locked_ok' THEN
    RAISE EXCEPTION 'Unexpected result from authenticated execution: %', v_result;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated execution succeeds after explicit grant');

-- 10-17. Verify existing RPCs preserve their expected privileges
SELECT ok(
  has_function_privilege('authenticated', 'public.accept_terms(text)', 'EXECUTE'),
  'authenticated can execute existing RPC accept_terms'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.accept_terms(text)', 'EXECUTE'),
  'anon cannot execute existing RPC accept_terms'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_my_entitlement()', 'EXECUTE'),
  'authenticated can execute existing RPC get_my_entitlement'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_my_entitlement()', 'EXECUTE'),
  'anon cannot execute existing RPC get_my_entitlement'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.consume_ai_quota(integer)', 'EXECUTE'),
  'authenticated can execute existing RPC consume_ai_quota'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.consume_ai_quota(integer)', 'EXECUTE'),
  'anon cannot execute existing RPC consume_ai_quota'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_ghost_sets(uuid, date)', 'EXECUTE'),
  'authenticated can execute existing RPC get_ghost_sets'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_history_sessions_v2(uuid, date, date, uuid, integer)', 'EXECUTE'),
  'authenticated can execute existing RPC get_history_sessions_v2'
);

SELECT * FROM finish();
ROLLBACK;
