-- Rollback 20260927040000_history_rpcs_v2.down.sql
-- Restores pre-migration M5 state by dropping the two new RPCs.

DROP FUNCTION IF EXISTS public.get_history_sessions_v2(uuid, date, date, uuid, int);
DROP FUNCTION IF EXISTS public.get_exercise_history(uuid, uuid, date, date, int);

NOTIFY pgrst, 'reload schema';
