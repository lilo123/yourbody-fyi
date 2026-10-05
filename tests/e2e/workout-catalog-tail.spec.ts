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

interface TailTestUser {
  id: string;
  email: string;
  password: string;
}

async function createTailTestUser(): Promise<TailTestUser> {
  const email = `workout-tail-${Date.now()}-${Math.floor(Math.random() * 1000000)}@yourbody.fyi`;
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
    throw new Error(`Failed to signup tail test user: ${res.status} ${await res.text()}`);
  }

  const signupJson = await res.json();
  const userId = signupJson.user?.id;
  if (!userId) {
    throw new Error('Signup did not return user id');
  }

  // Seed user profile and pinned 7-day routine so user never depends on weekday
  const seedSql = `
    INSERT INTO public.users (id, email, username, role, weight_unit, pr_mode)
    VALUES ('${userId}', '${email}', 'Tail Tester', 'athlete', 'lb', 'weight')
    ON CONFLICT (id) DO UPDATE SET username = 'Tail Tester', role = 'athlete', weight_unit = 'lb', pr_mode = 'weight';

    DO $$
    DECLARE
      v_eid uuid;
      v_rid uuid := gen_random_uuid();
      v_reid uuid := gen_random_uuid();
    BEGIN
      SELECT id INTO v_eid FROM public.exercises WHERE is_master = true ORDER BY name LIMIT 1;
      INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
      VALUES (v_rid, '${userId}', 'Tail Pinned Routine', false, '{"Mon","Tue","Wed","Thu","Fri","Sat","Sun"}');
      INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES (v_reid, v_rid, v_eid, 1, 3, 10);
    END $$;
  `;
  const cmd = getPsqlCommand();
  execSync(cmd, { input: seedSql, encoding: 'utf8' });

  return { id: userId, email, password };
}

function cleanupTailTestUser(user?: TailTestUser): void {
  if (!user || (!user.id && !user.email)) return;
  const whereClauses: string[] = [];
  if (user.email) whereClauses.push(`email = '${user.email}'`);
  if (user.id) whereClauses.push(`id = '${user.id}'`);

  const idSubquery = `SELECT id FROM auth.users WHERE ${whereClauses.join(' OR ')}`;

  const cleanupSql = `
    DELETE FROM public.template_exercises WHERE template_id IN (
      SELECT id FROM public.routine_templates WHERE user_id IN (${idSubquery})
    );
    DELETE FROM public.routine_templates WHERE user_id IN (${idSubquery});
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id IN (${idSubquery})
    );
    DELETE FROM public.workouts WHERE user_id IN (${idSubquery});
    DELETE FROM public.users WHERE id IN (${idSubquery});
    DELETE FROM auth.users WHERE ${whereClauses.join(' OR ')};
  `;

  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: cleanupSql, encoding: 'utf8' });
  } catch (err) {
    console.error('[workout-catalog-tail] Cleanup error (rethrown):', err);
    throw err;
  }
}

test.describe('Workout Catalog Tail Resolution E2E (Package G)', () => {
  test.describe.configure({ mode: 'serial' });

  let testUser: TailTestUser;

  test.beforeAll(async () => {
    testUser = await createTailTestUser();
  });

  test.afterAll(async () => {
    if (testUser) {
      cleanupTailTestUser(testUser);
    }
  });

  test('logs sets for catalog-tail exercises "Weighted Sit-Up" and "Zottman Curl" without truncation or UUID resolution error', async ({
    page,
  }) => {
    // 1. Authenticate as athlete
    await page.goto('/login');
    await page.fill('input[type="email"]', testUser.email);
    await page.fill('input[type="password"]', testUser.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await page.waitForLoadState('networkidle');

    // Pin the routine: the default routine is weekday-based (Wed/Sat/Sun resolve to
    // Rest Day, which renders no Add Exercise button), so never rely on today's schedule.
    const routineBtn = page.locator('[data-testid="routine-select-btn"]');
    await expect(routineBtn).toBeVisible({ timeout: 15000 });
    await routineBtn.click();
    const routineModal = page.locator('[data-testid="routine-picker-modal"]');
    await expect(routineModal).toBeVisible({ timeout: 5000 });
    await routineModal.locator('button:has-text("Free Workout")').click();
    await expect(routineModal).not.toBeVisible();
    await expect(routineBtn).toContainText('Free Workout');

    // 2. Open exercise picker to add the tail exercises: "Weighted Sit-Up" and "Zottman Curl"
    const addExerciseBtn = page.locator('[data-testid="add-exercise-btn"]');
    const addFirstExerciseBtn = page.locator('[data-testid="add-first-exercise-btn"]');
    await expect(addExerciseBtn.or(addFirstExerciseBtn).first()).toBeVisible({ timeout: 15000 });

    if (await addFirstExerciseBtn.isVisible()) {
      await addFirstExerciseBtn.click();
    } else {
      await addExerciseBtn.click();
    }

    const pickerSheet = page.locator('[data-testid="exercise-picker-sheet"]');
    await expect(pickerSheet).toBeVisible();

    const searchInput = page.locator('[data-testid="exercise-search-input"]');

    // Search and select "Weighted Sit-Up"
    await searchInput.fill('Weighted');
    const weightedSitUpRow = page
      .locator('[data-testid^="exercise-row-"]')
      .filter({ hasText: 'Weighted Sit-Up' })
      .first();
    await expect(weightedSitUpRow).toBeVisible({ timeout: 10000 });
    const weightedAlreadyAdded = await weightedSitUpRow.locator('text=Added').isVisible();
    if (!weightedAlreadyAdded) {
      await weightedSitUpRow.click();
    }

    // Search and select "Zottman Curl"
    await searchInput.fill('Zottman');
    const zottmanCurlRow = page
      .locator('[data-testid^="exercise-row-"]')
      .filter({ hasText: 'Zottman Curl' })
      .first();
    await expect(zottmanCurlRow).toBeVisible({ timeout: 10000 });
    const zottmanAlreadyAdded = await zottmanCurlRow.locator('text=Added').isVisible();
    if (!zottmanAlreadyAdded) {
      await zottmanCurlRow.click();
    }

    // Confirm addition
    const confirmAddBtn = page.locator('[data-testid="picker-confirm-add-btn"]');
    if (await confirmAddBtn.isEnabled()) {
      await confirmAddBtn.click();
    } else {
      await page.locator('[data-testid="exercise-picker-sheet-close-btn"]').click();
    }
    await expect(pickerSheet).not.toBeVisible();

    // 3. Log a set for "Weighted Sit-Up"
    const weightedCard = page
      .locator('[data-card-for-exercise="Weighted Sit-Up"], [data-testid^="exercise-card-"]')
      .filter({ hasText: 'Weighted Sit-Up' })
      .first();
    await expect(weightedCard).toBeVisible({ timeout: 10000 });

    // Expand accordion if not expanded
    const weightedBody = weightedCard.locator('[id^="exercise-card-body-"]');
    if (!(await weightedBody.isVisible())) {
      await weightedCard.locator('button[aria-controls^="exercise-card-body-"]').click();
      await expect(weightedBody).toBeVisible();
    }

    // Fill weight & reps for Weighted Sit-Up set 1
    const weightedWeightInput = weightedCard.locator('input[inputmode="decimal"]').first();
    const weightedRepsInput = weightedCard.locator('input[inputmode="numeric"]').first();
    await weightedWeightInput.fill('25');
    await weightedRepsInput.fill('15');

    const weightedCommitBtn = weightedCard.locator('button[data-testid^="commit-set-btn-"]').first();
    await weightedCommitBtn.click();

    // 4. Log a set for "Zottman Curl"
    const zottmanCard = page
      .locator('[data-card-for-exercise="Zottman Curl"], [data-testid^="exercise-card-"]')
      .filter({ hasText: 'Zottman Curl' })
      .first();
    await expect(zottmanCard).toBeVisible({ timeout: 10000 });

    // Expand accordion if not expanded
    const zottmanBody = zottmanCard.locator('[id^="exercise-card-body-"]');
    if (!(await zottmanBody.isVisible())) {
      await zottmanCard.locator('button[aria-controls^="exercise-card-body-"]').click();
      await expect(zottmanBody).toBeVisible();
    }

    // Fill weight & reps for Zottman Curl set 1
    const zottmanWeightInput = zottmanCard.locator('input[inputmode="decimal"]').first();
    const zottmanRepsInput = zottmanCard.locator('input[inputmode="numeric"]').first();
    await zottmanWeightInput.fill('30');
    await zottmanRepsInput.fill('12');

    const zottmanCommitBtn = zottmanCard.locator('button[data-testid^="commit-set-btn-"]').first();
    await zottmanCommitBtn.click();

    // 5. Assert: both sets successfully logged and NO UUID resolution error appeared
    await expect(page.getByText('cannot be resolved to a valid UUID')).toHaveCount(0);
    await expect(weightedCard.locator('[data-testid^="logged-set-row-"]').first()).toBeVisible({ timeout: 10000 });
    await expect(zottmanCard.locator('[data-testid^="logged-set-row-"]').first()).toBeVisible({ timeout: 10000 });
  });
});
