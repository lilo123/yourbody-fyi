-- Migration: 20260928000000_users_weight_unit.sql
-- Description: M6 add weight_unit preference to public.users table ('lb' | 'kg')
-- Default 'lb', NOT NULL, CHECK constraint ('lb', 'kg').
-- Storage in sets.weight remains canonical lb; display converts at UI boundary.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'lb'
  CONSTRAINT users_weight_unit_check CHECK (weight_unit IN ('lb', 'kg'));

NOTIFY pgrst, 'reload schema';
