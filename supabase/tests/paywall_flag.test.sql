BEGIN;
SELECT plan(4);

-- 1. Row exists in app_config
SELECT ok(
  EXISTS (SELECT 1 FROM public.app_config WHERE key = 'paywall_enabled'),
  'paywall_enabled key exists in app_config'
);

-- 2. Value is false (JSON boolean)
SELECT is(
  (SELECT value FROM public.app_config WHERE key = 'paywall_enabled'),
  'false'::jsonb,
  'paywall_enabled flag defaults to false'
);

-- 3. Authenticated role can SELECT paywall_enabled
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_flag_val jsonb;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  SELECT value INTO v_flag_val
  FROM public.app_config
  WHERE key = 'paywall_enabled';

  IF v_flag_val <> 'false'::jsonb THEN
    RAISE EXCEPTION 'authenticated role failed to select paywall_enabled or unexpected value: %', v_flag_val;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated role can SELECT paywall_enabled');

-- 4. Authenticated role cannot UPDATE paywall_enabled
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_update_denied boolean := false;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'paywall_enabled';
    RAISE EXCEPTION 'authenticated UPDATE on paywall_enabled was allowed unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN
    v_update_denied := true;
  END;

  IF NOT v_update_denied THEN
    RAISE EXCEPTION 'authenticated UPDATE was not denied with insufficient_privilege';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated role cannot UPDATE paywall_enabled (insufficient_privilege)');

SELECT * FROM finish();
ROLLBACK;
