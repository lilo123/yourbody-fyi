-- Migration: 20260923000000_user_timezone.sql
-- Description: Add timezone column to public.users and update handle_new_user()

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone text;

-- Loose sanity check on IANA timezone name format:
-- Non-empty, max 64 characters, and contains no whitespace characters.
-- We avoid hardcoding specific region/zone names because the IANA database evolves over time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_timezone_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_timezone_check
      CHECK (timezone IS NULL OR (length(timezone) > 0 AND length(timezone) <= 64 AND timezone !~ '\s'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    username,
    role,
    target_calories,
    target_protein,
    target_carbs,
    target_fat,
    target_fiber,
    auto_rest_timer,
    timezone
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    -- Security: Only trust service_role / app_metadata for 'coach' role; self-signups default to 'athlete'
    CASE
      WHEN NEW.raw_app_meta_data->>'role' = 'coach' THEN 'coach'
      ELSE 'athlete'
    END,
    2200,
    160,
    220,
    70,
    30,
    true,
    NEW.raw_user_meta_data->>'timezone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(public.users.username, EXCLUDED.username);
  RETURN NEW;
END;
$$;

