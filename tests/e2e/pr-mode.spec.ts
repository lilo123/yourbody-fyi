import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

const ATHLETE_EMAIL = 'p81-athlete-pr@yourbody.fyi';
const PASSWORD = 'password123';

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

interface SeedData {
  athleteId: string;
  exerciseId: string;
  exerciseName: string;
}

let seedData: SeedData;

async function cleanupUsers() {
  const sql = `
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (
      SELECT id FROM auth.users WHERE email = '${ATHLETE_EMAIL}'
    );
    DELETE FROM public.template_exercises WHERE template_id IN (
      SELECT id FROM public.routine_templates WHERE user_id IN (
        SELECT id FROM auth.users WHERE email = '${ATHLETE_EMAIL}'
      )
    );
    DELETE FROM public.routine_templates WHERE user_id IN (
      SELECT id FROM auth.users WHERE email = '${ATHLETE_EMAIL}'
    );
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id IN (
        SELECT id FROM auth.users WHERE email = '${ATHLETE_EMAIL}'
      )
    );
    DELETE FROM public.workouts WHERE user_id IN (
      SELECT id FROM auth.users WHERE email = '${ATHLETE_EMAIL}'
    );
    UPDATE public.users SET pr_mode = 'weight' WHERE email = '${ATHLETE_EMAIL}';
    DELETE FROM public.users WHERE email = '${ATHLETE_EMAIL}';
    DELETE FROM auth.users WHERE email = '${ATHLETE_EMAIL}';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p8-1-pr-mode] Cleanup error:', err);
    throw err;
  }
}

async function seedDataAndUser(): Promise<SeedData> {
  await cleanupUsers();

  const resAthlete = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: ATHLETE_EMAIL,
      password: PASSWORD,
    }),
  });
  if (!resAthlete.ok) {
    throw new Error(`Failed to signup athlete: ${resAthlete.status} ${await resAthlete.text()}`);
  }
  const athleteJson = await resAthlete.json();
  const athleteId = athleteJson.user?.id;
  if (!athleteId) {
    throw new Error('Signup did not return athlete id');
  }

  const sql = `
    DO $$
    DECLARE
      v_aid uuid := '${athleteId}';
      v_eid uuid;
      v_ename text;
      v_w1 uuid := gen_random_uuid();
      v_w2 uuid := gen_random_uuid();
      v_rid uuid := gen_random_uuid();
      v_d1 date := CURRENT_DATE - 4;
      v_d2 date := CURRENT_DATE - 2;
    BEGIN
      -- User profile with pr_mode = 'weight' and weight_unit = 'lb'
      INSERT INTO public.users (id, email, username, role, weight_unit, pr_mode)
      VALUES (v_aid, '${ATHLETE_EMAIL}', 'P81 Athlete', 'athlete', 'lb', 'weight')
      ON CONFLICT (id) DO UPDATE SET username = 'P81 Athlete', role = 'athlete', weight_unit = 'lb', pr_mode = 'weight';

      -- Pick target master exercise
      SELECT id, name INTO v_eid, v_ename FROM public.exercises WHERE is_master = true ORDER BY name LIMIT 1;

      -- Routine template for /workout navigation
      INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
      VALUES (v_rid, v_aid, 'P81 PR Test Routine', false, '{"Mon"}');

      INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES (gen_random_uuid(), v_rid, v_eid, 1, 3, 10);

      -- Session 1 (4 days ago): 200 lb x 2 reps (e1RM = 213.33)
      INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
      VALUES (v_w1, v_aid, 'Past Heavy Session', v_d1, v_d1::timestamptz + interval '10 hours');

      INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
      VALUES (gen_random_uuid(), v_w1, v_eid, 200, 2, 1, 'working', v_d1::timestamptz + interval '10 hours 5 minutes');

      -- Session 2 (2 days ago): 180 lb x 10 reps (e1RM = 240.00)
      INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
      VALUES (v_w2, v_aid, 'Past Reps Session', v_d2, v_d2::timestamptz + interval '10 hours');

      INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
      VALUES (gen_random_uuid(), v_w2, v_eid, 180, 10, 1, 'working', v_d2::timestamptz + interval '10 hours 5 minutes');

      CREATE TEMP TABLE tmp_p81_seed AS
      SELECT v_aid AS aid, v_eid AS eid, v_ename AS ename;
    END $$;
    SELECT aid, eid, ename FROM tmp_p81_seed;
  `;

  const cmd = getPsqlCommand();
  const rawOut = execSync(cmd, { input: sql, encoding: 'utf8' });
  const metaLine = rawOut.split('\n').filter((l) => l.includes(athleteId))[0];
  const parts = metaLine.split('|').map((s) => s.trim());

  return {
    athleteId: parts[0],
    exerciseId: parts[1],
    exerciseName: parts[2],
  };
}

async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', ATHLETE_EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
  await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('P8.1 PR Mode Setting E2E', () => {
  test.beforeAll(async () => {
    await cleanupUsers();
    seedData = await seedDataAndUser();
  });

  test.afterAll(async () => {
    await cleanupUsers();
  });

  test('Settings toggle switches PR mode between Max weight and Estimated 1RM across History and /workout', async ({
    page,
  }) => {
    await loginAsAthlete(page);

    // 1. Initial State: Mode is 'weight'
    // In History By-Exercise: PR is 200 lbs x 2 reps
    await page.goto('/history');
    await page.waitForURL('**/history');
    const byExerciseTab = page.locator('[data-testid="history-subview-exercise"]');
    await expect(byExerciseTab).toBeVisible();
    await byExerciseTab.click();
    await expect(byExerciseTab).toHaveAttribute('aria-selected', 'true');

    // Verify exercise PR card displays max weight (200 lbs x 2)
    const exerciseCard = page.locator(`[data-testid="exercise-card-${seedData.exerciseId}"]`);
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await expect(exerciseCard).toContainText('200 lbs × 2');
    await expect(exerciseCard).not.toContainText('e1RM');

    // Open sheet in weight mode: verify sheet also renders no 'e1RM' text
    await exerciseCard.click();
    const sheetPrSummaryInitial = page.locator('[data-testid="exercise-sheet-pr-summary"]');
    await expect(sheetPrSummaryInitial).toBeVisible({ timeout: 10000 });
    await expect(sheetPrSummaryInitial).toContainText('200 lbs × 2');
    await expect(sheetPrSummaryInitial).not.toContainText('e1RM');
    await page.keyboard.press('Escape');
    await expect(sheetPrSummaryInitial).not.toBeVisible();

    // In /workout with the test routine: ExerciseCard trophy chip displays PR: 200×2
    await page.goto('/workout?routine=P81%20PR%20Test%20Routine');
    await page.waitForURL('**/workout**');
    const prChipInitial = page.locator('[data-testid="pr-chip-0"]');
    await expect(prChipInitial).toBeVisible({ timeout: 15000 });
    await expect(prChipInitial).toContainText('PR: 200×2');
    await expect(prChipInitial).not.toContainText('e1RM');

    // 2. Settings toggle: switch to 'Estimated 1RM'
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    const prCard = page.locator('[data-testid="pr-mode-card"]');
    await expect(prCard).toBeVisible({ timeout: 10000 });

    const weightBtn = page.locator('[data-testid="pr-mode-weight"]');
    const e1rmBtn = page.locator('[data-testid="pr-mode-e1rm"]');
    await expect(weightBtn).toBeVisible();
    await expect(e1rmBtn).toBeVisible();
    await expect(weightBtn).toHaveAttribute('aria-selected', 'true');
    await expect(weightBtn).toHaveText('Max weight');
    await expect(e1rmBtn).toHaveText('Estimated 1RM');

    // Click Estimated 1RM
    await e1rmBtn.click();
    await expect(e1rmBtn).toHaveAttribute('aria-selected', 'true');

    // Verify DB updated via psql
    const cmd = getPsqlCommand();
    await expect
      .poll(
        () =>
          execSync(
            `${cmd} -t -A -c "SELECT pr_mode FROM public.users WHERE id = '${seedData.athleteId}';"`,
            { encoding: 'utf8' }
          ).trim(),
        { intervals: [250, 500, 1000] }
      )
      .toBe('e1rm');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem('yourbody_user') || '{}').pr_mode;
          } catch {
            return null;
          }
        })
      )
      .toBe('e1rm');

    // 3. Verify PR in History updated to Estimated 1RM set (180 lbs x 10 · e1RM 240 lbs)
    await page.goto('/history');
    await page.waitForURL('**/history');
    const byExerciseTab2 = page.locator('[data-testid="history-subview-exercise"]');
    await expect(byExerciseTab2).toBeVisible();
    await byExerciseTab2.click();
    await expect(byExerciseTab2).toHaveAttribute('aria-selected', 'true');

    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await expect(exerciseCard).toContainText('180 lbs × 10');
    await expect(exerciseCard).toContainText('e1RM 240 lbs');

    // Click to open drill-down sheet
    await exerciseCard.click();
    const sheetPrSummary = page.locator('[data-testid="exercise-sheet-pr-summary"]');
    await expect(sheetPrSummary).toBeVisible({ timeout: 10000 });
    await expect(sheetPrSummary).toContainText('180 lbs × 10');
    await expect(sheetPrSummary).toContainText('e1RM 240 lbs');

    // Close sheet
    await page.keyboard.press('Escape');
    await expect(sheetPrSummary).not.toBeVisible();

    // 4. Verify /workout ExerciseCard trophy chip updated to e1RM
    await page.goto('/workout?routine=P81%20PR%20Test%20Routine');
    await page.waitForURL('**/workout**');
    const prChipE1rm = page.locator('[data-testid="pr-chip-0"]');
    await expect(prChipE1rm).toBeVisible({ timeout: 15000 });
    await expect(prChipE1rm).toContainText('PR: 180×10');
    await expect(prChipE1rm).toContainText('e1RM 240 lbs');

    // 5. Reload persists e1RM setting
    await page.reload();
    await expect(prChipE1rm).toBeVisible({ timeout: 15000 });
    await expect(prChipE1rm).toContainText('PR: 180×10');
    await expect(prChipE1rm).toContainText('e1RM 240 lbs');

    // 6. Toggle back to 'Max weight' in Settings
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await page.locator('[data-testid="pr-mode-weight"]').click();
    await expect(page.locator('[data-testid="pr-mode-weight"]')).toHaveAttribute('aria-selected', 'true');

    await expect
      .poll(
        () =>
          execSync(
            `${cmd} -t -A -c "SELECT pr_mode FROM public.users WHERE id = '${seedData.athleteId}';"`,
            { encoding: 'utf8' }
          ).trim(),
        { intervals: [250, 500, 1000] }
      )
      .toBe('weight');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem('yourbody_user') || '{}').pr_mode;
          } catch {
            return null;
          }
        })
      )
      .toBe('weight');

    // Verify History restores to Max weight PR
    await page.goto('/history');
    await page.waitForURL('**/history');
    const byExerciseTab3 = page.locator('[data-testid="history-subview-exercise"]');
    await expect(byExerciseTab3).toBeVisible();
    await byExerciseTab3.click();
    await expect(byExerciseTab3).toHaveAttribute('aria-selected', 'true');
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await expect(exerciseCard).toContainText('200 lbs × 2');
    await expect(exerciseCard).not.toContainText('e1RM');

    // Open sheet when restored to weight mode: verify sheet also has no 'e1RM' text
    await exerciseCard.click();
    const sheetPrSummaryRestored = page.locator('[data-testid="exercise-sheet-pr-summary"]');
    await expect(sheetPrSummaryRestored).toBeVisible({ timeout: 10000 });
    await expect(sheetPrSummaryRestored).toContainText('200 lbs × 2');
    await expect(sheetPrSummaryRestored).not.toContainText('e1RM');
    await page.keyboard.press('Escape');
    await expect(sheetPrSummaryRestored).not.toBeVisible();

    // Verify /workout restores to Max weight PR
    await page.goto('/workout?routine=P81%20PR%20Test%20Routine');
    await page.waitForURL('**/workout**');
    const prChipRestored = page.locator('[data-testid="pr-chip-0"]');
    await expect(prChipRestored).toBeVisible({ timeout: 15000 });
    await expect(prChipRestored).toContainText('PR: 200×2');
    await expect(prChipRestored).not.toContainText('e1RM');
  });
});
