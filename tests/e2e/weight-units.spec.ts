import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

const P6_ATHLETE_EMAIL = 'p6-athlete-units@yourbody.fyi';
const P6_COACH_EMAIL = 'p6-coach-units@yourbody.fyi';
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

interface P6SeedData {
  athleteId: string;
  coachId: string;
  exerciseId: string;
  exerciseName: string;
  workoutId: string;
  seededSetId: string;
}

let seedData: P6SeedData;

function cleanupP6Users() {
  const sql = `
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (
      SELECT id FROM auth.users WHERE email = '${P6_ATHLETE_EMAIL}'
    ) OR coach_id IN (
      SELECT id FROM auth.users WHERE email = '${P6_COACH_EMAIL}'
    );
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id IN (
        SELECT id FROM auth.users WHERE email IN ('${P6_ATHLETE_EMAIL}', '${P6_COACH_EMAIL}')
      )
    );
    DELETE FROM public.workouts WHERE user_id IN (
      SELECT id FROM auth.users WHERE email IN ('${P6_ATHLETE_EMAIL}', '${P6_COACH_EMAIL}')
    );
    DELETE FROM public.users WHERE email IN ('${P6_ATHLETE_EMAIL}', '${P6_COACH_EMAIL}');
    DELETE FROM auth.users WHERE email IN ('${P6_ATHLETE_EMAIL}', '${P6_COACH_EMAIL}');
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p6-weight-units] Cleanup error:', err);
    throw err;
  }
}

async function seedP6UsersAndData(): Promise<P6SeedData> {
  cleanupP6Users();

  // Signup athlete
  const resAthlete = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: P6_ATHLETE_EMAIL,
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

  // Signup coach
  const resCoach = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: P6_COACH_EMAIL,
      password: PASSWORD,
    }),
  });
  if (!resCoach.ok) {
    throw new Error(`Failed to signup coach: ${resCoach.status} ${await resCoach.text()}`);
  }
  const coachJson = await resCoach.json();
  const coachId = coachJson.user?.id;
  if (!coachId) {
    throw new Error('Signup did not return coach id');
  }

  const sql = `
    DO $$
    DECLARE
      v_aid uuid := '${athleteId}';
      v_cid uuid := '${coachId}';
      v_eid uuid;
      v_ename text;
      v_wid uuid := gen_random_uuid();
      v_set_id uuid := gen_random_uuid();
      v_date date := CURRENT_DATE - 2;
    BEGIN
      -- Ensure athlete and coach profiles with weight_unit = 'lb'
      INSERT INTO public.users (id, email, username, role, weight_unit)
      VALUES (v_aid, '${P6_ATHLETE_EMAIL}', 'P6 Athlete', 'athlete', 'lb')
      ON CONFLICT (id) DO UPDATE SET username = 'P6 Athlete', role = 'athlete', weight_unit = 'lb';

      INSERT INTO public.users (id, email, username, role, weight_unit)
      VALUES (v_cid, '${P6_COACH_EMAIL}', 'P6 Coach', 'coach', 'lb')
      ON CONFLICT (id) DO UPDATE SET username = 'P6 Coach', role = 'coach', weight_unit = 'lb';

      -- Link coach and athlete
      DELETE FROM public.coach_athlete_links WHERE athlete_id = v_aid;
      INSERT INTO public.coach_athlete_links (id, coach_id, athlete_id, status)
      VALUES (gen_random_uuid(), v_cid, v_aid, 'active');

      -- Pick target master exercise
      SELECT id, name INTO v_eid, v_ename FROM public.exercises WHERE is_master = true ORDER BY name LIMIT 1;

      -- Seed a past session (2 days ago) with 1 working set of 225 lb x 5 reps (lb_total = 1125)
      INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
      VALUES (v_wid, v_aid, 'P6 Benchmark Past Session', v_date, v_date::timestamptz + interval '10 hours');

      INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
      VALUES (v_set_id, v_wid, v_eid, 225, 5, 1, 'working', v_date::timestamptz + interval '10 hours 5 minutes');

      CREATE TEMP TABLE tmp_p6_seed AS
      SELECT v_aid AS aid, v_cid AS cid, v_eid AS eid, v_ename AS ename, v_wid AS wid, v_set_id AS sid;
    END $$;
    SELECT aid, cid, eid, ename, wid, sid FROM tmp_p6_seed;
  `;

  const cmd = getPsqlCommand();
  const rawOut = execSync(cmd, { input: sql, encoding: 'utf8' });

  const metaLine = rawOut.split('\n').filter((l) => l.includes(athleteId))[0];
  const parts = metaLine.split('|').map((s) => s.trim());

  return {
    athleteId: parts[0],
    coachId: parts[1],
    exerciseId: parts[2],
    exerciseName: parts[3],
    workoutId: parts[4],
    seededSetId: parts[5],
  };
}

async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', P6_ATHLETE_EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
}

async function loginAsCoach(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', P6_COACH_EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/coach');
}

test.describe('P6 Weight Units Suite (p6-weight-units)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    seedData = await seedP6UsersAndData();
  });

  test.afterAll(async () => {
    cleanupP6Users();
  });

  // (a) Settings: WeightUnitCard toggles lb -> kg, persists after reload (psql SELECT = 'kg'), back to lb works
  test('(a) Settings: WeightUnitCard toggles lb -> kg, persists after reload (psql SELECT = "kg"), back to lb works', async ({ page }) => {
    await loginAsAthlete(page);
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const lbBtn = page.locator('[data-testid="weight-unit-lb"]');
    const kgBtn = page.locator('[data-testid="weight-unit-kg"]');
    await expect(lbBtn).toBeVisible();
    await expect(kgBtn).toBeVisible();
    await expect(lbBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(kgBtn).toHaveAttribute('aria-pressed', 'false');

    // Toggle to kg
    await kgBtn.click();
    await expect(kgBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(lbBtn).toHaveAttribute('aria-pressed', 'false');

    // Verify in database via psql
    const cmd = getPsqlCommand();
    const dbUnitKg = execSync(
      `${cmd} -t -A -c "SELECT weight_unit FROM public.users WHERE id = '${seedData.athleteId}';"`,
      { encoding: 'utf8' }
    ).trim();
    expect(dbUnitKg).toBe('kg');

    // Persists after page reload
    await page.reload();
    await expect(page.locator('[data-testid="weight-unit-kg"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="weight-unit-lb"]')).toHaveAttribute('aria-pressed', 'false');

    // Toggle back to lb
    await page.locator('[data-testid="weight-unit-lb"]').click();
    await expect(page.locator('[data-testid="weight-unit-lb"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="weight-unit-kg"]')).toHaveAttribute('aria-pressed', 'false');

    const dbUnitLb = execSync(
      `${cmd} -t -A -c "SELECT weight_unit FROM public.users WHERE id = '${seedData.athleteId}';"`,
      { encoding: 'utf8' }
    ).trim();
    expect(dbUnitLb).toBe('lb');
  });

  // (b) kg athlete with a seeded 225 lb x 5 working set: History displays 102.1 kg, session volume 510 kg, exercise sheet PR and rows in kg, and no "lbs" text on /history
  test('(b) kg athlete with a seeded 225 lb x 5 working set: History displays 102.1 kg, session volume 510 kg, exercise sheet PR and rows in kg, and no "lbs" text on /history', async ({ page }) => {
    // Set athlete unit to kg via psql
    const cmd = getPsqlCommand();
    execSync(
      `${cmd} -c "UPDATE public.users SET weight_unit = 'kg' WHERE id = '${seedData.athleteId}';"`,
      { encoding: 'utf8' }
    );

    await loginAsAthlete(page);
    await page.goto('/history');
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible();

    // 1. By Session view: Past Session card
    const sessionCard = page.locator('div[data-civil-date]').first();
    await expect(sessionCard).toBeVisible({ timeout: 10000 });

    // Session volume: 225 * 5 = 1125 lb_total -> round(1125 * 0.45359237) = 510 kg
    const lbTotal = 225 * 5;
    const expectedKgVolume = Math.round(lbTotal * 0.45359237);
    await expect(sessionCard).toContainText(`${expectedKgVolume} kg`);

    // Verify set row inside session card (first session is auto-expanded by budget logic)
    const expandBtn = sessionCard.locator('[data-testid^="expand-session-btn-"]');
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 });
    await expect(sessionCard).toContainText('102.1 kg × 5 reps', { timeout: 10000 });

    // 2. By Exercise view: PR line in kg
    const exerciseTab = page.locator('[data-testid="history-subview-exercise"]');
    await exerciseTab.click();
    const exerciseCard = page.locator(`[data-testid="exercise-card-${seedData.exerciseId}"]`);
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await expect(exerciseCard).toContainText('PR: 102.1 kg × 5');

    // 3. Exercise History Sheet: PR summary and set rows in kg
    await exerciseCard.click();
    const exerciseSheet = page.locator('[data-testid="exercise-history-sheet"]');
    await expect(exerciseSheet).toBeVisible({ timeout: 10000 });

    const prSummary = exerciseSheet.locator('[data-testid="exercise-sheet-pr-summary"]');
    await expect(prSummary).toContainText('PR: 102.1 kg × 5');

    const sheetSetRow = exerciseSheet.locator(`[data-testid="exercise-history-set-${seedData.seededSetId}"]`);
    await expect(sheetSetRow).toBeVisible();
    await expect(sheetSetRow).toContainText('102.1 kg × 5');

    await page.keyboard.press('Escape');
    await expect(exerciseSheet).not.toBeVisible();

    // 4. Assert no 'lbs' text appears anywhere on /history
    await expect(page.getByText(/\blbs\b/)).toHaveCount(0);
  });

  // (c) Coach: lb coach inspecting kg athlete sees "lbs" (225), kg coach sees kg (102.1) in timeline and inspected History
  test('(c) Coach: lb coach inspecting kg athlete sees "lbs" (225), kg coach sees kg (102.1) in timeline and inspected History', async ({ page }) => {
    const cmd = getPsqlCommand();
    // Ensure athlete is kg and coach is lb
    execSync(
      `${cmd} -c "UPDATE public.users SET weight_unit = 'kg' WHERE id = '${seedData.athleteId}'; UPDATE public.users SET weight_unit = 'lb' WHERE id = '${seedData.coachId}';"`,
      { encoding: 'utf8' }
    );

    // 1. Log in as lb coach
    await loginAsCoach(page);
    await page.goto('/coach');
    await page.waitForURL('**/coach');
    await expect(page.locator('text=Coach Dashboard')).toBeVisible();

    // Select the athlete in cockpit
    const athleteSelect = page.locator('select').first();
    await athleteSelect.selectOption(seedData.athleteId);

    // Timeline shows lb
    await expect(page.locator(`button:has-text("${seedData.exerciseName}")`).first()).toBeVisible({ timeout: 10000 });
    await page.locator(`button:has-text("${seedData.exerciseName}")`).first().click();

    const setsContainerLb = page.locator(`[data-testid="exercise-sets-${seedData.exerciseId}"]`);
    await expect(setsContainerLb).toBeVisible();
    await expect(setsContainerLb).toContainText('5 reps × 225 lbs');

    // Inspected History as lb coach
    await page.goto('/history');
    await page.waitForURL('**/history');
    await expect(page.locator('[data-testid="coach-inspection-banner"]')).toBeVisible({ timeout: 10000 });

    const coachHistoryCardLb = page.locator('div[data-civil-date]').first();
    await expect(coachHistoryCardLb).toBeVisible();
    await expect(coachHistoryCardLb).toContainText('1,125 lbs');

    const coachExpandBtnLb = coachHistoryCardLb.locator('[data-testid^="expand-session-btn-"]');
    await expect(coachExpandBtnLb).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 });
    await expect(coachHistoryCardLb).toContainText('225 lbs × 5 reps');

    // 2. Switch coach's unit to kg
    execSync(
      `${cmd} -c "UPDATE public.users SET weight_unit = 'kg' WHERE id = '${seedData.coachId}';"`,
      { encoding: 'utf8' }
    );

    // Coach timeline in kg
    await page.goto('/coach');
    await page.waitForURL('**/coach');
    await athleteSelect.selectOption(seedData.athleteId);

    await expect(page.locator(`button:has-text("${seedData.exerciseName}")`).first()).toBeVisible({ timeout: 10000 });
    await page.locator(`button:has-text("${seedData.exerciseName}")`).first().click();

    const setsContainerKg = page.locator(`[data-testid="exercise-sets-${seedData.exerciseId}"]`);
    await expect(setsContainerKg).toBeVisible();
    await expect(setsContainerKg).toContainText('5 reps × 102.1 kg');

    // Inspected History as kg coach
    await page.goto('/history');
    await page.waitForURL('**/history');
    await expect(page.locator('[data-testid="coach-inspection-banner"]')).toBeVisible({ timeout: 10000 });

    const coachHistoryCardKg = page.locator('div[data-civil-date]').first();
    await expect(coachHistoryCardKg).toBeVisible();
    await expect(coachHistoryCardKg).toContainText('510 kg');

    const coachExpandBtnKg = coachHistoryCardKg.locator('[data-testid^="expand-session-btn-"]');
    await expect(coachExpandBtnKg).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 });
    await expect(coachHistoryCardKg).toContainText('102.1 kg × 5 reps');
  });

  // (d) kg athlete logs a set typing 100 in Workout -> psql shows sets.weight between 220.4622 and 220.4623 -> re-displays "100" kg in Workout and History; EditSetSheet saves without changing weight keeps sets.weight = 225 exactly
  test('(d) kg athlete logs a set typing 100 in Workout -> psql shows sets.weight between 220.4622 and 220.4623 -> re-displays "100" kg in Workout and History; EditSetSheet saves without changing weight keeps sets.weight = 225 exactly', async ({ page }) => {
    const cmd = getPsqlCommand();
    // Ensure athlete is in kg mode
    execSync(
      `${cmd} -c "UPDATE public.users SET weight_unit = 'kg' WHERE id = '${seedData.athleteId}';"`,
      { encoding: 'utf8' }
    );

    await loginAsAthlete(page);
    await page.goto('/workout?routine=Workout%20A%20(Push,%20Quads%20%26%20Core)');
    await page.waitForURL('**/workout**');

    const firstCard = page.locator('[data-testid="exercise-card-0"]');
    await expect(firstCard).toBeVisible({ timeout: 15000 });

    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');

    await expect(weightInput).toBeVisible();
    await weightInput.fill('100');
    await repsInput.fill('8');
    await commitBtn.click();

    // Logged row appears and displays '100'
    const loggedRow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow).toBeVisible({ timeout: 10000 });
    await expect(loggedRow).toContainText('100');

    // Query psql for the newly inserted set: weight must be between 220.4622 and 220.4623
    const readNewSetWeight = (): number => {
      const str = execSync(
        `${cmd} -t -A -c "SELECT weight FROM public.sets WHERE workout_id IN (SELECT id FROM public.workouts WHERE user_id = '${seedData.athleteId}') AND id != '${seedData.seededSetId}' ORDER BY created_at DESC LIMIT 1;"`,
        { encoding: 'utf8' }
      ).trim();
      return str ? parseFloat(str) : 0;
    };
    await expect.poll(readNewSetWeight, { timeout: 5000 }).toBeGreaterThan(0);
    const newSetWeight = readNewSetWeight();
    expect(newSetWeight).toBeGreaterThanOrEqual(220.4622);
    expect(newSetWeight).toBeLessThanOrEqual(220.4623);

    // History re-displays '100' kg
    await page.goto('/history');
    await page.waitForURL('**/history');

    // Today's session is auto-expanded and contains '100 kg × 8 reps'
    await expect(page.locator('main')).toContainText('100 kg × 8 reps', { timeout: 10000 });

    // EditSetSheet opened on the seeded 225 lb set in kg mode and saved without changing weight
    const editBtn = page.locator(`[data-testid="edit-set-btn-${seedData.seededSetId}"]`);
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    const editSheet = page.locator('[data-testid="edit-set-sheet"]');
    await expect(editSheet).toBeVisible({ timeout: 10000 });

    // Weight input prefilled with '102.1'
    const editWeightInput = editSheet.locator('[data-testid="edit-set-weight-input"]');
    await expect(editWeightInput).toHaveValue('102.1');

    // Leave weight untouched, modify reps to 6
    const editRepsInput = editSheet.locator('[data-testid="edit-set-reps-input"]');
    await editRepsInput.fill('6');

    // Save changes
    const saveBtn = editSheet.locator('[data-testid="save-set-btn"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(editSheet).not.toBeVisible();

    // Verify in psql: sets.weight remains 225 exactly
    const seededWeightStr = execSync(
      `${cmd} -t -A -c "SELECT weight FROM public.sets WHERE id = '${seedData.seededSetId}';"`,
      { encoding: 'utf8' }
    ).trim();
    expect(parseFloat(seededWeightStr)).toBe(225);
  });

  // (e) 320px: no horizontal overflow on Settings with the card, and /workout in kg mode
  test('(e) 320px: no horizontal overflow on Settings with the card, and /workout in kg mode', async ({ page }) => {
    const cmd = getPsqlCommand();
    execSync(
      `${cmd} -c "UPDATE public.users SET weight_unit = 'kg' WHERE id = '${seedData.athleteId}';"`,
      { encoding: 'utf8' }
    );

    await page.setViewportSize({ width: 320, height: 600 });
    await loginAsAthlete(page);

    // 1. Settings view at 320px
    await page.goto('/settings');
    await page.waitForURL('**/settings');
    await expect(page.locator('[data-testid="weight-unit-kg"]')).toBeVisible();

    const weightCard = page.locator('fieldset[aria-label="Weight unit"]').locator('xpath=ancestor::div[contains(@class, "rounded-3xl")][1]');
    await expect(weightCard).toBeVisible();

    const cardOverflow = await weightCard.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    expect(cardOverflow, 'No horizontal overflow on WeightUnitCard at 320px').toBe(false);

    // 2. Workout view in kg mode at 320px
    await page.goto('/workout?routine=Workout%20A%20(Push,%20Quads%20%26%20Core)');
    await page.waitForURL('**/workout**');
    await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible({ timeout: 15000 });

    const workoutOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(workoutOverflow, 'No horizontal overflow on /workout at 320px in kg mode').toBe(false);
  });
});
