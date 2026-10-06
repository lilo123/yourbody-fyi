BEGIN;
SELECT plan(17);

-- 1. A linked coach can read their athlete's custom exercise.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'exrls_coach1@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'exrls_ath1@test.com', '{"role":"athlete"}'::jsonb);
  UPDATE public.users SET coach_code = 'YB-EXRLS1', is_coach_mode = true WHERE id = v_coach_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-EXRLS1');

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Athlete Custom Zercher Carry', ARRAY['Legs'], false, v_ath_id)
  RETURNING id INTO v_ex_id;

  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_coach_id AND role = 'coach') THEN
    RAISE EXCEPTION 'Fixture invalid: coach has role = coach, so is_coach() would mask the defect';
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ex_id;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Linked coach cannot read athlete custom exercise (saw % rows)', v_seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Linked coach can read their athlete custom exercise');

-- 2. A linked athlete can read a coach-authored custom exercise their sets reference.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'exrls_coach2@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'exrls_ath2@test.com', '{"role":"athlete"}'::jsonb);
  UPDATE public.users SET coach_code = 'YB-EXRLS2', is_coach_mode = true WHERE id = v_coach_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-EXRLS2');

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Coach Prescribed Landmine Press', ARRAY['Shoulders'], false, v_coach_id)
  RETURNING id INTO v_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ex_id;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Linked athlete cannot read coach-authored custom exercise (saw % rows)', v_seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Linked athlete can read coach-authored custom exercise');

-- 3. SECURITY GUARD: an unlinked stranger can read neither party's custom exercise.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_stranger_id uuid := gen_random_uuid();
  v_ath_ex_id uuid;
  v_coach_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'exrls_coach3@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'exrls_ath3@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_stranger_id, 'exrls_stranger@test.com', '{"role":"athlete"}'::jsonb);
  UPDATE public.users SET coach_code = 'YB-EXRLS3', is_coach_mode = true WHERE id = v_coach_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-EXRLS3');

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Athlete Private Movement', ARRAY['Back'], false, v_ath_id) RETURNING id INTO v_ath_ex_id;
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Coach Private Movement', ARRAY['Chest'], false, v_coach_id) RETURNING id INTO v_coach_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_stranger_id || '"}', true);

  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ath_ex_id;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Security breach: unlinked stranger can read athlete custom exercise!';
  END IF;

  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_coach_ex_id;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Security breach: unlinked stranger can read coach custom exercise!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id IN (v_ath_ex_id, v_coach_ex_id);
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id, v_stranger_id);
END;
$$;
SELECT pass('Unlinked stranger cannot read either party custom exercise');

-- 4. Master exercises remain readable by any authenticated user.
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_master_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user_id, 'exrls_plain@test.com', '{"role":"athlete"}'::jsonb);

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;
  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'Fixture invalid: no master exercise present to test against';
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_master_id;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Master exercise not readable by plain authenticated user';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
SELECT pass('Master exercises remain readable by any authenticated user');

-- 5. Master exercises are visible to all roles (athlete, platform coach, multi-coach).
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_pcoach_id uuid := gen_random_uuid();
  v_mcoach_id uuid := gen_random_uuid();
  v_master_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'role_ath@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_pcoach_id, 'role_pcoach@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_pcoach_id;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_mcoach_id, 'role_mcoach@test.com', '{"role":"athlete"}'::jsonb);
  UPDATE public.users SET is_coach_mode = true WHERE id = v_mcoach_id;

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;

  -- Check athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_master_id;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Athlete cannot see master exercise'; END IF;

  -- Check platform coach
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_pcoach_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_master_id;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Platform coach cannot see master exercise'; END IF;

  -- Check multi-coach
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_mcoach_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_master_id;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Multi-coach cannot see master exercise'; END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_ath_id, v_pcoach_id, v_mcoach_id);
END;
$$;
SELECT pass('Master exercises are visible to all roles (athlete, platform coach, multi-coach)');

-- 6. Own custom exercises are visible to the owner.
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'own_ath@test.com', '{"role":"athlete"}'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('My Own Custom Movement', ARRAY['Arms'], false, v_ath_id) RETURNING id INTO v_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ex_id;
  IF v_seen <> 1 THEN RAISE EXCEPTION 'Owner cannot see their own custom exercise'; END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id = v_ath_id;
END;
$$;
SELECT pass('Own custom exercises are visible to the owner');

-- 7. UNLINKED coach (role=coach) sees nothing from other users' custom exercises.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_ath_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'unlinked_pcoach@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'unlinked_ath@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Unlinked Athlete Exercise', ARRAY['Chest'], false, v_ath_id) RETURNING id INTO v_ath_ex_id;

  -- The unlinked platform coach queries
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ath_ex_id;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'W50 breach: unlinked platform coach saw athlete custom exercise (saw % rows)', v_seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ath_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('UNLINKED coach sees 0 rows of other users custom exercises');

-- 8. ENDED-link coach (status=disconnected) sees 0 rows of former athlete's custom exercises.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_link_id uuid;
  v_ath_ex_id uuid;
  v_seen int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'ended_coach@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ended_ath@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, disconnected_at)
  VALUES (v_coach_id, v_ath_id, 'disconnected', now()) RETURNING id INTO v_link_id;

  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Ended Link Custom Exercise', ARRAY['Legs'], false, v_ath_id) RETURNING id INTO v_ath_ex_id;

  -- The disconnected coach queries
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen FROM public.exercises WHERE id = v_ath_ex_id;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Ended-link coach saw athlete custom exercise (saw % rows)', v_seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.coach_athlete_links WHERE id = v_link_id;
  DELETE FROM public.exercises WHERE id = v_ath_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('ENDED-link coach sees 0 rows of former athletes custom exercises');

-- 9. Coach UPDATE on a master exercise affects 0 rows (masters read-only).
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_master_id uuid;
  v_rows_updated int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_upd_master@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  UPDATE public.exercises SET name = 'Coach Renamed Master' WHERE id = v_master_id;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated <> 0 THEN
    RAISE EXCEPTION 'L1 breach: coach updated master exercise (% rows affected)', v_rows_updated;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('Coach UPDATE on a master exercise affects 0 rows');

-- 10. Coach UPDATE on another user custom exercise affects 0 rows (no coach edit).
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_ath_ex_id uuid;
  v_rows_updated int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_upd_ath@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_target@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Athlete Inviolable Custom', ARRAY['Shoulders'], false, v_ath_id) RETURNING id INTO v_ath_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  UPDATE public.exercises SET name = 'Coach Tampered Name' WHERE id = v_ath_ex_id;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated <> 0 THEN
    RAISE EXCEPTION 'RD-10 breach: coach updated athlete custom exercise (% rows affected)', v_rows_updated;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ath_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Coach UPDATE on another user custom exercise affects 0 rows');

-- 11. Coach DELETE on a master exercise affects 0 rows.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_master_id uuid;
  v_rows_deleted int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_del_master@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  DELETE FROM public.exercises WHERE id = v_master_id;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  IF v_rows_deleted <> 0 THEN
    RAISE EXCEPTION 'L1 breach: coach deleted master exercise (% rows affected)', v_rows_deleted;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('Coach DELETE on a master exercise affects 0 rows');

-- 12. Coach DELETE on another user custom exercise affects 0 rows.
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_ath_ex_id uuid;
  v_rows_deleted int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_del_ath@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_target_del@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Athlete Exercise To Delete', ARRAY['Back'], false, v_ath_id) RETURNING id INTO v_ath_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  DELETE FROM public.exercises WHERE id = v_ath_ex_id;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  IF v_rows_deleted <> 0 THEN
    RAISE EXCEPTION 'Coach deleted athlete custom exercise (% rows affected)', v_rows_deleted;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ath_ex_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Coach DELETE on another user custom exercise affects 0 rows');

-- 13. Owner cannot insert exercise with is_master=true.
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_failed boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_master_ins@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);

  BEGIN
    INSERT INTO public.exercises (name, body_parts, is_master, user_id)
    VALUES ('Illegal Master Attempt', ARRAY['Chest'], true, v_ath_id);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'Security breach: authenticated user inserted is_master=true exercise!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE name = 'Illegal Master Attempt';
  DELETE FROM auth.users WHERE id = v_ath_id;
END;
$$;
SELECT pass('Authenticated owner cannot insert exercise with is_master=true');

-- 14. Owner cannot update own exercise to flip is_master to true.
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_failed boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_master_upd@test.com', '{"role":"athlete"}'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Legit Custom Exercise', ARRAY['Legs'], false, v_ath_id) RETURNING id INTO v_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);

  BEGIN
    UPDATE public.exercises SET is_master = true WHERE id = v_ex_id;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_failed := true;
  END;

  IF NOT v_failed THEN
    RAISE EXCEPTION 'Security breach: authenticated user updated custom exercise to is_master=true!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id = v_ath_id;
END;
$$;
SELECT pass('Authenticated owner cannot update own exercise to is_master=true');

-- 15. No DELETE for authenticated: owner cannot delete own exercise (affects 0 rows).
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_rows_deleted int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_no_del@test.com', '{"role":"athlete"}'::jsonb);
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Undeletable Custom Exercise', ARRAY['Arms'], false, v_ath_id) RETURNING id INTO v_ex_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);

  DELETE FROM public.exercises WHERE id = v_ex_id;
  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  IF v_rows_deleted <> 0 THEN
    RAISE EXCEPTION 'L3 breach: authenticated user was able to DELETE exercise (% rows deleted)', v_rows_deleted;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id = v_ath_id;
END;
$$;
SELECT pass('No DELETE policy for authenticated: delete affects 0 rows');

-- 16. Blank or whitespace name rejected on INSERT and UPDATE (CHECK length(trim(name)) > 0).
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_blank_ins_failed boolean := false;
  v_space_ins_failed boolean := false;
  v_space_upd_failed boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'blank_name_ath@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);

  -- Test blank insert
  BEGIN
    INSERT INTO public.exercises (name, body_parts, is_master, user_id)
    VALUES ('', ARRAY['Chest'], false, v_ath_id);
  EXCEPTION WHEN check_violation THEN
    v_blank_ins_failed := true;
  END;

  -- Test whitespace-only insert
  BEGIN
    INSERT INTO public.exercises (name, body_parts, is_master, user_id)
    VALUES ('   ', ARRAY['Chest'], false, v_ath_id);
  EXCEPTION WHEN check_violation THEN
    v_space_ins_failed := true;
  END;

  -- Insert a valid exercise then test whitespace update
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Valid Name', ARRAY['Chest'], false, v_ath_id) RETURNING id INTO v_ex_id;

  BEGIN
    UPDATE public.exercises SET name = '   ' WHERE id = v_ex_id;
  EXCEPTION WHEN check_violation THEN
    v_space_upd_failed := true;
  END;

  IF NOT (v_blank_ins_failed AND v_space_ins_failed AND v_space_upd_failed) THEN
    RAISE EXCEPTION 'L12 breach: blank/whitespace name was accepted (blank_ins=%, space_ins=%, space_upd=%)',
      v_blank_ins_failed, v_space_ins_failed, v_space_upd_failed;
  END IF;

  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id = v_ath_id;
END;
$$;
SELECT pass('Blank or whitespace name rejected on INSERT and UPDATE (CHECK constraint)');

-- 17. Deleting an exercise referenced by template_exercises is refused (RESTRICT).
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ex_id uuid;
  v_tpl_id uuid;
  v_te_id uuid;
  v_fk_refused boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user_id, 'fk_restrict_user@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Referenced By Template', ARRAY['Back'], false, v_user_id) RETURNING id INTO v_ex_id;

  INSERT INTO public.routine_templates (user_id, name)
  VALUES (v_user_id, 'Template Referencing Exercise') RETURNING id INTO v_tpl_id;

  INSERT INTO public.template_exercises (template_id, exercise_id, order_index)
  VALUES (v_tpl_id, v_ex_id, 0) RETURNING id INTO v_te_id;

  -- Attempt to delete exercise referenced by template_exercises
  BEGIN
    DELETE FROM public.exercises WHERE id = v_ex_id;
  EXCEPTION WHEN foreign_key_violation THEN
    v_fk_refused := true;
  END;

  IF NOT v_fk_refused THEN
    RAISE EXCEPTION 'L3 breach: deleting exercise referenced by template_exercises succeeded (CASCADE occurred instead of RESTRICT)!';
  END IF;

  DELETE FROM public.template_exercises WHERE id = v_te_id;
  DELETE FROM public.routine_templates WHERE id = v_tpl_id;
  DELETE FROM public.exercises WHERE id = v_ex_id;
  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
SELECT pass('Deleting exercise referenced by template_exercises is refused with RESTRICT');

SELECT * FROM finish();
ROLLBACK;
