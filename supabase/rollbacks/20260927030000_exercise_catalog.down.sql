-- Rollback 20260927030000_exercise_catalog.down.sql
-- Restores pre-migration M4 state for public.exercises, public.exercise_hides, and RPCs.

-- 1. Drop RPCs
DROP FUNCTION IF EXISTS public.get_routine_catalog(uuid, text, int, text);
DROP FUNCTION IF EXISTS public.get_exercise_catalog(text, text, text, boolean, int, text);

-- 2. Drop trigger and helper functions
DROP TRIGGER IF EXISTS trg_sync_exercise_body_parts ON public.exercises;
DROP FUNCTION IF EXISTS public.sync_exercise_body_parts();
DROP FUNCTION IF EXISTS public.normalize_exercise_body_parts(text[]);
DROP FUNCTION IF EXISTS public.parse_exercise_body_parts(text);

-- 3. Drop table exercise_hides and policies
DROP TABLE IF EXISTS public.exercise_hides CASCADE;

-- 4. Drop indexes
DROP INDEX IF EXISTS public.idx_exercises_name_lower;
DROP INDEX IF EXISTS public.idx_exercises_equipment;
DROP INDEX IF EXISTS public.idx_exercises_body_parts;

-- 5. Drop constraint and columns from public.exercises
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_equipment_check;

ALTER TABLE public.exercises
  DROP COLUMN IF EXISTS equipment,
  DROP COLUMN IF EXISTS body_parts;

NOTIFY pgrst, 'reload schema';
