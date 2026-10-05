ALTER TABLE public.nutrition_logs DROP COLUMN IF EXISTS has_components;
NOTIFY pgrst, 'reload schema';
