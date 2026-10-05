-- Fix Coach RLS Check for local development and missing JWT claims
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'coach'
  ) OR ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'coach')
    OR ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin')
    -- Fail-safe for local development using dummy coach user id
    OR auth.uid() = '00000000-0000-0000-0000-000000000001';
$$;
