-- Rollback for 20261010020000_terms_consent.sql
-- Idempotent drops (documentation only)

DROP TRIGGER IF EXISTS trg_protect_user_consent_fields ON public.users;
DROP FUNCTION IF EXISTS public.protect_user_consent_fields();
DROP FUNCTION IF EXISTS public.accept_terms(text);
ALTER TABLE public.users DROP COLUMN IF EXISTS terms_accepted_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS terms_version;

NOTIFY pgrst, 'reload schema';
