DROP FUNCTION IF EXISTS public.get_ghost_sets(uuid, date);

NOTIFY pgrst, 'reload schema';
