-- ============================================================================
-- Yourbody — Rollback Grandfather Existing Users to Pro
-- Reverses 20261010050000_grandfather_existing_users.sql
-- ============================================================================

-- 1. Restore previous plan and paid_until for users whose grant is untouched
UPDATE public.users u
SET plan = bg.prev_plan,
    paid_until = bg.prev_paid_until
FROM public.billing_grandfather bg
WHERE u.id = bg.user_id
  AND u.plan = 'pro'
  AND u.paid_until = bg.granted_until;

-- 2. Drop the grandfathering function
DROP FUNCTION IF EXISTS public.grandfather_existing_users();

-- 3. Drop the audit table
DROP TABLE IF EXISTS public.billing_grandfather CASCADE;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
