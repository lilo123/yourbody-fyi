-- Migration: 20260923020000_backfill_logged_date.sql
-- Description: Backfill public.nutrition_logs.logged_date for users with a known timezone.
-- In migration 20260923010000_nutrition_logged_date.sql, step 1 unconditionally cleared
-- public.users.timezone (SET timezone = NULL) before step 3's backfill ran.
-- Because step 3 was gated on `u.timezone IS NOT NULL`, that backfill statement was an accidental
-- no-op and matched zero rows.
-- This migration re-runs the backfill now that users have populated timezones.
-- It is idempotent and leaves rows with no user timezone as NULL (which are backfilled
-- upon next login via the trg_backfill_nutrition_logged_date_on_user_tz trigger).

UPDATE public.nutrition_logs n
SET logged_date = (n.logged_at AT TIME ZONE u.timezone)::date
FROM public.users u
WHERE n.user_id = u.id
  AND u.timezone IS NOT NULL
  AND n.logged_date IS NULL;
