-- Phase 1 Migration: Macro Target Settings Engine & Fiber Column Additions

-- 1. Add target_fiber to public.users
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS target_fiber numeric DEFAULT 30;

-- 2. Add fiber to public.custom_dishes
ALTER TABLE public.custom_dishes
  ADD COLUMN IF NOT EXISTS fiber numeric DEFAULT 0;

-- 3. Update handle_new_user() trigger function to initialize target_fiber
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'athlete'),
    2200, 160, 220, 70, 30
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(public.users.username, EXCLUDED.username),
    role = COALESCE(public.users.role, EXCLUDED.role);
  RETURN NEW;
END;
$$;
