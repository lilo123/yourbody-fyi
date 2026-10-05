import { execSync } from 'child_process';
import { expect, type Page, type BrowserContext } from '@playwright/test';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58821';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

function getPsqlCommand(): string {
  if (process.env.DATABASE_URL) {
    let parsed: URL;
    try {
      parsed = new URL(process.env.DATABASE_URL);
    } catch {
      return `psql "${process.env.DATABASE_URL}" -t -A -v ON_ERROR_STOP=1`;
    }
    if (
      (parsed.port && parsed.port !== '58822') ||
      (parsed.hostname && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')
    ) {
      return `psql -h "${parsed.hostname}" -p "${parsed.port || '5432'}" -U "${parsed.username || 'postgres'}" -d "${parsed.pathname.slice(1) || 'postgres'}" -t -A -v ON_ERROR_STOP=1`;
    }
  }
  return `psql "${DB_URL}" -t -A -v ON_ERROR_STOP=1`;
}

export function execPsql(sql: string): string {
  const cmd = getPsqlCommand();
  try {
    return execSync(cmd, { input: sql, encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('[fixtures] PSQL error executing SQL:', sql, err);
    throw err;
  }
}

export function countRows(table: string, whereClause: string): number {
  const sql = `SELECT count(*) FROM ${table} WHERE ${whereClause};`;
  const raw = execPsql(sql);
  const count = parseInt(raw, 10);
  return isNaN(count) ? 0 : count;
}

export function queryRows<T = Record<string, unknown>>(sql: string): T[] {
  const wrapped = `SELECT coalesce(json_agg(t), '[]'::json)::text FROM (${sql.replace(/;$/, '')}) t;`;
  const raw = execPsql(wrapped);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export interface PwaTestUser {
  id: string;
  email: string;
  password: string;
  routineId: string;
  exerciseId: string;
  exerciseName: string;
}

/**
 * Creates a unique user for test isolation, with profile and pinned 7-day routine.
 * Never depends on weekday: routine explicitly covers Mon..Sun.
 */
export async function createPwaTestUser(prefix = 'pwa-user'): Promise<PwaTestUser> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}@yourbody.fyi`;
  const password = 'Password123!';

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`Failed to signup PWA test user: ${res.status} ${await res.text()}`);
  }

  const signupJson = await res.json();
  const userId = signupJson.user?.id;
  if (!userId) {
    throw new Error('Signup did not return user id');
  }

  // Seed user profile and pinned routine (all 7 days: never depends on weekday)
  const seedSql = `
    INSERT INTO public.users (id, email, username, role, weight_unit, pr_mode)
    VALUES ('${userId}', '${email}', 'PWA Tester', 'athlete', 'lb', 'weight')
    ON CONFLICT (id) DO UPDATE SET username = 'PWA Tester', role = 'athlete', weight_unit = 'lb', pr_mode = 'weight';

    DO $$
    DECLARE
      v_eid uuid;
      v_ename text;
      v_rid uuid := gen_random_uuid();
      v_reid uuid := gen_random_uuid();
    BEGIN
      SELECT id, name INTO v_eid, v_ename FROM public.exercises WHERE is_master = true ORDER BY name LIMIT 1;
      INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
      VALUES (v_rid, '${userId}', 'PWA Pinned Routine', false, '{"Mon","Tue","Wed","Thu","Fri","Sat","Sun"}');
      INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES (v_reid, v_rid, v_eid, 1, 3, 10);
      CREATE TEMP TABLE tmp_pwa_seed AS
      SELECT '${userId}'::text AS uid, v_rid::text AS rid, v_eid::text AS eid, v_ename AS ename;
    END $$;
    SELECT uid || '|' || rid || '|' || eid || '|' || ename FROM tmp_pwa_seed;
  `;

  const rawMeta = execPsql(seedSql);
  const parts = rawMeta.split('|').map((s) => s.trim());
  const routineId = parts[1] || '';
  const exerciseId = parts[2] || '';
  const exerciseName = parts[3] || '';

  return {
    id: userId,
    email,
    password,
    routineId,
    exerciseId,
    exerciseName,
  };
}

/**
 * Cleans up all user data, routines, sets, and auth record.
 * Any cleanup failure is rethrown per lesson rules.
 */
export function cleanupPwaTestUser(user: { id?: string; email?: string }): void {
  const whereClauses: string[] = [];
  if (user.email) whereClauses.push(`email = '${user.email}'`);
  if (user.id) whereClauses.push(`id = '${user.id}'`);
  if (whereClauses.length === 0) return;

  const idSubquery = `SELECT id FROM auth.users WHERE ${whereClauses.join(' OR ')}`;

  const cleanupSql = `
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (${idSubquery});
    DELETE FROM public.template_exercises WHERE template_id IN (
      SELECT id FROM public.routine_templates WHERE user_id IN (${idSubquery})
    );
    DELETE FROM public.routine_templates WHERE user_id IN (${idSubquery});
    DELETE FROM public.nutrition_logs WHERE user_id IN (${idSubquery});
    DELETE FROM public.custom_dishes WHERE user_id IN (${idSubquery});
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id IN (${idSubquery})
    );
    DELETE FROM public.workouts WHERE user_id IN (${idSubquery});
    DELETE FROM public.users WHERE id IN (${idSubquery});
    DELETE FROM auth.users WHERE ${whereClauses.join(' OR ')};
  `;

  try {
    execPsql(cleanupSql);
  } catch (err) {
    console.error('[fixtures] Cleanup error (rethrown):', err);
    throw err;
  }
}

/**
 * Signs in a user using the standard credentials form.
 */
export async function signInUser(
  page: Page,
  user: { email: string; password?: string; role?: string }
): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password || 'Password123!');
  await page.click('button[type="submit"]');
  if (user.role === 'coach') {
    await page.waitForURL('**/coach');
    await expect(page.locator('text=Coach Cockpit').or(page.locator('text=Athletes')).first()).toBeVisible({ timeout: 15000 });
  } else {
    await page.waitForURL('**/workout');
    const routineOrChoose = page
      .locator('[data-testid="routine-select-btn"]')
      .or(page.locator('button:has-text("Choose Routine")'));
    await expect(routineOrChoose.first()).toBeVisible({ timeout: 15000 });
  }
}

/**
 * Waits for service worker ready and ensures the active page is controlled by it.
 * Uses web-first polling via expect.poll with zero waitForTimeout calls.
 */
export async function waitForSwControl(page: Page, timeout = 15000): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('serviceWorker not supported in navigator');
    }
    await navigator.serviceWorker.ready;
  });

  const controlledInitial = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  if (!controlledInitial) {
    await page.reload();
  }

  await expect
    .poll(
      async () => {
        return page.evaluate(() => Boolean(navigator.serviceWorker.controller));
      },
      {
        message: 'Expected navigator.serviceWorker.controller to be present',
        timeout,
      }
    )
    .toBe(true);
}

/**
 * Waits for offline prefetch data (exercise catalog) to be saved to IndexedDB `yourbody-offline-${userId}`.
 * Polls the IDB `rq` store for the client query containing 'exercise_catalog' and 'offline_all'.
 */
export async function waitForOfflineDataReady(
  page: Page,
  userId: string,
  timeout = 15000
): Promise<void> {
  await expect
    .poll(
      async () => {
        return page.evaluate(async (uid) => {
          return new Promise<boolean>((resolve) => {
            const dbName = `yourbody-offline-${uid}`;
            const req = indexedDB.open(dbName);
            req.onerror = () => resolve(false);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains('rq')) {
                db.close();
                return resolve(false);
              }
              try {
                const tx = db.transaction('rq', 'readonly');
                const store = tx.objectStore('rq');
                const getReq = store.get('client');
                getReq.onsuccess = () => {
                  const val = getReq.result as any;
                  db.close();
                  if (!val || !val.clientState || !Array.isArray(val.clientState.queries)) {
                    return resolve(false);
                  }
                  const hasCatalog = val.clientState.queries.some((q: any) => {
                    const k = q?.queryKey;
                    return (
                      Array.isArray(k) &&
                      k[0] === 'exercise_catalog' &&
                      k[1] === 'offline_all' &&
                      q?.state?.status === 'success'
                    );
                  });
                  resolve(hasCatalog);
                };
                getReq.onerror = () => {
                  db.close();
                  resolve(false);
                };
              } catch {
                db.close();
                resolve(false);
              }
            };
          });
        }, userId);
      },
      {
        message: `Offline data not ready in IDB for user ${userId}`,
        timeout,
        intervals: [100, 250, 500],
      }
    )
    .toBe(true);
}

/**
 * Emulates offline network state on browser context.
 */
export async function goOffline(context: BrowserContext, _page?: Page): Promise<void> {
  await context.setOffline(true);
}

/**
 * goOffline plus a synthetic window 'offline' event so the app reacts at once. Call it only after the page
 * has settled: dispatching it mid-navigation aborts in-flight catalog fetches (account-switch race condition).
 */
export async function goOfflineAndNotify(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  if (!page.isClosed()) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });
  }
}

/**
 * Restores online network state on browser context and notifies window.
 */
export async function goOnline(context: BrowserContext, page?: Page): Promise<void> {
  await context.setOffline(false);
  if (page) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
  }
}

/**
 * Creates a unique coach test user for role verification.
 */
export async function createCoachPwaTestUser(prefix = 'pwa-coach'): Promise<PwaTestUser & { role: string }> {
  const user = await createPwaTestUser(prefix);
  execPsql(`
    UPDATE public.users
    SET role = 'coach', is_coach_mode = true
    WHERE id = '${user.id}';
  `);
  return { ...user, role: 'coach' };
}

/**
 * Seeds a prior workout session with sets for PR and ghost comparison.
 */
export function seedPriorWorkoutSession(
  user: PwaTestUser,
  date: string,
  weight = 100,
  reps = 10
): { workoutId: string; setId: string } {
  const sql = `
    DO $$
    DECLARE
      v_wid uuid;
      v_sid uuid;
    BEGIN
      INSERT INTO public.workouts (id, user_id, workout_date, date, name)
      VALUES (gen_random_uuid(), '${user.id}', '${date}', '${date}T10:00:00Z', 'Prior PWA Routine')
      ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'Prior PWA Routine'
      RETURNING id INTO v_wid;

      INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type)
      VALUES (gen_random_uuid(), v_wid, '${user.exerciseId}', ${weight}, ${reps}, 1, 'working')
      RETURNING id INTO v_sid;

      CREATE TEMP TABLE tmp_prior_seed AS SELECT v_wid::text AS wid, v_sid::text AS sid;
    END $$;
    SELECT wid || '|' || sid FROM tmp_prior_seed;
  `;
  const raw = execPsql(sql);
  const [workoutId, setId] = raw.split('|').map((s) => s.trim());
  return { workoutId, setId };
}

/**
 * Creates a custom exercise in public.exercises for the user.
 */
export function createCustomExercise(userId: string, name: string): string {
  const raw = execPsql(`
    INSERT INTO public.exercises (id, user_id, name, is_master, body_parts, equipment)
    VALUES (gen_random_uuid(), '${userId}', '${name}', false, '{"Chest"}', 'dumbbell')
    RETURNING id;
  `);
  return raw.split('\n')[0].trim();
}

/**
 * Deletes an exercise from public.exercises.
 */
export function deleteExercise(exerciseId: string): void {
  execPsql(`DELETE FROM public.exercises WHERE id = '${exerciseId}';`);
}

export interface QueryUserRecordsOptions {
  date?: string;
  excludeDates?: string[];
}

/**
 * Returns workout records for a user, optionally filtered by date or excluding specific dates.
 */
export function getUserWorkouts(
  userId: string,
  dateOrOptions?: string | QueryUserRecordsOptions
): { id: string; workout_date: string; name: string }[] {
  let where = `WHERE user_id = '${userId}'`;
  if (typeof dateOrOptions === 'string') {
    where += ` AND workout_date = '${dateOrOptions}'`;
  } else if (dateOrOptions) {
    if (dateOrOptions.date) {
      where += ` AND workout_date = '${dateOrOptions.date}'`;
    }
    if (dateOrOptions.excludeDates && dateOrOptions.excludeDates.length > 0) {
      const excluded = dateOrOptions.excludeDates.map((d) => `'${d}'`).join(', ');
      where += ` AND workout_date NOT IN (${excluded})`;
    }
  }
  return queryRows<{ id: string; workout_date: string; name: string }>(
    `SELECT id, workout_date, name FROM public.workouts ${where} ORDER BY workout_date ASC`
  );
}

/**
 * Returns set records for a user, optionally filtered by date or excluding specific dates.
 */
export function getUserSets(
  userId: string,
  dateOrOptions?: string | QueryUserRecordsOptions
): {
  id: string;
  workout_id: string;
  exercise_id: string;
  weight: number;
  reps: number;
  set_index: number;
  set_type: string;
  rpe: number | null;
}[] {
  let where = `WHERE w.user_id = '${userId}'`;
  if (typeof dateOrOptions === 'string') {
    where += ` AND w.workout_date = '${dateOrOptions}'`;
  } else if (dateOrOptions) {
    if (dateOrOptions.date) {
      where += ` AND w.workout_date = '${dateOrOptions.date}'`;
    }
    if (dateOrOptions.excludeDates && dateOrOptions.excludeDates.length > 0) {
      const excluded = dateOrOptions.excludeDates.map((d) => `'${d}'`).join(', ');
      where += ` AND w.workout_date NOT IN (${excluded})`;
    }
  }
  return queryRows(
    `SELECT s.id, s.workout_id, s.exercise_id, s.weight, s.reps, s.set_index, s.set_type, s.rpe
     FROM public.sets s
     JOIN public.workouts w ON s.workout_id = w.id
     ${where}
     ORDER BY s.set_index ASC`
  );
}

/**
 * Seeds a custom dish in public.custom_dishes for the user.
 */
export function seedCustomDish(
  user: PwaTestUser,
  name: string,
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber = 0
): string {
  const safeName = name.replace(/'/g, "''");
  const sql = `
    INSERT INTO public.custom_dishes (id, user_id, name, calories, protein, carbs, fat, fiber, use_count, kind)
    VALUES (gen_random_uuid(), '${user.id}', '${safeName}', ${calories}, ${protein}, ${carbs}, ${fat}, ${fiber}, 0, 'food')
    RETURNING id;
  `;
  const raw = execPsql(sql);
  return raw.split('\n')[0].trim();
}

/**
 * Returns a custom dish record by id.
 */
export function getCustomDish(
  dishId: string
): { id: string; name: string; calories: number; use_count: number } | null {
  const rows = queryRows<{ id: string; name: string; calories: number; use_count: number }>(
    `SELECT id, name, calories, use_count FROM public.custom_dishes WHERE id = '${dishId}' LIMIT 1;`
  );
  return rows[0] || null;
}

/**
 * Returns nutrition log records for a user.
 */
export function getUserNutritionLogs(
  userId: string,
  date?: string
): {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  logged_at: string;
  logged_date: string;
  meal_type: string;
  serving_size: number;
  serving_unit: string;
  items: unknown;
}[] {
  let where = `WHERE user_id = '${userId}'`;
  if (date) {
    where += ` AND logged_date = '${date}'`;
  }
  return queryRows(
    `SELECT id, user_id, food_name, calories, protein, carbs, fat, fiber,
            logged_at::text, logged_date::text, meal_type, serving_size, serving_unit, items
     FROM public.nutrition_logs
     ${where}
     ORDER BY logged_at ASC`
  );
}
