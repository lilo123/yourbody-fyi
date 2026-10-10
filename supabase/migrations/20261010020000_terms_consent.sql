-- Migration: 20261010020000_terms_consent.sql
-- Description: Terms of service and privacy policy consent tracking and RPC.

-- 1. Add terms columns to users (nullable, no backfill)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

-- 2. Trigger function to protect consent fields from direct client updates
CREATE OR REPLACE FUNCTION public.protect_user_consent_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_claims text;
  v_jwt_role text;
BEGIN
  IF (NEW.terms_version IS DISTINCT FROM OLD.terms_version) OR
     (NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at) THEN

    -- Allow when consent_write config is set inside accept_terms RPC
    IF current_setting('app.consent_write', true) = 'on' THEN
      RETURN NEW;
    END IF;

    -- Extract JWT claims safely
    BEGIN
      v_jwt_claims := nullif(current_setting('request.jwt.claims', true), '');
      IF v_jwt_claims IS NOT NULL THEN
        v_jwt_role := (v_jwt_claims::jsonb)->>'role';
      ELSE
        v_jwt_role := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_jwt_role := NULL;
      v_jwt_claims := NULL;
    END;

    -- Allow when JWT role is service_role, or when there are no JWT claims (migrations/direct admin)
    IF v_jwt_claims IS NULL OR v_jwt_role = 'service_role' THEN
      RETURN NEW;
    END IF;

    -- Otherwise reject client direct writes
    RAISE EXCEPTION 'Unauthorized: consent fields can only be set through accept_terms.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_consent_fields ON public.users;
CREATE TRIGGER trg_protect_user_consent_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_consent_fields();

-- 3. RPC: accept_terms
CREATE OR REPLACE FUNCTION public.accept_terms(p_version text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_accepted_at timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_version IS NULL OR p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid terms version format' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.consent_write', 'on', true);

  UPDATE public.users
  SET terms_version = p_version,
      terms_accepted_at = now()
  WHERE id = v_uid
  RETURNING terms_accepted_at INTO v_accepted_at;

  PERFORM set_config('app.consent_write', '', true);

  RETURN jsonb_build_object(
    'terms_version', p_version,
    'terms_accepted_at', v_accepted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_terms(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_terms(text) TO authenticated;

-- 4. Schema reload notification
NOTIFY pgrst, 'reload schema';
