-- Migration: 20261017020000_default_revoke_function_execute.sql
-- Description: Revoke EXECUTE on new database functions by default from public, anon, and authenticated.
-- New functions must be explicitly granted EXECUTE permissions (e.g. to authenticated, and anon if needed).
--
-- Roles evaluated:
-- - postgres: Owner of public functions and the role executing project migrations.
--   Default privileges revoked globally from PUBLIC and in schema public from PUBLIC, anon, authenticated.
-- - supabase_admin: Manages internal Supabase extensions; cannot be altered by migration user postgres
--   (permission denied), and does not create project schema functions in migrations.

-- 1. Revoke default EXECUTE on functions from PUBLIC globally for role postgres.
-- In PostgreSQL, functions grant EXECUTE to PUBLIC by default unless revoked at database/role level.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 2. Revoke default EXECUTE on functions in schema public for role postgres.
-- Supabase initializes schema-level default privileges granting execute to anon and authenticated;
-- revoking here ensures new schema public functions are locked by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
