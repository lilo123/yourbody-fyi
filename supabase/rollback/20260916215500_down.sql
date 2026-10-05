DROP FUNCTION IF EXISTS public.get_exercise_stats(uuid);
DROP FUNCTION IF EXISTS public.get_history_sessions(uuid, int, int);
NOTIFY pgrst, 'reload schema';
