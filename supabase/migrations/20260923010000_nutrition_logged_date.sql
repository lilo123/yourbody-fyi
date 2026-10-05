-- Migration: 20260923010000_nutrition_logged_date.sql
-- Description: Add civil logged_date column to public.nutrition_logs and auto-sync triggers without hardcoded timezones

-- 1. (removed) An earlier revision of this file ran `UPDATE public.users SET timezone = NULL;`
--    unconditionally, to clear hardcoded timezone values seeded by a since-corrected revision of
--    20260923000000_user_timezone.sql. Those seeds were removed from that file in commit 3eb892e,
--    so on every future replay (DR restore, `supabase db reset`, a fresh environment) the wipe had
--    nothing left to undo and would only have destroyed real device-synced timezones -- which in
--    turn silently skips the logged_date backfill below for those users. Its one-time effect on
--    production is already recorded in supabase_migrations.schema_migrations; this migration is
--    never re-run there. users.timezone is populated exclusively by each user's own device.

-- 2. Add logged_date (nullable for legacy rows until the user's real device timezone is synced)
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS logged_date date;

-- 3. Backfill logged_date ONLY for users whose real timezone is already recorded
UPDATE public.nutrition_logs n
SET logged_date = (n.logged_at AT TIME ZONE u.timezone)::date
FROM public.users u
WHERE n.user_id = u.id
  AND u.timezone IS NOT NULL
  AND n.logged_date IS NULL;

-- 4. Trigger on nutrition_logs: if logged_date is omitted on INSERT/UPDATE and the user has a known timezone, derive logged_date in that timezone
CREATE OR REPLACE FUNCTION public.set_nutrition_logged_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_tz text;
BEGIN
  IF NEW.logged_date IS NULL THEN
    SELECT timezone INTO v_user_tz FROM public.users WHERE id = NEW.user_id;
    IF v_user_tz IS NOT NULL THEN
      NEW.logged_date := (COALESCE(NEW.logged_at, now()) AT TIME ZONE v_user_tz)::date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_nutrition_logged_date ON public.nutrition_logs;
CREATE TRIGGER trg_set_nutrition_logged_date
  BEFORE INSERT OR UPDATE ON public.nutrition_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_nutrition_logged_date();

-- 5. Trigger on users: when a user's device syncs users.timezone for the first time, backfill any NULL logged_date rows for that user
CREATE OR REPLACE FUNCTION public.backfill_nutrition_logged_date_on_user_tz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.timezone IS NOT NULL AND (OLD.timezone IS NULL OR OLD.timezone IS DISTINCT FROM NEW.timezone) THEN
    UPDATE public.nutrition_logs
    SET logged_date = (logged_at AT TIME ZONE NEW.timezone)::date
    WHERE user_id = NEW.id
      AND logged_date IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_nutrition_logged_date_on_user_tz ON public.users;
CREATE TRIGGER trg_backfill_nutrition_logged_date_on_user_tz
  AFTER INSERT OR UPDATE OF timezone ON public.users
  FOR EACH ROW
  WHEN (NEW.timezone IS NOT NULL)
  EXECUTE FUNCTION public.backfill_nutrition_logged_date_on_user_tz();

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_logged_date
  ON public.nutrition_logs(user_id, logged_date DESC, logged_at DESC);

