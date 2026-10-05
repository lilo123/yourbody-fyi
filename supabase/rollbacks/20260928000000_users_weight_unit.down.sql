-- Rollback: 20260928000000_users_weight_unit.down.sql
-- Restores pre-migration M6 state by dropping weight_unit column from public.users.

ALTER TABLE public.users DROP COLUMN IF EXISTS weight_unit;

NOTIFY pgrst, 'reload schema';
