import { execSync } from 'child_process';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

/**
 * Resolves the appropriate psql command string.
 *
 * NOTE: In some environments, 'psql' may be a shell shim
 * (psql on PATH) that intercepts and silently discards arguments starting
 * with postgresql:// or postgres:// before forwarding to docker exec.
 * To allow DATABASE_URL overrides (such as targeting an alternate host or port, or testing
 * unreachable database instances), we parse DATABASE_URL and explicitly pass -h, -p, -U, -d flags.
 */
function getPsqlCommand(): string {
  if (process.env.DATABASE_URL) {
    let parsed: URL;
    try {
      parsed = new URL(process.env.DATABASE_URL);
    } catch {
      throw new Error(
        `[globalTeardown] Malformed DATABASE_URL: "${process.env.DATABASE_URL}". Must be a valid URL.`
      );
    }
    if (
      (parsed.port && parsed.port !== '58822') ||
      (parsed.hostname && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')
    ) {
      return `psql -h "${parsed.hostname}" -p "${parsed.port || '5432'}" -U "${parsed.username || 'postgres'}" -d "${parsed.pathname.slice(1) || 'postgres'}" -v ON_ERROR_STOP=1`;
    }
  }
  return `psql "${DB_URL}" -v ON_ERROR_STOP=1`;
}

export default async function globalTeardown() {
  console.log('[globalTeardown] Cleaning up test-generated residue...');

  const cleanupSql = `
    CREATE TEMP TABLE e2e_test_users AS
    SELECT id, email
    FROM public.users
    WHERE email IN (
      'athlete@yourbody.fyi',
      'coach@yourbody.fyi',
      'paginate@yourbody.fyi'
    );

    DO $$
    DECLARE
      v_count int;
    BEGIN
      SELECT count(*) INTO v_count FROM e2e_test_users;
      IF v_count <> 3 THEN
        RAISE EXCEPTION 'Expected exactly 3 e2e test users in public.users, found %', v_count;
      END IF;
      IF EXISTS (
        SELECT 1 FROM e2e_test_users
        WHERE id = (SELECT id FROM public.users WHERE email = 'bench-athlete@yourbody.fyi')
      ) THEN
        RAISE EXCEPTION 'CRITICAL: bench-athlete@yourbody.fyi must never be in e2e_test_users!';
      END IF;
    END $$;

    -- 1. Remove routine template exercises created by e2e test accounts
    DELETE FROM public.template_exercises
    WHERE template_id IN (
      SELECT id FROM public.routine_templates
      WHERE user_id IN (SELECT id FROM e2e_test_users)
        AND name LIKE '%Playwright%'
    );

    -- 2. Remove routine templates created by e2e test accounts
    DELETE FROM public.routine_templates
    WHERE user_id IN (SELECT id FROM e2e_test_users)
      AND name LIKE '%Playwright%';

    -- 3. Remove test-created nutrition logs scoped strictly to e2e test accounts
    DELETE FROM public.nutrition_logs
    WHERE user_id IN (SELECT id FROM e2e_test_users);

    -- 4. Remove disconnected links belonging to e2e test accounts
    DELETE FROM public.coach_athlete_links
    WHERE status = 'disconnected'
      AND athlete_id IN (SELECT id FROM e2e_test_users)
      AND coach_id IN (SELECT id FROM e2e_test_users);

    -- 5. Deduplicate any duplicate active links for e2e test accounts if present
    DELETE FROM public.coach_athlete_links a
    USING public.coach_athlete_links b
    WHERE a.id > b.id
      AND a.coach_id = b.coach_id
      AND a.athlete_id = b.athlete_id
      AND a.athlete_id IN (SELECT id FROM e2e_test_users)
      AND a.coach_id IN (SELECT id FROM e2e_test_users);
  `;

  try {
    const cmd = getPsqlCommand();
    const result = execSync(cmd, {
      input: cleanupSql,
      encoding: 'utf8',
    });
    console.log('[globalTeardown] Database residue cleaned successfully:\n' + result.trim());
  } catch (err) {
    console.error('[globalTeardown] Error cleaning up database:', err);
    throw err;
  }
}
