BEGIN;
SELECT plan(25);

-- 1. Schema & function existence
SELECT has_function('public', 'effective_max_athletes', ARRAY['uuid'], 'effective_max_athletes function exists');
SELECT has_function('public', 'my_coach_limits', 'my_coach_limits function exists');
SELECT has_function('public', 'grandfather_user', ARRAY['uuid'], 'grandfather_user function exists');
SELECT has_column('public', 'users', 'coach_tier', 'users table has coach_tier column');
SELECT has_column('public', 'users', 'max_athletes', 'users table has max_athletes column');
SELECT has_column('public', 'billing_grandfather', 'prev_coach_tier', 'billing_grandfather has prev_coach_tier');
SELECT has_column('public', 'billing_grandfather', 'prev_granted_until', 'billing_grandfather has prev_granted_until');
SELECT has_column('public', 'billing_grandfather', 'extended_at', 'billing_grandfather has extended_at');

-- 2. effective_max_athletes limits (25 / 10 / 3, lapsed -> 3, enterprise without has_pro -> 3)
DO $$
DECLARE
  v_coach_ent uuid := gen_random_uuid();
  v_coach_pro uuid := gen_random_uuid();
  v_coach_free_tier uuid := gen_random_uuid();
  v_coach_lapsed uuid := gen_random_uuid();
  v_coach_ent_basic uuid := gen_random_uuid();
  v_coach_ent_free uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_coach_ent, 'coach_ent@test.com'),
    (v_coach_pro, 'coach_pro@test.com'),
    (v_coach_free_tier, 'coach_ft@test.com'),
    (v_coach_lapsed, 'coach_lap@test.com'),
    (v_coach_ent_basic, 'coach_eb@test.com'),
    (v_coach_ent_free, 'coach_ef@test.com');

  -- Active Pro + enterprise -> 25
  UPDATE public.users SET plan = 'pro', coach_tier = 'enterprise', paid_until = now() + interval '30 days' WHERE id = v_coach_ent;
  IF public.effective_max_athletes(v_coach_ent) <> 25 THEN
    RAISE EXCEPTION 'Enterprise coach limit mismatch: expected 25, got %', public.effective_max_athletes(v_coach_ent);
  END IF;

  -- Active Pro + pro tier -> 10
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days' WHERE id = v_coach_pro;
  IF public.effective_max_athletes(v_coach_pro) <> 10 THEN
    RAISE EXCEPTION 'Pro coach limit mismatch: expected 10, got %', public.effective_max_athletes(v_coach_pro);
  END IF;

  -- Active Pro + free tier (or default) -> 10
  UPDATE public.users SET plan = 'pro', coach_tier = 'free', paid_until = now() + interval '30 days' WHERE id = v_coach_free_tier;
  IF public.effective_max_athletes(v_coach_free_tier) <> 10 THEN
    RAISE EXCEPTION 'Pro with free tier limit mismatch: expected 10, got %', public.effective_max_athletes(v_coach_free_tier);
  END IF;

  -- Lapsed Pro in the past (even with enterprise tier) -> 3
  UPDATE public.users SET plan = 'pro', coach_tier = 'enterprise', paid_until = now() - interval '1 day' WHERE id = v_coach_lapsed;
  IF public.effective_max_athletes(v_coach_lapsed) <> 3 THEN
    RAISE EXCEPTION 'Lapsed coach limit mismatch: expected 3, got %', public.effective_max_athletes(v_coach_lapsed);
  END IF;

  -- Enterprise tier but basic plan (no has_pro) -> 3
  UPDATE public.users SET plan = 'basic', coach_tier = 'enterprise', paid_until = now() + interval '30 days' WHERE id = v_coach_ent_basic;
  IF public.effective_max_athletes(v_coach_ent_basic) <> 3 THEN
    RAISE EXCEPTION 'Enterprise basic limit mismatch: expected 3, got %', public.effective_max_athletes(v_coach_ent_basic);
  END IF;

  -- Enterprise tier but free/no plan -> 3
  UPDATE public.users SET plan = NULL, coach_tier = 'enterprise', paid_until = NULL WHERE id = v_coach_ent_free;
  IF public.effective_max_athletes(v_coach_ent_free) <> 3 THEN
    RAISE EXCEPTION 'Enterprise free limit mismatch: expected 3, got %', public.effective_max_athletes(v_coach_ent_free);
  END IF;

  -- Non-existent user or NULL -> 3
  IF public.effective_max_athletes(NULL) <> 3 OR public.effective_max_athletes(gen_random_uuid()) <> 3 THEN
    RAISE EXCEPTION 'NULL / non-existent user limit mismatch: expected 3';
  END IF;
END;
$$;
SELECT pass('effective_max_athletes: 25 for enterprise pro, 10 for pro, 3 for lapsed or enterprise without pro');

-- 3. Execution privileges for effective_max_athletes, grandfather_user, my_coach_limits
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_test_uid, 'priv_check_user@test.com');

  -- 1) Authenticated cannot execute effective_max_athletes
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);
  BEGIN
    PERFORM public.effective_max_athletes(v_test_uid);
    RAISE EXCEPTION 'Authenticated was able to execute effective_max_athletes';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 2) Anon cannot execute effective_max_athletes
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.effective_max_athletes(v_test_uid);
    RAISE EXCEPTION 'Anon was able to execute effective_max_athletes';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 3) Authenticated cannot execute grandfather_user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);
  BEGIN
    PERFORM public.grandfather_user(v_test_uid);
    RAISE EXCEPTION 'Authenticated was able to execute grandfather_user';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 4) Anon cannot execute grandfather_user
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.grandfather_user(v_test_uid);
    RAISE EXCEPTION 'Anon was able to execute grandfather_user';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 5) Authenticated CAN execute my_coach_limits
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);
  PERFORM public.my_coach_limits();

  -- 6) Anon cannot execute my_coach_limits
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.my_coach_limits();
    RAISE EXCEPTION 'Anon was able to execute my_coach_limits';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 7) Service role can execute effective_max_athletes and grandfather_user
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.effective_max_athletes(v_test_uid);
  PERFORM public.grandfather_user(v_test_uid);

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Privileges: authenticated/anon denied for effective_max_athletes and grandfather_user; authenticated allowed for my_coach_limits');

-- 4. my_coach_limits returns own active counts and effective limit
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath1 uuid := gen_random_uuid();
  v_ath2 uuid := gen_random_uuid();
  v_ath_disc uuid := gen_random_uuid();
  v_rec record;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_coach, 'mcl_coach@test.com'),
    (v_ath1, 'mcl_ath1@test.com'),
    (v_ath2, 'mcl_ath2@test.com'),
    (v_ath_disc, 'mcl_ath_disc@test.com');

  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days' WHERE id = v_coach;

  -- 2 active links, 1 disconnected link
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at) VALUES
    (v_coach, v_ath1, 'active', now() - interval '2 days'),
    (v_coach, v_ath2, 'active', now() - interval '1 day'),
    (v_coach, v_ath_disc, 'disconnected', now() - interval '3 days');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach || '"}', true);

  SELECT athlete_count, athlete_limit INTO v_rec FROM public.my_coach_limits();

  IF v_rec.athlete_count <> 2 OR v_rec.athlete_limit <> 10 THEN
    RAISE EXCEPTION 'my_coach_limits returned unexpected counts: athlete_count=%, athlete_limit=%', v_rec.athlete_count, v_rec.athlete_limit;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('my_coach_limits returns own active athlete count and computed limit');

-- 5. link_to_coach: Pro coach capacity 10 (10 ok, 11th refused with exact error text)
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_aths uuid[] := ARRAY[]::uuid[];
  v_ath uuid;
  v_res jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'pro_coach_cap10@test.com');
  UPDATE public.users
  SET coach_code = 'YB-PRO10', is_coach_mode = true, plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days'
  WHERE id = v_coach;

  -- Create 11 athletes upfront as postgres
  FOR i IN 1..11 LOOP
    v_ath := gen_random_uuid();
    v_aths := array_append(v_aths, v_ath);
    INSERT INTO auth.users (id, email) VALUES (v_ath, 'ath_cap10_' || i || '@test.com');
  END LOOP;

  -- Link 10 athletes
  FOR i IN 1..10 LOOP
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[i] || '"}', true);
    v_res := public.link_to_coach('YB-PRO10');
    IF (v_res->>'success')::boolean <> true THEN
      RAISE EXCEPTION 'Athlete % failed to link to pro coach: %', i, v_res;
    END IF;
  END LOOP;

  -- 11th athlete refused with exact error text
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[11] || '"}', true);
  v_res := public.link_to_coach('YB-PRO10');

  IF (v_res->>'success')::boolean <> false THEN
    RAISE EXCEPTION '11th athlete was accepted by pro coach: %', v_res;
  END IF;
  IF v_res->>'error' <> 'This coach has reached their maximum athlete capacity (10/10). Ask your coach to upgrade their tier.' THEN
    RAISE EXCEPTION 'Unexpected error message for 11th athlete: %', v_res->>'error';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('link_to_coach: Pro coach links 10 athletes, 11th refused with exact capacity error');

-- 6. link_to_coach: Enterprise coach capacity 25 (25 ok, 26th refused with exact error text)
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_aths uuid[] := ARRAY[]::uuid[];
  v_ath uuid;
  v_res jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'ent_coach_cap25@test.com');
  UPDATE public.users
  SET coach_code = 'YB-ENT25', is_coach_mode = true, plan = 'pro', coach_tier = 'enterprise', paid_until = now() + interval '30 days'
  WHERE id = v_coach;

  -- Create 26 athletes upfront as postgres
  FOR i IN 1..26 LOOP
    v_ath := gen_random_uuid();
    v_aths := array_append(v_aths, v_ath);
    INSERT INTO auth.users (id, email) VALUES (v_ath, 'ath_cap25_' || i || '@test.com');
  END LOOP;

  -- Link 25 athletes
  FOR i IN 1..25 LOOP
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[i] || '"}', true);
    v_res := public.link_to_coach('YB-ENT25');
    IF (v_res->>'success')::boolean <> true THEN
      RAISE EXCEPTION 'Athlete % failed to link to enterprise coach: %', i, v_res;
    END IF;
  END LOOP;

  -- 26th athlete refused with exact error text
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[26] || '"}', true);
  v_res := public.link_to_coach('YB-ENT25');

  IF (v_res->>'success')::boolean <> false THEN
    RAISE EXCEPTION '26th athlete was accepted by enterprise coach: %', v_res;
  END IF;
  IF v_res->>'error' <> 'This coach has reached their maximum athlete capacity (25/25). Ask your coach to upgrade their tier.' THEN
    RAISE EXCEPTION 'Unexpected error message for 26th athlete: %', v_res->>'error';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('link_to_coach: Enterprise coach links 25 athletes, 26th refused with exact capacity error');

-- 7. link_to_coach: Lapsed coach with 5 existing links: links remain active, new 6th link refused
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_aths uuid[] := ARRAY[]::uuid[];
  v_ath uuid;
  v_res jsonb;
  v_active_count integer;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'lapsed_coach_5@test.com');
  -- Coach was previously pro/enterprise, has 5 links
  UPDATE public.users
  SET coach_code = 'YB-LAP5', is_coach_mode = true, plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days'
  WHERE id = v_coach;

  -- Create 6 athletes upfront as postgres
  FOR i IN 1..6 LOOP
    v_ath := gen_random_uuid();
    v_aths := array_append(v_aths, v_ath);
    INSERT INTO auth.users (id, email) VALUES (v_ath, 'ath_lap5_' || i || '@test.com');
  END LOOP;

  -- Link 5 athletes
  FOR i IN 1..5 LOOP
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[i] || '"}', true);
    PERFORM public.link_to_coach('YB-LAP5');
  END LOOP;

  -- Now coach lapses into the past (effective limit becomes 3)
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.users SET paid_until = now() - interval '2 days' WHERE id = v_coach;

  -- Existing 5 links are still active
  SELECT count(*) INTO v_active_count
  FROM public.coach_athlete_links
  WHERE coach_id = v_coach AND status = 'active';

  IF v_active_count <> 5 THEN
    RAISE EXCEPTION 'Existing links were altered after lapse: expected 5 active, got %', v_active_count;
  END IF;

  -- New 6th link refused with exact capacity message
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_aths[6] || '"}', true);
  v_res := public.link_to_coach('YB-LAP5');

  IF (v_res->>'success')::boolean <> false THEN
    RAISE EXCEPTION '6th athlete was accepted by lapsed coach: %', v_res;
  END IF;
  IF v_res->>'error' <> 'This coach has reached their maximum athlete capacity (5/3). Ask your coach to upgrade their tier.' THEN
    RAISE EXCEPTION 'Unexpected error message for lapsed coach 6th athlete: %', v_res->>'error';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('link_to_coach: Lapsed coach keeps existing 5 active links, refuses new link with (5/3) error');

-- 8. ai_plan_for: athlete of paid pro coach (rank <= N) -> athlete
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'pro_coach_aip@test.com'), (v_ath, 'ath_aip@test.com');
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  -- Expired trial and no own paid plan
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = now() - interval '10 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'athlete' THEN
    RAISE EXCEPTION 'ai_plan_for expected athlete, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete of paid pro coach (rank <= N) resolves to athlete');

-- 9. ai_plan_for: athlete rank N+1 -> not athlete ('free')
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath_extra uuid := gen_random_uuid();
  v_ath_dummy uuid;
  v_plan text;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'pro_coach_ranknp1@test.com');
  -- Coach is Pro (limit 10)
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;

  -- 10 active athletes linked earlier
  FOR i IN 1..10 LOOP
    v_ath_dummy := gen_random_uuid();
    INSERT INTO auth.users (id, email) VALUES (v_ath_dummy, 'ath_dummy_' || i || '@test.com');
    INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
    VALUES (v_coach, v_ath_dummy, 'active', now() - interval '10 days' + (i * interval '1 minute'));
  END LOOP;

  -- 11th athlete (rank 11 > 10)
  INSERT INTO auth.users (id, email) VALUES (v_ath_extra, 'ath_extra_11@test.com');
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = now() - interval '10 days' WHERE id = v_ath_extra;
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath_extra, 'active', now());

  v_plan := public.ai_plan_for(v_ath_extra);
  IF v_plan <> 'free' THEN
    RAISE EXCEPTION 'ai_plan_for expected free for rank 11 athlete, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete of pro coach with rank N+1 resolves to free');

-- 10. ai_plan_for: athlete of Personal (basic) coach -> not athlete ('free')
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'basic_coach@test.com'), (v_ath, 'ath_basic_c@test.com');
  UPDATE public.users SET plan = 'basic', coach_tier = 'free', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = now() - interval '10 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'free' THEN
    RAISE EXCEPTION 'ai_plan_for expected free for athlete of basic coach, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete of Personal (basic) coach resolves to free');

-- 11. ai_plan_for: athlete of free coach -> not athlete ('free')
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'free_coach@test.com'), (v_ath, 'ath_free_c@test.com');
  UPDATE public.users SET plan = 'free', coach_tier = 'free', paid_until = NULL, is_coach_mode = true WHERE id = v_coach;
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = now() - interval '10 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'free' THEN
    RAISE EXCEPTION 'ai_plan_for expected free for athlete of free coach, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete of free coach resolves to free');

-- 12. ai_plan_for precedence: athlete with own active trial -> trial
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'coach_trial_prec@test.com'), (v_ath, 'ath_trial_prec@test.com');
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  -- Athlete has own active trial (created recently)
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now(), trial_ends_at = now() + interval '14 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'trial' THEN
    RAISE EXCEPTION 'ai_plan_for expected trial for athlete with active trial, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete with own active trial resolves to trial');

-- 13. ai_plan_for precedence: athlete with own basic plan -> basic
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'coach_basic_prec@test.com'), (v_ath, 'ath_basic_prec@test.com');
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  -- Athlete has own paid basic plan
  UPDATE public.users SET plan = 'basic', paid_until = now() + interval '30 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'basic' THEN
    RAISE EXCEPTION 'ai_plan_for expected basic for athlete with basic plan, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete with own basic plan resolves to basic');

-- 14. ai_plan_for precedence: athlete with own pro plan -> pro
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'coach_pro_prec@test.com'), (v_ath, 'ath_pro_prec@test.com');
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  -- Athlete has own paid pro plan
  UPDATE public.users SET plan = 'pro', paid_until = now() + interval '30 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  v_plan := public.ai_plan_for(v_ath);
  IF v_plan <> 'pro' THEN
    RAISE EXCEPTION 'ai_plan_for expected pro for athlete with pro plan, got %', v_plan;
  END IF;
END;
$$;
SELECT pass('ai_plan_for: athlete with own pro plan resolves to pro');

-- 15. Quota configuration JSON values in app_config
DO $$
DECLARE
  v_cfg jsonb;
  v_plans jsonb;
BEGIN
  SELECT value INTO v_cfg FROM public.app_config WHERE key = 'ai_quota_limits';
  v_plans := v_cfg->'plans';

  IF (v_plans->'basic'->>'limit')::integer <> 5 OR v_plans->'basic'->>'period' <> 'day' THEN
    RAISE EXCEPTION 'basic plan quota mismatch: %', v_plans->'basic';
  END IF;

  IF (v_plans->'athlete'->>'limit')::integer <> 5 OR v_plans->'athlete'->>'period' <> 'day' THEN
    RAISE EXCEPTION 'athlete plan quota mismatch: %', v_plans->'athlete';
  END IF;

  IF (v_plans->'pro'->>'limit')::integer <> 30 OR v_plans->'pro'->>'period' <> 'day' THEN
    RAISE EXCEPTION 'pro plan quota mismatch: %', v_plans->'pro';
  END IF;

  IF (v_plans->'trial'->>'limit')::integer <> 30 OR v_plans->'trial'->>'period' <> 'day' THEN
    RAISE EXCEPTION 'trial plan quota mismatch: %', v_plans->'trial';
  END IF;

  IF (v_plans->'free'->>'limit')::integer <> 0 OR v_plans->'free'->>'period' <> 'month' THEN
    RAISE EXCEPTION 'free plan quota mismatch: %', v_plans->'free';
  END IF;

  IF (v_cfg->>'photo_cost')::integer <> 2 THEN
    RAISE EXCEPTION 'photo_cost mismatch: %', v_cfg->>'photo_cost';
  END IF;
END;
$$;
SELECT pass('Quota config: basic (5/day), athlete (5/day), pro (30/day), trial (30/day), free (0/month), photo_cost (2)');

-- 16. consume_ai_quota integration for athlete plan
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_res jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_coach, 'coach_consume_ai@test.com'), (v_ath, 'ath_consume_ai@test.com');
  UPDATE public.users SET plan = 'pro', coach_tier = 'pro', paid_until = now() + interval '30 days', is_coach_mode = true WHERE id = v_coach;
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = now() - interval '10 days' WHERE id = v_ath;

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach, v_ath, 'active', now());

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);

  -- 5 consumes allowed
  FOR i IN 1..5 LOOP
    v_res := public.consume_ai_quota(1);
    IF (v_res->>'allowed')::boolean <> true
       OR v_res->>'plan' <> 'athlete'
       OR (v_res->>'limit')::integer <> 5
       OR (v_res->>'used')::integer <> i
       OR v_res->>'period' <> 'day' THEN
      RAISE EXCEPTION 'Athlete consume % unexpected: %', i, v_res;
    END IF;
  END LOOP;

  -- 6th consume denied
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> false
     OR (v_res->>'used')::integer <> 5
     OR (v_res->>'limit')::integer <> 5 THEN
    RAISE EXCEPTION '6th athlete consume unexpected: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('consume_ai_quota: athlete gets 5/day and is denied on 6th consume');

-- 17. Grandfather extension sets enterprise + 2035 and is idempotent
DO $$
DECLARE
  v_u1 uuid := gen_random_uuid();
  v_u2 uuid := gen_random_uuid();
  v_rec record;
  v_bg record;
  v_target_date constant timestamptz := '2035-10-10T00:00:00Z'::timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_u1, 'gf_test1@test.com'), (v_u2, 'gf_test2@test.com');
  UPDATE public.users SET plan = 'free', coach_tier = 'free', paid_until = now() + interval '10 days' WHERE id = v_u1;
  UPDATE public.users SET plan = 'basic', coach_tier = 'free', paid_until = now() + interval '20 days' WHERE id = v_u2;

  -- Insert pre-existing billing_grandfather rows (as if from earlier migration)
  INSERT INTO public.billing_grandfather (user_id, prev_plan, prev_paid_until, granted_until, granted_at)
  VALUES
    (v_u1, 'free', now() + interval '10 days', now() + interval '1 year', now() - interval '1 day'),
    (v_u2, 'basic', now() + interval '20 days', now() + interval '1 year', now() - interval '1 day');

  -- Run the extension logic
  UPDATE public.billing_grandfather bg
  SET
    prev_coach_tier = coalesce(bg.prev_coach_tier, u.coach_tier),
    prev_granted_until = coalesce(bg.prev_granted_until, bg.granted_until),
    extended_at = coalesce(bg.extended_at, now()),
    granted_until = greatest(bg.granted_until, v_target_date)
  FROM public.users u
  WHERE u.id = bg.user_id AND u.id IN (v_u1, v_u2);

  UPDATE public.users u
  SET
    plan = 'pro',
    coach_tier = 'enterprise',
    paid_until = greatest(coalesce(u.paid_until, now()), v_target_date)
  FROM public.billing_grandfather bg
  WHERE u.id = bg.user_id AND u.id IN (v_u1, v_u2);

  -- Verify User 1
  SELECT plan, coach_tier, paid_until INTO v_rec FROM public.users WHERE id = v_u1;
  SELECT prev_coach_tier, prev_granted_until, granted_until, extended_at INTO v_bg FROM public.billing_grandfather WHERE user_id = v_u1;

  IF v_rec.plan <> 'pro' OR v_rec.coach_tier <> 'enterprise' OR v_rec.paid_until < v_target_date THEN
    RAISE EXCEPTION 'User 1 user record not extended properly: %', v_rec;
  END IF;
  IF v_bg.prev_coach_tier <> 'free' OR v_bg.granted_until < v_target_date OR v_bg.extended_at IS NULL THEN
    RAISE EXCEPTION 'User 1 bg record not extended properly: %', v_bg;
  END IF;

  -- Re-run (idempotency check)
  UPDATE public.billing_grandfather bg
  SET
    prev_coach_tier = coalesce(bg.prev_coach_tier, u.coach_tier),
    prev_granted_until = coalesce(bg.prev_granted_until, bg.granted_until),
    extended_at = coalesce(bg.extended_at, now()),
    granted_until = greatest(bg.granted_until, v_target_date)
  FROM public.users u
  WHERE u.id = bg.user_id AND u.id IN (v_u1, v_u2);

  -- prev_coach_tier must still be 'free', not 'enterprise'
  SELECT prev_coach_tier INTO v_bg FROM public.billing_grandfather WHERE user_id = v_u1;
  IF v_bg.prev_coach_tier <> 'free' THEN
    RAISE EXCEPTION 'Idempotency failure: prev_coach_tier overwritten with %', v_bg.prev_coach_tier;
  END IF;
END;
$$;
SELECT pass('Grandfather extension sets plan pro, coach_tier enterprise, paid_until 2035 and is idempotent');

-- 18. grandfather_user grants one user Coach Pro until 2035 and not others
DO $$
DECLARE
  v_grant_uid uuid := gen_random_uuid();
  v_other_uid uuid := gen_random_uuid();
  v_res boolean;
  v_user_rec record;
  v_bg_rec record;
  v_target_date constant timestamptz := '2035-10-10T00:00:00Z'::timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_grant_uid, 'gfu_target@test.com'), (v_other_uid, 'gfu_other@test.com');
  UPDATE public.users SET plan = 'basic', coach_tier = 'free', paid_until = now() + interval '5 days' WHERE id = v_grant_uid;
  UPDATE public.users SET plan = 'free', coach_tier = 'free', paid_until = NULL WHERE id = v_other_uid;

  -- Run grandfather_user as service_role
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_res := public.grandfather_user(v_grant_uid);
  IF v_res IS NOT TRUE THEN
    RAISE EXCEPTION 'grandfather_user returned false on initial grant';
  END IF;

  -- Re-run on same user -> false (idempotent, no changes)
  v_res := public.grandfather_user(v_grant_uid);
  IF v_res IS NOT FALSE THEN
    RAISE EXCEPTION 'grandfather_user returned true on idempotent second call';
  END IF;

  -- Check granted user
  SELECT plan, coach_tier, paid_until INTO v_user_rec FROM public.users WHERE id = v_grant_uid;
  SELECT prev_plan, prev_coach_tier, granted_until INTO v_bg_rec FROM public.billing_grandfather WHERE user_id = v_grant_uid;

  IF v_user_rec.plan <> 'pro' OR v_user_rec.coach_tier <> 'enterprise' OR v_user_rec.paid_until < v_target_date THEN
    RAISE EXCEPTION 'Target user not upgraded to Coach Pro: %', v_user_rec;
  END IF;
  IF v_bg_rec.prev_plan <> 'basic' OR v_bg_rec.prev_coach_tier <> 'free' OR v_bg_rec.granted_until < v_target_date THEN
    RAISE EXCEPTION 'Target billing_grandfather record invalid: %', v_bg_rec;
  END IF;

  -- Verify other user is completely untouched
  SELECT plan, coach_tier, paid_until INTO v_user_rec FROM public.users WHERE id = v_other_uid;
  IF v_user_rec.plan <> 'free' OR v_user_rec.coach_tier <> 'free' OR v_user_rec.paid_until IS NOT NULL THEN
    RAISE EXCEPTION 'Other user was unintentionally modified: %', v_user_rec;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('grandfather_user grants Coach Pro until 2035 to single targeted user without affecting others');

SELECT * FROM finish();
ROLLBACK;
