-- Migration: 20260906020000_user_timer_settings.sql
-- Description: Add auto_rest_timer column to public.users and update handle_new_user()

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auto_rest_timer boolean DEFAULT true NOT NULL;

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
    auto_rest_timer
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
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(public.users.username, EXCLUDED.username);
  RETURN NEW;
END;
$$;
