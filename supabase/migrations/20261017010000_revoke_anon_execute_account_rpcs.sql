-- Migration: 20261017010000_revoke_anon_execute_account_rpcs.sql
-- Description: Revoke EXECUTE on security definer account mutation RPCs from public and anon.
-- Explicitly grant EXECUTE to authenticated and service_role.

-- 1. disconnect_coach
REVOKE EXECUTE ON FUNCTION public.disconnect_coach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_coach(uuid) TO authenticated, service_role;

-- 2. update_athlete_macros
REVOKE EXECUTE ON FUNCTION public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- 3. set_coach_code
REVOKE EXECUTE ON FUNCTION public.set_coach_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_coach_code(text) TO authenticated, service_role;

-- 4. save_routine_template
REVOKE EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
