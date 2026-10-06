import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

const P5B_USER_EMAIL = 'p5b-history-e2e@yourbody.fyi';
const P5B_USER_PASSWORD = 'password123';
const COACH_EMAIL = 'coach@yourbody.fyi';
const COACH_PASSWORD = 'password123';

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

interface P5bSeedData {
  userId: string;
  exerciseId: string;
  exerciseName: string;
  meal1Id: string;
  meal2Id: string;
  meal3Id: string;
  targetOlderCivilDate: string;
  firstCivilDate: string;
  monthDiff: number;
}

let seedData: P5bSeedData;

function cleanupP5bUser() {
  const sql = `
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (
      SELECT id FROM auth.users WHERE email = '${P5B_USER_EMAIL}'
    );
    DELETE FROM auth.users WHERE email = '${P5B_USER_EMAIL}';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p5b-history] Cleanup error:', err);
    throw err;
  }
}

async function seedP5bUserAndData(): Promise<P5bSeedData> {
  cleanupP5bUser();

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: P5B_USER_EMAIL,
      password: P5B_USER_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to signup test user: ${res.status} ${await res.text()}`);
  }
  const signupData = await res.json();
  const userId = signupData.user?.id;
  if (!userId) {
    throw new Error('Signup did not return a user id');
  }

  const sql = `
    DO $$
    DECLARE
      v_uid uuid := '${userId}';
      v_coach_id uuid := 'a0000000-0000-0000-0000-000000000001';
      v_eid uuid;
      v_eid_filler uuid;
      v_ename text;
      v_wid uuid;
      v_date date;
      v_m1 uuid := gen_random_uuid();
      v_m2 uuid := gen_random_uuid();
      v_m3 uuid := gen_random_uuid();
    BEGIN
      -- Ensure profile username and coach link
      INSERT INTO public.users (id, email, username, role)
      VALUES (v_uid, '${P5B_USER_EMAIL}', 'P5b Test Athlete', 'athlete')
      ON CONFLICT (id) DO UPDATE SET username = 'P5b Test Athlete', role = 'athlete';

      DELETE FROM public.coach_athlete_links WHERE athlete_id = v_uid;
      INSERT INTO public.coach_athlete_links (id, coach_id, athlete_id, status)
      VALUES (gen_random_uuid(), v_coach_id, v_uid, 'active');

      -- Pick target exercise for H8
      SELECT id, name INTO v_eid, v_ename FROM public.exercises WHERE is_master = true ORDER BY name LIMIT 1;
      SELECT id INTO v_eid_filler FROM public.exercises WHERE is_master = true AND id <> v_eid ORDER BY name LIMIT 1;

      -- 1. Session 0 (Benchmark session, CURRENT_DATE)
      -- 4 working sets (PR: 245x6) + 2 warmup sets (45x10, 65x10)
      v_date := CURRENT_DATE;
      v_wid := gen_random_uuid();
      INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
      VALUES (v_wid, v_uid, 'P5b Special Benchmark Session', v_date, v_date::timestamptz + interval '10 hours');

      INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
      VALUES
        (gen_random_uuid(), v_wid, v_eid, 245, 6, 1, 'working', v_date::timestamptz + interval '10 hours 5 minutes'),
        (gen_random_uuid(), v_wid, v_eid, 225, 6, 2, 'working', v_date::timestamptz + interval '10 hours 10 minutes'),
        (gen_random_uuid(), v_wid, v_eid, 205, 8, 3, 'working', v_date::timestamptz + interval '10 hours 15 minutes'),
        (gen_random_uuid(), v_wid, v_eid, 185, 10, 4, 'working', v_date::timestamptz + interval '10 hours 20 minutes'),
        (gen_random_uuid(), v_wid, v_eid, 45, 10, 5, 'warmup', v_date::timestamptz + interval '10 hours 1 minutes'),
        (gen_random_uuid(), v_wid, v_eid, 65, 10, 6, 'warmup', v_date::timestamptz + interval '10 hours 3 minutes');

      -- 2. Sessions 1..4 (4 sessions within 30 days): 3 working sets each = 12 sets
      -- Total working sets in 30d = 4 + 12 = 16 working sets across 5 sessions
      FOR i IN 1..4 LOOP
        v_date := CURRENT_DATE - (1 + i);
        v_wid := gen_random_uuid();
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES (v_wid, v_uid, 'P5b Routine Session ' || i, v_date, v_date::timestamptz + interval '10 hours');

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES
          (gen_random_uuid(), v_wid, v_eid, 225, 6, 1, 'working', v_date::timestamptz + interval '10 hours 5 minutes'),
          (gen_random_uuid(), v_wid, v_eid, 205, 8, 2, 'working', v_date::timestamptz + interval '10 hours 10 minutes'),
          (gen_random_uuid(), v_wid, v_eid, 185, 10, 3, 'working', v_date::timestamptz + interval '10 hours 15 minutes');
      END LOOP;

      -- 3. Sessions 5..8 (4 sessions older than 30 days): 2 working sets each = 8 sets
      -- Total all-time working sets = 16 + 8 = 24 working sets across 9 sessions
      FOR i IN 5..8 LOOP
        v_date := CURRENT_DATE - (35 + (i - 5) * 5);
        v_wid := gen_random_uuid();
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES (v_wid, v_uid, 'P5b Older Session ' || i, v_date, v_date::timestamptz + interval '10 hours');

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES
          (gen_random_uuid(), v_wid, v_eid, 205, 8, 1, 'working', v_date::timestamptz + interval '10 hours 5 minutes'),
          (gen_random_uuid(), v_wid, v_eid, 185, 10, 2, 'working', v_date::timestamptz + interval '10 hours 10 minutes');
      END LOOP;

      -- 4. Sessions 9..34 (26 filler sessions dated 6..31 days ago)
      -- Using v_eid_filler so target exercise sets remain strictly 24 sets across 9 sessions
      FOR i IN 9..34 LOOP
        v_date := CURRENT_DATE - (6 + (i - 9));
        v_wid := gen_random_uuid();
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES (v_wid, v_uid, 'P5b Filler Session ' || i, v_date, v_date::timestamptz + interval '9 hours');

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES (gen_random_uuid(), v_wid, v_eid_filler, 135, 10, 1, 'working', v_date::timestamptz + interval '9 hours 5 minutes');
      END LOOP;

      -- 5. Seed nutrition logs
      -- (e) 3 meal rows on CURRENT_DATE for delete / undo / keepalive tests
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
      VALUES
        (v_m1, v_uid, 'P5b Undo Breakfast', 450, 35, 40, 15, 5, CURRENT_DATE::timestamptz + interval '8 hours', CURRENT_DATE),
        (v_m2, v_uid, 'P5b Expire Lunch', 600, 45, 55, 20, 7, CURRENT_DATE::timestamptz + interval '12 hours', CURRENT_DATE),
        (v_m3, v_uid, 'P5b KeepAlive Dinner', 750, 50, 65, 25, 10, CURRENT_DATE::timestamptz + interval '18 hours', CURRENT_DATE);

      -- (f) Gapped meals spanning 40 days
      -- Day 5: 2 meals (400 + 600 = 1000 kcal)
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
      VALUES
        (gen_random_uuid(), v_uid, 'P5b Day 5 Meal A', 400, 30, 40, 12, 4, (CURRENT_DATE - 5)::timestamptz + interval '8 hours', CURRENT_DATE - 5),
        (gen_random_uuid(), v_uid, 'P5b Day 5 Meal B', 600, 40, 60, 20, 6, (CURRENT_DATE - 5)::timestamptz + interval '13 hours', CURRENT_DATE - 5);

      -- Day 20: 1 meal (750 kcal)
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
      VALUES
        (gen_random_uuid(), v_uid, 'P5b Day 20 Meal', 750, 50, 70, 25, 8, (CURRENT_DATE - 20)::timestamptz + interval '12 hours', CURRENT_DATE - 20);

      -- Day 40: 2 meals (300 + 500 = 800 kcal)
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
      VALUES
        (gen_random_uuid(), v_uid, 'P5b Day 40 Meal A', 300, 25, 30, 10, 3, (CURRENT_DATE - 40)::timestamptz + interval '9 hours', CURRENT_DATE - 40),
        (gen_random_uuid(), v_uid, 'P5b Day 40 Meal B', 500, 35, 50, 18, 5, (CURRENT_DATE - 40)::timestamptz + interval '18 hours', CURRENT_DATE - 40);

      -- Store metadata in a temp table to query back
      CREATE TEMP TABLE tmp_p5b_seed AS
      SELECT v_uid AS uid, v_eid AS eid, v_ename AS ename, v_m1 AS m1, v_m2 AS m2, v_m3 AS m3;
    END $$;
    SELECT uid, eid, ename, m1, m2, m3 FROM tmp_p5b_seed;
  `;
  const cmd = getPsqlCommand();
  const rawOut = execSync(cmd, { input: sql, encoding: 'utf8' });

  // Query metadata
  const metaLine = rawOut.split('\n').filter((l) => l.includes(userId))[0];
  const parts = metaLine.split('|').map((s) => s.trim());
  const exerciseId = parts[1];
  const exerciseName = parts[2];
  const meal1Id = parts[3];
  const meal2Id = parts[4];
  const meal3Id = parts[5];

  // Query date of session 33 (index 32, offset 32), guaranteed to be on page 2
  const targetOlderCivilDate = execSync(
    `${cmd} -t -A -c "SELECT workout_date FROM public.workouts WHERE user_id = '${userId}' ORDER BY workout_date DESC, id DESC OFFSET 32 LIMIT 1;"`,
    { encoding: 'utf8' }
  ).trim();

  // Query date of session 0 (most recent)
  const firstCivilDate = execSync(
    `${cmd} -t -A -c "SELECT workout_date FROM public.workouts WHERE user_id = '${userId}' ORDER BY workout_date DESC, id DESC LIMIT 1;"`,
    { encoding: 'utf8' }
  ).trim();

  const startYear = parseInt(firstCivilDate.slice(0, 4), 10);
  const startMonth = parseInt(firstCivilDate.slice(5, 7), 10);
  const targetYear = parseInt(targetOlderCivilDate.slice(0, 4), 10);
  const targetMonth = parseInt(targetOlderCivilDate.slice(5, 7), 10);
  const monthDiff = (startYear - targetYear) * 12 + (startMonth - targetMonth);

  return {
    userId,
    exerciseId,
    exerciseName,
    meal1Id,
    meal2Id,
    meal3Id,
    targetOlderCivilDate,
    firstCivilDate,
    monthDiff,
  };
}

async function loginAsP5bAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', P5B_USER_EMAIL);
  await page.fill('input[type="password"]', P5B_USER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
  await expect(page.locator('[data-testid="workout-date-input"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="nav-history"]').click({ force: true });
  await page.waitForURL('**/history');
  await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
}

async function loginAsCoach(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', COACH_EMAIL);
  await page.fill('input[type="password"]', COACH_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/coach', { timeout: 15000 });
}

test.describe('History Suite (p5b-history)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    seedData = await seedP5bUserAndData();
  });

  test.afterAll(async () => {
    cleanupP5bUser();
  });

  // (a): exercise history sheet shows session groups, working sets, PR badge, and 30D filter
  test('(a) exercise sheet displays session groups, 24 working sets without warmups, PR badge, and 30D range limit', async ({ page }) => {
    await loginAsP5bAthlete(page);

    // Switch to By Exercise view
    const exerciseTab = page.locator('[data-testid="history-subview-exercise"]');
    await expect(exerciseTab).toBeVisible({ timeout: 10000 });
    await exerciseTab.click();
    await expect(exerciseTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="all-time-stats-caption"]')).toBeVisible({ timeout: 10000 });

    // Find and open target exercise card
    const exerciseCard = page.locator(`[data-testid="exercise-card-${seedData.exerciseId}"]`);
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await expect(exerciseCard).toContainText('PR: 245 lbs × 6');

    await exerciseCard.click();
    const sheet = page.locator('[data-testid="exercise-history-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // 2 warmup sets (45 lbs, 65 lbs) must NOT appear
    await expect(sheet.getByText(/^45 lbs ×/)).toHaveCount(0);
    await expect(sheet.getByText(/^65 lbs ×/)).toHaveCount(0);

    // 9 sessions fit in one 10-session page (ExerciseHistorySheet limit 10): no Load older button
    const loadOlderBtn = sheet.locator('[data-testid="load-older-btn"]');
    await expect(sheet.locator('[data-testid^="exercise-session-group-"]').first()).toBeVisible({ timeout: 10000 });
    await expect(loadOlderBtn).toHaveCount(0);

    // All 24 working sets in 9 session groups are visible
    const sessionGroups = sheet.locator('[data-testid^="exercise-session-group-"]');
    const setRows = sheet.locator('[data-testid^="exercise-history-set-"]');
    await expect(sessionGroups).toHaveCount(9);
    await expect(setRows).toHaveCount(24);

    // Session headers have human dates (weekday, month day)
    const firstGroupHeader = sessionGroups.first().locator('span.text-cyan-400').first();
    const headerText = await firstGroupHeader.innerText();
    expect(headerText).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d+/);

    // PR row carries PR badge matching the card's PR (245 lbs x 6)
    const prBadge = sheet.locator('[data-testid="pr-badge"]');
    await expect(prBadge).toBeVisible();
    const prSetRow = sheet.locator('[data-testid^="exercise-history-set-"]:has([data-testid="pr-badge"])');
    await expect(prSetRow).toContainText('245 lbs × 6');

    // Range chip 30D limits groups to the last 30 days (5 groups, 16 sets)
    const chip30D = sheet.locator('[data-testid="range-chip-30d"]');
    await chip30D.click();
    await expect(sessionGroups).toHaveCount(5);
    await expect(setRows).toHaveCount(16);

    // Range chip All restores all 9 groups
    const chipAll = sheet.locator('[data-testid="range-chip-all"]');
    await chipAll.click();
    await expect(sessionGroups).toHaveCount(9);
    await expect(setRows).toHaveCount(24);

    // Close sheet
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  // (b) coach read-only: linked coach inspects athlete with no edit affordance and no session overflow menu
  test('(b) coach read-only: linked coach inspects athlete with no edit affordance and no session ⋯ menu', async ({ page }) => {
    await loginAsCoach(page);

    // Select our athlete in CoachCockpit
    const athleteSelect = page.locator('[data-testid="coach-athlete-select"], select').first();
    await expect(athleteSelect).toBeVisible({ timeout: 10000 });
    await athleteSelect.selectOption(seedData.userId);

    // Navigate to /history
    await page.goto('/history');
    await page.waitForURL('**/history');

    // Inspection banner is visible
    await expect(page.locator('[data-testid="coach-inspection-banner"]')).toBeVisible({ timeout: 10000 });

    // Session ⋯ menu is completely absent in By Session view
    await expect(page.locator('button[data-testid^="session-actions-"]')).toHaveCount(0);

    // Switch to By Exercise view
    await page.locator('[data-testid="history-subview-exercise"]').click();
    const exerciseCard = page.locator(`[data-testid="exercise-card-${seedData.exerciseId}"]`);
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });
    await exerciseCard.click();

    // Sheet opens in coach read-only mode
    const sheet = page.locator('[data-testid="exercise-history-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await expect(sheet.locator('text=Coach View (Read-only)')).toBeVisible();

    // Set rows have no edit affordance (not buttons, no Edit2 icon)
    await expect(sheet.locator('button[data-testid^="exercise-history-set-"]')).toHaveCount(0);
    await expect(sheet.locator('.lucide-edit-2, .lucide-edit')).toHaveCount(0);
    const setRows = sheet.locator('[data-testid^="exercise-history-set-"]');
    await expect(setRows.first()).toBeVisible();
    await expect(setRows.first()).not.toHaveAttribute('role', 'button');

    // Close sheet
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  // (c) calendar: month grid dots, tapping older day loads page and scrolls/focuses card
  test('(c) calendar: month grid dots on seeded days, tapping older day not on page 1 scrolls into view and focuses card', async ({ page }) => {
    await loginAsP5bAthlete(page);

    // Initial page shows 30 of 35 sessions
    const countBanner = page.locator('[data-testid="showing-sessions-count"]');
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });

    // Target day (session 33) is NOT on page 1
    const targetCardLocator = page.locator(`[data-civil-date="${seedData.targetOlderCivilDate}"]`);
    expect(await targetCardLocator.count()).toBe(0);

    // Open calendar sheet
    const openCalendarBtn = page.locator('[data-testid="open-calendar-btn"]');
    await expect(openCalendarBtn).toBeVisible({ timeout: 10000 });
    await openCalendarBtn.click();

    const calendarSheet = page.locator('[data-testid="history-calendar-sheet"]');
    await expect(calendarSheet).toBeVisible({ timeout: 10000 });

    // Verify dots on seeded days
    await expect(page.locator('[data-testid^="workout-dot-"]').first()).toBeVisible();

    // Navigate month backwards if target date is in previous month(s)
    for (let i = 0; i < seedData.monthDiff; i++) {
      await page.click('[data-testid="calendar-prev-month-btn"]');
    }

    // Dot exists on target day
    const targetDot = page.locator(`[data-testid="workout-dot-${seedData.targetOlderCivilDate}"]`);
    await expect(targetDot).toBeVisible();

    // Tap target older day
    const dayBtn = page.locator(`button[data-date="${seedData.targetOlderCivilDate}"]`);
    await dayBtn.click();

    // Sheet closes
    await expect(calendarSheet).not.toBeVisible();

    // Session card for targetOlderCivilDate is loaded, scrolled into view, and focused
    await expect(targetCardLocator).toBeVisible({ timeout: 10000 });
    await expect(targetCardLocator).toBeFocused();

    // All 35 sessions are now loaded
    await expect(countBanner).toHaveText('Showing 35 of 35 sessions');
  });

  // (d): search filters sessions with match count and Clear filters restores
  test('(d) By-Session search filters with match count and Clear filters restores', async ({ page }) => {
    await loginAsP5bAthlete(page);

    const searchInput = page.locator('[data-testid="session-search-input"]');
    const countBanner = page.locator('[data-testid="showing-sessions-count"]');

    // Search for seeded session name
    await searchInput.fill('Special Benchmark');
    await expect(countBanner).toHaveText(/Showing 1 matches in \d+ loaded sessions/, { timeout: 10000 });
    await expect(page.locator('text=P5b Special Benchmark Session')).toBeVisible();

    // Search with 0 matches reveals Clear filters button
    await searchInput.fill('XYZNoMatchingSession987');
    await expect(countBanner).toHaveText(/Showing 0 matches in \d+ loaded sessions/, { timeout: 10000 });
    const clearFiltersBtn = page.locator('[data-testid="clear-filters-btn"]');
    await expect(clearFiltersBtn).toBeVisible({ timeout: 10000 });

    // Click Clear filters to restore
    await clearFiltersBtn.click();
    await expect(searchInput).toHaveValue('');
    await expect(countBanner).toHaveText(/Showing \d+ of 35 sessions/, { timeout: 10000 });
    await expect(page.locator('text=P5b Special Benchmark Session')).toBeVisible();
  });

  // (e) /: nutrition deferred delete, Undo restores with 0 DELETE, expiry sends 1 DELETE, tab switch flushes
  test('(e) nutrition deferred delete undo, expiry, and keep-alive flush', async ({ page }) => {
    let deleteCount = 0;
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/nutrition_logs')) {
        deleteCount++;
      }
    });

    await loginAsP5bAthlete(page);

    // Switch to Nutrition tab
    const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
    await nutritionTab.click();

    // Days start collapsed by default (D-YB-9). Expand day to reveal meals.
    const expandBtn = page.locator('button[data-testid^="expand-day-btn-"]').first();
    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    await expandBtn.click();
    await expect(page.locator('text=P5b Undo Breakfast')).toBeVisible({ timeout: 10000 });

    const toast = page.locator('[data-testid="quick-log-toast"]');

    // Helper to trigger delete meal reliably across viewports and virtualizer stacking
    const clickDeleteMeal = async (mealId: string) => {
      const actionsBtn = page.locator(`button[data-testid="meal-actions-${mealId}"]`);
      await actionsBtn.scrollIntoViewIfNeeded();
      await actionsBtn.click();
      const deleteBtn = page.locator(`[data-testid="delete-meal-${mealId}"]`);
      await expect(deleteBtn).toBeAttached();
      await deleteBtn.evaluate((el: HTMLElement) => el.click());
    };

    // 1. Delete Meal 1 -> UndoToast 'Meal deleted' -> Undo restores with 0 DELETE
    await clickDeleteMeal(seedData.meal1Id);

    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Meal deleted');

    const undoBtn = page.locator('[data-testid="toast-undo-btn"]');
    await undoBtn.click({ force: true });
    await expect(toast).not.toBeVisible();
    await expect(page.locator('text=P5b Undo Breakfast')).toBeVisible();
    expect(deleteCount).toBe(0);

    // 2. Delete Meal 2 -> wait for expiry (~6 s) via expect.poll -> exactly 1 DELETE
    await clickDeleteMeal(seedData.meal2Id);

    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Meal deleted');

    await expect.poll(() => deleteCount, { timeout: 12000, intervals: [200] }).toBe(1);
    await expect(toast).not.toBeVisible();

    // 3. Delete Meal 3 -> click Workout tab -> exactly 1 DELETE fires (keep-alive flush)
    await clickDeleteMeal(seedData.meal3Id);

    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Meal deleted');

    const workoutNav = page.locator('[data-testid="nav-workout"]');
    await workoutNav.click({ force: true });
    await page.waitForURL('**/workout');

    await expect.poll(() => deleteCount, { timeout: 6000, intervals: [100] }).toBe(2);
  });

  // (f): nutrition window paging reaches oldest day with human date headers and full totals
  test('(f) nutrition logs spanning 40 days page to oldest day with human date headers and full totals', async ({ page }) => {
    await loginAsP5bAthlete(page);

    const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
    await expect(nutritionTab).toBeVisible({ timeout: 10000 });
    await nutritionTab.click();
    await expect(nutritionTab).toHaveAttribute('aria-selected', 'true');

    const loadOlderBtn = page.locator('[data-testid="load-more-nutrition-btn"]');
    await expect(loadOlderBtn).toBeVisible({ timeout: 10000 });
    await loadOlderBtn.scrollIntoViewIfNeeded();

    // Day 5 is in window 1 (rendered into view). Expand day card (D-YB-9).
    const day5Card = page.locator('.rounded-3xl').filter({ hasText: '1000 kcal' });
    const day5Expand = day5Card.locator('button[data-testid^="expand-day-btn-"]');
    await expect(day5Expand).toBeVisible({ timeout: 10000 });
    await day5Expand.click();
    await expect(page.locator('text=P5b Day 5 Meal A')).toBeVisible({ timeout: 10000 });
    const day5Header = day5Card.locator('h3').first();
    const day5HeaderText = await day5Header.innerText();
    expect(day5HeaderText).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d+/);
    expect(day5HeaderText).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Sum of seeded rows for Day 5 (400 + 600 = 1000 kcal)
    await expect(day5Card).toContainText(/1,?000 kcal/);

    // Click Load older days to load window 2 (Day 20)
    await expect(loadOlderBtn).toBeVisible({ timeout: 10000 });
    await loadOlderBtn.click();
    await loadOlderBtn.scrollIntoViewIfNeeded();
    const day20Card = page.locator('.rounded-3xl').filter({ hasText: '750 kcal' });
    const day20Expand = day20Card.locator('button[data-testid^="expand-day-btn-"]');
    await expect(day20Expand).toBeVisible({ timeout: 10000 });
    await day20Expand.click();
    await expect(page.locator('text=P5b Day 20 Meal')).toBeVisible({ timeout: 10000 });

    // Click Load older days to load window 3 (Day 40)
    await expect(loadOlderBtn).toBeVisible({ timeout: 10000 });
    await loadOlderBtn.click();
    const day40Card = page.locator('.rounded-3xl').filter({ hasText: '800 kcal' });
    const day40Expand = day40Card.locator('button[data-testid^="expand-day-btn-"]');
    await expect(day40Expand).toBeVisible({ timeout: 10000 });
    await day40Expand.click();
    await expect(page.locator('text=P5b Day 40 Meal A')).toBeVisible({ timeout: 10000 });

    // Day 40 total is 300 + 500 = 800 kcal
    await expect(day40Card).toContainText('800 kcal');

    // Oldest day reached -> Load older days button disappears
    await expect(loadOlderBtn).not.toBeVisible();
  });

  // (g) 320px: no horizontal overflow in exercise sheet, calendar sheet, and nutrition timeline
  test('(g) 320px: no horizontal overflow in exercise sheet, calendar sheet, and nutrition timeline', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await loginAsP5bAthlete(page);

    // 1. Nutrition timeline
    const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
    await nutritionTab.click();
    await expect(nutritionTab).toHaveAttribute('aria-selected', 'true');

    const hasOverflowNutrition = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflowNutrition, 'No horizontal overflow in Nutrition timeline at 320px').toBe(false);

    // 2. Calendar sheet
    const workoutsTab = page.locator('[data-testid="history-tab-workouts"]');
    await workoutsTab.click();
    const openCalendarBtn = page.locator('[data-testid="open-calendar-btn"]');
    await openCalendarBtn.click();

    const calendarSheet = page.locator('[data-testid="history-calendar-sheet"]');
    await expect(calendarSheet).toBeVisible({ timeout: 10000 });

    const hasOverflowCalendar = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflowCalendar, 'No horizontal overflow in Calendar sheet at 320px').toBe(false);

    await page.keyboard.press('Escape');
    await expect(calendarSheet).not.toBeVisible();

    // 3. Exercise sheet
    const exerciseSubTab = page.locator('[data-testid="history-subview-exercise"]');
    await exerciseSubTab.click();

    const exerciseCard = page.locator(`[data-testid="exercise-card-${seedData.exerciseId}"]`);
    await exerciseCard.click();

    const exerciseSheet = page.locator('[data-testid="exercise-history-sheet"]');
    await expect(exerciseSheet).toBeVisible({ timeout: 10000 });

    const hasOverflowExercise = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflowExercise, 'No horizontal overflow in Exercise sheet at 320px').toBe(false);

    await page.keyboard.press('Escape');
    await expect(exerciseSheet).not.toBeVisible();
  });
});
