-- Migration: 20261010050000_grandfather_existing_users.sql
-- Description: Grandfather existing users to Pro for one year with audit table and idempotent function.

-- 1. Create audit table for grandfathered users
CREATE TABLE IF NOT EXISTS public.billing_grandfather (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  prev_plan text NULL,
  prev_paid_until timestamptz NULL,
  granted_until timestamptz NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Lock down billing_grandfather with RLS (no policies, accessible only to database owner / admin)
ALTER TABLE public.billing_grandfather ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_grandfather FROM public, anon, authenticated;

-- 3. Idempotent function to grant existing users one year of Pro
CREATE OR REPLACE FUNCTION public.grandfather_existing_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_granted_count integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.billing_grandfather (user_id, prev_plan, prev_paid_until, granted_until)
    SELECT
      id,
      plan,
      paid_until,
      greatest(coalesce(paid_until, now()), now() + interval '1 year')
    FROM public.users
    ON CONFLICT (user_id) DO NOTHING
    RETURNING user_id, granted_until
  )
  UPDATE public.users u
  SET plan = 'pro',
      paid_until = ins.granted_until
  FROM ins
  WHERE u.id = ins.user_id;

  GET DIAGNOSTICS v_granted_count = ROW_COUNT;
  RETURN coalesce(v_granted_count, 0);
END;
$$;

-- 4. Restrict execute privileges: only database owner/postgres can execute
REVOKE ALL ON FUNCTION public.grandfather_existing_users() FROM PUBLIC, anon, authenticated, service_role;

-- 5. Execute grandfathering grant once for all existing users
SELECT public.grandfather_existing_users();

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
