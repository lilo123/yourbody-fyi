import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

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

function cleanupPollutedWorkouts() {
  const sql = `
    DELETE FROM public.sets
    WHERE workout_id IN (
      SELECT id FROM public.workouts
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND name <> 'Push Day Benchmark'
    );
    DELETE FROM public.workouts
    WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
      AND name <> 'Push Day Benchmark';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p4-catalog] Error cleaning up polluted workouts:', err);
    throw err;
  }
}

function cleanupP4Data() {
  const sql = `
    DELETE FROM public.template_exercises
    WHERE template_id IN (
      SELECT id FROM public.routine_templates
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND name LIKE 'P4 Test Routine %'
    );
    DELETE FROM public.routine_templates
    WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
      AND name LIKE 'P4 Test Routine %';
    DELETE FROM public.sets
    WHERE exercise_id IN (
      SELECT id FROM public.exercises
      WHERE (name LIKE 'Zercher%' OR name LIKE '%Zercher Hold%')
        AND user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
    );
    DELETE FROM public.template_exercises
    WHERE exercise_id IN (
      SELECT id FROM public.exercises
      WHERE (name LIKE 'Zercher%' OR name LIKE '%Zercher Hold%')
        AND user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
    );
    DELETE FROM public.exercises
    WHERE (name LIKE 'Zercher%' OR name LIKE '%Zercher Hold%')
      AND user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi');
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p4-catalog] Error cleaning up P4 seed data:', err);
    throw err;
  }
  cleanupPollutedWorkouts();
}

async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
  await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-testid="nav-workout"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function getAthleteSession(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email: 'athlete@yourbody.fyi',
      password: 'password123',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to authenticate athlete: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { token: json.access_token, userId: json.user.id };
}

async function seedTemplatesViaREST(token: string, userId: string, count = 55) {
  const exRes = await fetch(`${SUPABASE_URL}/rest/v1/exercises?select=id&limit=1`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  const exercises = await exRes.json();
  const sampleExerciseId = exercises[0]?.id;

  const templates = Array.from({ length: count }, (_, i) => ({
    user_id: userId,
    name: `P4 Test Routine ${String(i + 1).padStart(2, '0')}`,
    is_master: false,
    days_of_week: [],
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/routine_templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(templates),
  });

  if (!res.ok) {
    throw new Error(`Failed to seed routine_templates: ${res.status} ${await res.text()}`);
  }

  const created = await res.json();

  const tpl55 = created.find((t: any) => t.name === 'P4 Test Routine 55');
  if (tpl55 && sampleExerciseId) {
    await fetch(`${SUPABASE_URL}/rest/v1/template_exercises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        template_id: tpl55.id,
        exercise_id: sampleExerciseId,
        order_index: 0,
        target_sets: 3,
        target_reps: 10,
      }),
    });
  }
}

function getVisibleExercisesFromDB(): Array<{ name: string; body_part: string }> {
  const sql = `
    SELECT name, COALESCE(array_to_string(body_parts, ' · '), '')
    FROM public.exercises
    WHERE is_archived = false
      AND (is_master = true OR user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi'))
    ORDER BY lower(name) ASC, id ASC
    LIMIT 50;
  `;
  const cmd = `${getPsqlCommand()} -t -A -F "|"`;
  const out = execSync(cmd, { input: sql, encoding: 'utf8' });
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, body_part] = line.split('|');
      return { name: name.trim(), body_part: (body_part || '').trim() };
    });
}

function getPushDayBenchmarkExercises(): string[] {
  const sql = `
    SELECT DISTINCT e.name
    FROM public.workouts w
    JOIN public.sets s ON s.workout_id = w.id
    JOIN public.exercises e ON e.id = s.exercise_id
    WHERE w.name = 'Push Day Benchmark'
      AND w.user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
    ORDER BY e.name;
  `;
  const cmd = `${getPsqlCommand()} -t -A -F "|"`;
  const out = execSync(cmd, { input: sql, encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((s) => s.trim());
}

test.describe('P4 Catalog & E2E Verification (p4-catalog)', () => {
  test.describe.configure({ mode: 'serial' });

  let athleteUserId = '';
  let athleteToken = '';

  test.beforeAll(async () => {
    cleanupP4Data();
    const session = await getAthleteSession();
    athleteUserId = session.userId;
    athleteToken = session.token;
    await seedTemplatesViaREST(athleteToken, athleteUserId, 55);
  });

  test.afterAll(async () => {
    cleanupP4Data();
  });

  // (c) Library + History data-independent permanent check at 390px
  test('DOM-diff acceptance: Library and History data-independent verification at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsAthlete(page);

    // 1. Verify Library (/exercises) renders all visible exercises with their name and body_part text
    await page.locator('[data-testid="nav-exercises"]').click();
    await page.waitForURL('**/exercises');
    await expect(page.locator('h3:has-text("Exercise Library")')).toBeVisible({ timeout: 10000 });

    const visibleExercises = getVisibleExercisesFromDB();
    expect(visibleExercises.length).toBeGreaterThan(0);

    const libraryCards = page.locator('div.space-y-2 > div[class*="bg-zinc-900/50"]');
    await expect(libraryCards.first()).toBeVisible({ timeout: 10000 });
    await expect(libraryCards).toHaveCount(visibleExercises.length);

    for (let i = 0; i < visibleExercises.length; i++) {
      const card = libraryCards.nth(i);
      const expected = visibleExercises[i];
      await expect(card.locator('div.text-zinc-100 > span').first()).toHaveText(expected.name);
      await expect(card.locator('[data-testid="exercise-row-subtitle"]')).toHaveText(expected.body_part);
    }

    // 2. Verify History (/history) renders the seeded 'Push Day Benchmark' session with its exercise names
    await page.locator('[data-testid="nav-history"]').click();
    await page.waitForURL('**/history');

    const benchmarkSession = page.locator('div.rounded-3xl.p-5.shadow-2xl.space-y-3:has(h3:has-text("Push Day Benchmark"))');
    await expect(benchmarkSession).toBeVisible({ timeout: 10000 });

    const expectedExercises = getPushDayBenchmarkExercises();
    expect(expectedExercises.length).toBeGreaterThan(0);
    for (const exName of expectedExercises) {
      await expect(benchmarkSession.locator(`span:has-text("${exName}")`).first()).toBeVisible();
    }

    // 3. Verify By-Exercise view is reachable and renders exercise stats without error
    const byExerciseTab = page.locator('button:has-text("By Exercise")');
    await byExerciseTab.click();
    const exerciseSearch = page.locator('input[placeholder*="Search exercise"]');
    await expect(exerciseSearch).toBeVisible({ timeout: 10000 });
    const historyExerciseCards = page.locator(`h3:has-text("${expectedExercises[0]}")`);
    await expect(historyExerciseCards.first()).toBeVisible({ timeout: 10000 });
  });

  // (a) Routine picker displays >50 templates with keyset pagination and #51+ can be started
  test('Routine picker displays >50 templates with keyset pagination and #51+ can be started', async ({ page }) => {
    await loginAsAthlete(page);
    await page.goto('/workout');
    await page.waitForURL('**/workout');

    // Open Routine Picker Modal
    const routineBtn = page.locator('[data-testid="routine-select-btn"]');
    await expect(routineBtn).toBeVisible({ timeout: 10000 });
    await routineBtn.click();

    const modal = page.locator('[data-testid="routine-picker-modal"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Keyset pagination: With 55 templates seeded, page 1 has 50 items.
    // The "Load more routines" button is unconditionally present.
    const loadMoreBtn = page.locator('[data-testid="load-more-routines-btn"]');
    await expect(loadMoreBtn).toBeVisible({ timeout: 10000 });
    await loadMoreBtn.click();

    // Verify template #55 is rendered and selectable
    const routine55 = page.locator('button:has-text("P4 Test Routine 55")').first();
    await expect(routine55).toBeVisible({ timeout: 10000 });

    // Click to start template #55
    await routine55.click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Verify active routine updated to P4 Test Routine 55
    await expect(routineBtn).toContainText('P4 Test Routine 55');
  });

  // (b) Exercise picker search, custom creation, duplicate check, alias expansion, multi-add, focus
  test('Exercise picker search, custom creation, multi-select, and duplicate prevention', async ({ page }) => {
    await loginAsAthlete(page);
    await page.goto('/workout');
    await page.waitForURL('**/workout');

    // Switch to Free Workout to guarantee empty exercise card slate
    const routineBtn = page.locator('[data-testid="routine-select-btn"]');
    await routineBtn.click();
    const modal = page.locator('[data-testid="routine-picker-modal"]');
    await modal.locator('button:has-text("Free Workout")').click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Open exercise picker unconditionally
    const openPickerBtn = page.locator('[data-testid="empty-add-exercise-btn"], [data-testid="add-exercise-btn"]').first();
    await expect(openPickerBtn).toBeVisible({ timeout: 5000 });
    await openPickerBtn.click();

    const picker = page.locator('[data-testid="exercise-picker-sheet"]');
    await expect(picker).toBeVisible({ timeout: 10000 });

    const searchInput = page.locator('[data-testid="exercise-search-input"]');
    await expect(searchInput).toBeVisible();

    // 1. Create custom 'A P4 Zercher Hold <timestamp>' via picker Create row
    const customExName = `A P4 Zercher Hold ${Date.now()}`;
    await searchInput.fill(customExName);
    const createBtn = page.locator('[data-testid="create-exercise-btn"]');
    await expect(createBtn).toBeVisible({ timeout: 5000 });
    await expect(createBtn).toContainText(`Create “${customExName}”`);
    await createBtn.click();

    // Wait for creation to complete (search input is cleared and new row appears on page 1)
    await expect(searchInput).toHaveValue('', { timeout: 10000 });
    const zercherRow = page.locator(`[data-testid^="exercise-row-"]:has-text("${customExName}")`).first();
    await expect(zercherRow).toBeVisible({ timeout: 10000 });
    await expect(zercherRow).toHaveAttribute('aria-pressed', 'true');

    // 2. Duplicate prevention check: typing custom name again displays duplicate message
    await searchInput.fill(customExName);
    const duplicateMsg = page.locator('[data-testid="create-exercise-duplicate-msg"]');
    await expect(duplicateMsg).toBeVisible({ timeout: 5000 });
    await expect(duplicateMsg).toContainText('already exists');
    await expect(page.locator('[data-testid="create-exercise-btn"]')).toHaveCount(0);

    // 3. Prefix search: search 'zer' finds the newly created Zercher exercise
    await searchInput.fill('zer');
    await expect(zercherRow).toBeVisible({ timeout: 5000 });

    // 4. Alias search: seeded 'bp' expands to 'bench press' and matches 'Incline Bench Press'
    await searchInput.fill('bp');
    const benchRow = page.locator('[data-testid^="exercise-row-"]:has-text("Incline Bench Press")').first();
    await expect(benchRow).toBeVisible({ timeout: 5000 });

    // 5. Multi-select 2 exercises -> 'Add 2 Exercises' -> 2 new cards and document.activeElement inside the first new card
    // Deselect custom exercise to test toggle-off behavior unconditionally
    await searchInput.fill(customExName);
    await zercherRow.click();
    await expect(zercherRow).toHaveAttribute('aria-pressed', 'false');

    await searchInput.fill('Cable Lateral');
    const row1 = page.locator('[data-testid^="exercise-row-"]:has-text("Cable Lateral Raises")').first();
    await expect(row1).toBeVisible({ timeout: 5000 });
    await row1.click();
    await expect(row1).toHaveAttribute('aria-pressed', 'true');

    await searchInput.fill('Face Pulls');
    const row2 = page.locator('[data-testid^="exercise-row-"]:has-text("Face Pulls")').first();
    await expect(row2).toBeVisible({ timeout: 5000 });
    await row2.click();
    await expect(row2).toHaveAttribute('aria-pressed', 'true');

    const addConfirmBtn = page.locator('[data-testid="picker-confirm-add-btn"]');
    await expect(addConfirmBtn).toContainText('Add 2 Exercises');
    await addConfirmBtn.click();
    await expect(picker).not.toBeVisible({ timeout: 5000 });

    // Verify 2 new cards are rendered in workout
    const card1 = page.locator('[data-card-for-exercise="Cable Lateral Raises"]');
    const card2 = page.locator('[data-card-for-exercise="Face Pulls"]');
    await expect(card1).toBeVisible({ timeout: 5000 });
    await expect(card2).toBeVisible({ timeout: 5000 });

    // Verify focus moved into the first new exercise card
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.querySelector('[data-card-for-exercise="Cable Lateral Raises"]');
        return Boolean(el && document.activeElement && el.contains(document.activeElement));
      });
    }, { message: 'Focus should move inside the first new exercise card', timeout: 5000 }).toBe(true);
  });
});
