import { execSync } from 'child_process';
import { test, expect } from '@playwright/test';

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
      return `psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1`;
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

interface TestUser {
  id: string;
  email: string;
  password: string;
  session1Id: string;
  session2Id: string;
}

let testUser: TestUser;

function cleanupTestUser(user: TestUser) {
  if (!user || !user.id) return;
  const sql = `
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id = '${user.id}'
    );
    DELETE FROM public.workouts WHERE user_id = '${user.id}';
    DELETE FROM public.users WHERE id = '${user.id}';
    DELETE FROM auth.users WHERE id = '${user.id}';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[yb-history-exercise-order] Cleanup error:', err);
    throw err;
  }
}

async function seedTestUser(): Promise<TestUser> {
  const email = `yb-history-order-${Date.now()}-${Math.floor(Math.random() * 1000000)}@yourbody.fyi`;
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
    throw new Error(`Failed to signup test user: ${res.status} ${await res.text()}`);
  }

  const signupData = await res.json();
  const userId = signupData.user?.id;
  if (!userId) {
    throw new Error('Signup did not return a user id');
  }

  // Master exercise IDs in local database:
  // Exercise B: Leg Press Machine (starts with L)
  const exB = '73f50c48-3b0c-7ce4-6e3d-2af65ee52399';
  // Exercise A: Bench Press (starts with B, alphabetically earlier than Leg Press)
  const exA = 'f3944bdb-3180-920e-683f-aedddbe44599';
  // Exercise C: Overhead Press (starts with O, alphabetically between L and O)
  const exC = '67bd5115-19f0-f3b4-aab3-e1fe39822f80';

  // Pinned dates (not weekday-dependent)
  const pinnedDate1 = '2024-01-10';
  const pinnedDate2 = '2024-01-11';

  const session1Id = crypto.randomUUID();
  const session2Id = crypto.randomUUID();

  // Deterministic set IDs for equal timestamp session
  const eqSetId1 = `${userId.slice(0, 35)}1`;
  const eqSetId2 = `${userId.slice(0, 35)}2`;

  const sql = `
    INSERT INTO public.users (id, email, username, role, weight_unit, pr_mode)
    VALUES ('${userId}', '${email}', 'Order Athlete', 'athlete', 'lb', 'weight')
    ON CONFLICT (id) DO UPDATE SET username = 'Order Athlete', role = 'athlete', weight_unit = 'lb', pr_mode = 'weight';

    -- Session 1: sets with created_at B < A < C
    INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
    VALUES ('${session1Id}', '${userId}', 'Order Test Session', '${pinnedDate1}', '${pinnedDate1}T10:00:00Z');

    -- Exercise B first: 10:00:00Z
    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES (gen_random_uuid(), '${session1Id}', '${exB}', 200, 10, 1, 'working', '${pinnedDate1}T10:00:00Z');

    -- Exercise A second: 10:15:00Z (alphabetically earlier than B)
    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES (gen_random_uuid(), '${session1Id}', '${exA}', 135, 5, 1, 'working', '${pinnedDate1}T10:15:00Z');

    -- Exercise C third: 10:30:00Z
    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES (gen_random_uuid(), '${session1Id}', '${exC}', 95, 8, 1, 'working', '${pinnedDate1}T10:30:00Z');

    -- Session 2: equal timestamp case
    INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
    VALUES ('${session2Id}', '${userId}', 'Equal Timestamp Session', '${pinnedDate2}', '${pinnedDate2}T10:00:00Z');

    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES ('${eqSetId1}', '${session2Id}', '${exB}', 200, 10, 1, 'working', '${pinnedDate2}T10:00:00Z');

    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES ('${eqSetId2}', '${session2Id}', '${exA}', 135, 5, 1, 'working', '${pinnedDate2}T10:00:00Z');
  `;

  const cmd = getPsqlCommand();
  execSync(cmd, { input: sql, encoding: 'utf8' });

  return { id: userId, email, password, session1Id, session2Id };
}

test.describe('History Exercise Card Order (D-YB-8)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    testUser = await seedTestUser();
  });

  test.afterAll(async () => {
    if (testUser) {
      cleanupTestUser(testUser);
    }
  });

  test('exercise cards are ordered by earliest created_at (B < A < C), not alphabetical', async ({ page }) => {
    // 1. Log in as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout', { timeout: 15000 });

    // 2. Navigate to History
    await page.goto('/history');
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // 3. Ensure Session 1 is expanded
    const expandBtn = page.locator(`[data-testid="expand-session-btn-${testUser.session1Id}"]`);
    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    const isExpanded = await expandBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await expandBtn.click();
    }

    // 4. Assert exercise card order: B (Leg Press Machine), A (Bench Press), C (Overhead Press)
    const sessionDetails = page.locator(`#session-details-${testUser.session1Id}`);
    await expect(sessionDetails).toBeVisible({ timeout: 10000 });

    const exerciseHeaders = sessionDetails.locator('span.font-bold.text-white.text-xs.truncate');
    await expect(exerciseHeaders).toHaveText([
      'Leg Press Machine',
      'Bench Press',
      'Overhead Press',
    ], { timeout: 15000 });
  });

  test('equal-timestamp sets render identically across reloads (stable deterministic tie-break)', async ({ page }) => {
    // 1. Log in as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout', { timeout: 15000 });

    // 2. Navigate to History
    await page.goto('/history');
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // 3. Ensure Session 2 is expanded
    const expandBtn = page.locator(`[data-testid="expand-session-btn-${testUser.session2Id}"]`);
    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    const isExpanded = await expandBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await expandBtn.click();
    }

    const sessionDetails = page.locator(`#session-details-${testUser.session2Id}`);
    await expect(sessionDetails).toBeVisible({ timeout: 10000 });

    const exerciseHeaders = sessionDetails.locator('span.font-bold.text-white.text-xs.truncate');
    await expect(exerciseHeaders).toHaveText(
      [
        /^(Leg Press Machine|Bench Press)$/,
        /^(Leg Press Machine|Bench Press)$/,
      ],
      { timeout: 15000 }
    );

    const initialOrder = await exerciseHeaders.allTextContents();

    // 4. Reload page and assert identical order
    await page.reload();
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    const reloadExpandBtn = page.locator(`[data-testid="expand-session-btn-${testUser.session2Id}"]`);
    await expect(reloadExpandBtn).toBeVisible({ timeout: 10000 });
    const isReloadExpanded = await reloadExpandBtn.getAttribute('aria-expanded');
    if (isReloadExpanded !== 'true') {
      await reloadExpandBtn.click();
    }

    const reloadDetails = page.locator(`#session-details-${testUser.session2Id}`);
    await expect(reloadDetails).toBeVisible({ timeout: 10000 });

    const reloadHeaders = reloadDetails.locator('span.font-bold.text-white.text-xs.truncate');
    await expect(reloadHeaders).toHaveText(initialOrder, { timeout: 15000 });
  });
});
