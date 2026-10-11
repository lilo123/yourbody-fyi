-- ============================================================================
-- Yourbody — Sync User Email from auth.users to public.users
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- Revoke execute from public, anon, authenticated
REVOKE EXECUTE ON FUNCTION public.sync_user_email() FROM PUBLIC, anon, authenticated;

-- Trigger on auth.users when email is updated
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_user_email();
