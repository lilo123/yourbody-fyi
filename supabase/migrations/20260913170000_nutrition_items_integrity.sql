-- ============================================================================
-- Nutrition hierarchy — Phase 5: integrity hardening
-- ----------------------------------------------------------------------------
-- Declarative enforcement of `parent = SUM(items)` on both tables, plus the
-- non-negative macro guards that custom_dishes has never had.
--
-- Deliberately a SEPARATE migration from Phase 2, and deliberately applied
-- AFTER the client is deployed and verified, because this is the only part of
-- the change that can make a previously-successful write start failing.
--
-- *** READ THIS BEFORE APPLYING TO PRODUCTION (R-31) ***
-- The Android client bakes a frozen copy of dist/ into the APK
-- (capacitor.config.ts, webDir: 'dist', no server.url). An APK built before
-- this feature rewrites parent macros and leaves `items` stale — exactly the
-- shape chk_*_parent_equals_items_sum rejects — and EditMealModal surfaces the
-- rejection as a raw Postgres string. Either `npx cap sync && ./gradlew
-- assemble` and install first, or knowingly defer this migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. D-3: items win.
--
--    Reconcile any parent whose stored macros disagree with the sum of its own
--    components. The one known case is a user's "Berry Cherry Smoothie":
--    fiber 11.9 -> 12.4, a +0.5 delta. Four of its five macros are bit-exact
--    and every one of its items has portionMultiplier == 1, which is the
--    signature of a model arithmetic slip rather than a user edit.
--
--    This is a precondition for VALIDATE on custom_dishes, not on
--    nutrition_logs (which gets no backfill, so every row there has
--    items IS NULL and validates trivially).
--
--    Idempotent: re-running changes zero rows.
-- ----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cd.id, cd.name, cd.user_id,
           COALESCE(cd.calories, 0) AS cal, private.items_macro_sum(cd.items, 'calories') AS s_cal,
           COALESCE(cd.protein,  0) AS pro, private.items_macro_sum(cd.items, 'protein')  AS s_pro,
           COALESCE(cd.carbs,    0) AS car, private.items_macro_sum(cd.items, 'carbs')    AS s_car,
           COALESCE(cd.fat,      0) AS fat, private.items_macro_sum(cd.items, 'fat')      AS s_fat,
           COALESCE(cd.fiber,    0) AS fib, private.items_macro_sum(cd.items, 'fiber')    AS s_fib
      FROM public.custom_dishes cd
     WHERE cd.items IS NOT NULL
  LOOP
    IF r.cal <> r.s_cal OR r.pro <> r.s_pro OR r.car <> r.s_car
       OR r.fat <> r.s_fat OR r.fib <> r.s_fib THEN
      RAISE NOTICE 'D-3 reconcile: dish "%" (id %, owner %) kcal %->% P %->% C %->% F %->% Fib %->%',
        r.name, r.id, r.user_id,
        r.cal, r.s_cal, r.pro, r.s_pro, r.car, r.s_car, r.fat, r.s_fat, r.fib, r.s_fib;
      UPDATE public.custom_dishes
         SET calories = r.s_cal, protein = r.s_pro, carbs = r.s_car,
             fat = r.s_fat, fiber = r.s_fib
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT nl.id, nl.food_name, nl.user_id,
           nl.calories                AS cal, private.items_macro_sum(nl.items, 'calories') AS s_cal,
           COALESCE(nl.protein, 0)    AS pro, private.items_macro_sum(nl.items, 'protein')  AS s_pro,
           COALESCE(nl.carbs,   0)    AS car, private.items_macro_sum(nl.items, 'carbs')    AS s_car,
           COALESCE(nl.fat,     0)    AS fat, private.items_macro_sum(nl.items, 'fat')      AS s_fat,
           COALESCE(nl.fiber,   0)    AS fib, private.items_macro_sum(nl.items, 'fiber')    AS s_fib
      FROM public.nutrition_logs nl
     WHERE nl.items IS NOT NULL
  LOOP
    IF r.cal <> r.s_cal OR r.pro <> r.s_pro OR r.car <> r.s_car
       OR r.fat <> r.s_fat OR r.fib <> r.s_fib THEN
      RAISE NOTICE 'D-3 reconcile: log "%" (id %, owner %) kcal %->% Fib %->%',
        r.food_name, r.id, r.user_id, r.cal, r.s_cal, r.fib, r.s_fib;
      UPDATE public.nutrition_logs
         SET calories = r.s_cal, protein = r.s_pro, carbs = r.s_car,
             fat = r.s_fat, fiber = r.s_fib
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. The Sigma invariant.
--
--    The epsilon is item-count-aware: 0.05 * jsonb_array_length(items). A fixed
--    0.05 is breachable by per-item rounding dust on a large dish. Even scaled,
--    a 7-item dish gets 0.35, which is tighter than the 0.5 drift that was
--    actually observed — so this form would have caught it.
--
--    jsonb_typeof(items) = 'array' is repeated INSIDE this constraint rather
--    than left to chk_*_items_shape. CHECKs are evaluated in constraint-name
--    order; without the local guard, `items = '{"a":1}'` raises
--    `cannot get array length of a non-array` instead of a clean violation,
--    purely as an artefact of how the two names sort.
-- ----------------------------------------------------------------------------

-- nutrition_logs.calories is NOT NULL, so it is compared bare.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_nl_parent_equals_items_sum'
      AND conrelid = 'public.nutrition_logs'::regclass
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT chk_nl_parent_equals_items_sum CHECK (
        items IS NULL OR (
              jsonb_typeof(items) = 'array'
          AND abs(calories            - private.items_macro_sum(items, 'calories')) <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(protein,0) - private.items_macro_sum(items, 'protein'))  <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(carbs,0)   - private.items_macro_sum(items, 'carbs'))    <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(fat,0)     - private.items_macro_sum(items, 'fat'))      <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(fiber,0)   - private.items_macro_sum(items, 'fiber'))    <= 0.05 * jsonb_array_length(items)
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.nutrition_logs VALIDATE CONSTRAINT chk_nl_parent_equals_items_sum;

-- custom_dishes: every macro is nullable here, including calories.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cd_parent_equals_items_sum'
      AND conrelid = 'public.custom_dishes'::regclass
  ) THEN
    ALTER TABLE public.custom_dishes
      ADD CONSTRAINT chk_cd_parent_equals_items_sum CHECK (
        items IS NULL OR (
              jsonb_typeof(items) = 'array'
          AND abs(COALESCE(calories,0) - private.items_macro_sum(items, 'calories')) <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(protein,0)  - private.items_macro_sum(items, 'protein'))  <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(carbs,0)    - private.items_macro_sum(items, 'carbs'))    <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(fat,0)      - private.items_macro_sum(items, 'fat'))      <= 0.05 * jsonb_array_length(items)
          AND abs(COALESCE(fiber,0)    - private.items_macro_sum(items, 'fiber'))    <= 0.05 * jsonb_array_length(items)
        )
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.custom_dishes VALIDATE CONSTRAINT chk_cd_parent_equals_items_sum;

-- ----------------------------------------------------------------------------
-- 3. custom_dishes has had ZERO check constraints since it was created, while
--    nutrition_logs has five. handleSaveCustomDishModal writes `Number(x) || 0`
--    with no clamp, and Number('-50') || 0 === -50, so a negative custom dish
--    is writable today. Close the gap (R-30).
-- ----------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['calories','protein','carbs','fat','fiber'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'chk_cd_' || c || '_non_negative'
        AND conrelid = 'public.custom_dishes'::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.custom_dishes ADD CONSTRAINT %I CHECK (%I IS NULL OR %I >= 0)',
        'chk_cd_' || c || '_non_negative', c, c);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
