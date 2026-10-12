-- Migration: 20261012010000_users_rest_timer_seconds.sql
-- Description: Add rest_timer_seconds preference to public.users table (15..600 seconds, default 90)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS rest_timer_seconds integer NOT NULL DEFAULT 90
  CONSTRAINT users_rest_timer_seconds_check CHECK (rest_timer_seconds >= 15 AND rest_timer_seconds <= 600);

NOTIFY pgrst, 'reload schema';
