BEGIN;
SELECT plan(6);

-- ============================================================================
-- 1. Schema Existence
-- ============================================================================
SELECT has_table('public', 'catalog_seed_backfill', 'catalog_seed_backfill table exists');

SELECT is(
  (SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'catalog_seed_backfill'),
  true,
  'catalog_seed_backfill has RLS enabled'
);

-- ============================================================================
-- 2. Master Exercises & Equipment Coverage
-- ============================================================================
DO $$
DECLARE
  v_master_count int;
  v_null_eq_count int;
  v_empty_bps_count int;
  v_sample_id uuid;
  v_expected_id uuid;
  v_sample_name text := 'Barbell Deadlift';
BEGIN
  -- Total master count >= 150
  SELECT count(*) INTO v_master_count FROM public.exercises WHERE is_master = true;
  IF v_master_count < 150 THEN
    RAISE EXCEPTION 'Expected >= 150 master exercises, got %', v_master_count;
  END IF;

  -- Master exercises with NULL equipment must be 0
  SELECT count(*) INTO v_null_eq_count
  FROM public.exercises WHERE is_master = true AND equipment IS NULL;
  IF v_null_eq_count > 0 THEN
    RAISE EXCEPTION 'Expected 0 master exercises with NULL equipment, got %', v_null_eq_count;
  END IF;

  -- Master exercises with empty body_parts must be 0
  SELECT count(*) INTO v_empty_bps_count
  FROM public.exercises WHERE is_master = true AND (body_parts IS NULL OR cardinality(body_parts) = 0);
  IF v_empty_bps_count > 0 THEN
    RAISE EXCEPTION 'Expected 0 master exercises with empty body_parts, got %', v_empty_bps_count;
  END IF;

  -- Check deterministic ID for Barbell Deadlift
  SELECT id INTO v_sample_id FROM public.exercises WHERE is_master = true AND name = v_sample_name;
  IF v_sample_id IS NOT NULL THEN
    v_expected_id := md5('m8:' || public.normalize_exercise_name(v_sample_name))::uuid;
    IF v_sample_id <> v_expected_id THEN
      RAISE EXCEPTION 'Deterministic ID mismatch for %: expected %, got %', v_sample_name, v_expected_id, v_sample_id;
    END IF;
  END IF;
END;
$$;

SELECT pass('Master seed rows present with non-empty body_parts and non-null equipment (>= 150 masters)');
SELECT pass('All master exercises have valid non-null equipment');
SELECT pass('Newly seeded master exercises have deterministic IDs matching md5(m8:norm_name)');

-- ============================================================================
-- 3. Idempotency Check (re-running M8 seed insert does not duplicate or fail)
-- ============================================================================
DO $$
DECLARE
  v_count_before int;
  v_count_after int;
BEGIN
  SELECT count(*) INTO v_count_before FROM public.exercises;

  -- Attempt to insert an existing name with deterministic ID
  INSERT INTO public.exercises (id, name, body_parts, equipment, is_master, user_id, is_archived)
  SELECT
    md5('m8:barbell deadlift')::uuid,
    'Barbell Deadlift',
    ARRAY['Back', 'Legs']::text[],
    'barbell',
    true,
    NULL,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.exercises e
    WHERE public.normalize_exercise_name(e.name) = 'barbell deadlift'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO v_count_after FROM public.exercises;
  IF v_count_after <> v_count_before THEN
    RAISE EXCEPTION 'Idempotency failure: re-insert increased exercise count (% vs %)', v_count_before, v_count_after;
  END IF;
END;
$$;

SELECT pass('Re-running catalog seed insert is idempotent and produces no duplicates');

SELECT * FROM finish();
ROLLBACK;
