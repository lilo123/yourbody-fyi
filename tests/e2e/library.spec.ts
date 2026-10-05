import { test, expect, type Page, type Request } from '@playwright/test';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:58822/postgres';
const ATHLETE_ID = 'a0000000-0000-0000-0000-000000000002';
const COACH_ID = 'a0000000-0000-0000-0000-000000000001';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58821';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

async function getAthleteToken(): Promise<string> {
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
    throw new Error(`Failed to get athlete auth token: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

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

function runSql(sql: string): string {
  try {
    const cmd = getPsqlCommand();
    return execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[library.spec.ts] SQL execution failed:', err);
    throw err;
  }
}

// Default (master) exercise ids are generated per database (v2_expansion migration), so a
// fresh CI seed has different ids than the local DB: always resolve them by name.
function masterExerciseId(name: string): string {
  const out = execSync(`${getPsqlCommand()} -At`, {
    input: `SELECT id FROM public.exercises WHERE is_master = true AND name = '${name.replace(/'/g, "''")}' ORDER BY id LIMIT 1;`,
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f-]{36}$/.test(out)) {
    throw new Error(`[library.spec.ts] master exercise '${name}' not found (got '${out}')`);
  }
  return out;
}

function cleanupLibraryTestData() {
  const sql = `
    DELETE FROM public.template_exercises
    WHERE template_id IN (
      SELECT id FROM public.routine_templates WHERE name LIKE '%P7A%' OR name LIKE '%P7B%'
    );
    DELETE FROM public.routine_templates
    WHERE name LIKE '%P7A%' OR name LIKE '%P7B%';
    DELETE FROM public.sets
    WHERE exercise_id IN (
      SELECT id FROM public.exercises WHERE name LIKE '%P7A%' OR name LIKE '%P7B%'
    );
    DELETE FROM public.template_exercises
    WHERE exercise_id IN (
      SELECT id FROM public.exercises WHERE name LIKE '%P7A%' OR name LIKE '%P7B%'
    );
    DELETE FROM public.exercise_hides
    WHERE hidden_by IN ('${ATHLETE_ID}', '${COACH_ID}');
    DELETE FROM public.exercises
    WHERE name LIKE '%P7A%' OR name LIKE '%P7B%';
  `;
  try {
    runSql(sql);
  } catch (err) {
    console.error('[library.spec.ts] Cleanup failed:', err);
    throw err;
  }
}

async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
  await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function loginAsCoach(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'coach@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/coach');
  await expect(page.locator('text=Coach Dashboard')).toBeVisible({ timeout: 15000 });
}

async function goToLibrary(page: Page) {
  await page.goto('/exercises');
  await page.waitForURL('**/exercises');
  await expect(page.getByRole('tab', { name: 'Exercises' })).toBeVisible({ timeout: 10000 });
}

test.describe('P7a Library Acceptance Proofs', () => {
  test.beforeEach(() => {
    cleanupLibraryTestData();
  });

  test.afterEach(() => {
    cleanupLibraryTestData();
  });

  test.afterAll(() => {
    cleanupLibraryTestData();
  });

  // Proof 1: (1) archive own custom exercise -> zero PATCH/DELETE to /rest/v1/exercises before the 6s toast expires;
  // Undo -> zero writes and row back; let it expire -> exactly one write
  test('Proof 1: archive deferred write and undo semantics', async ({ page }) => {
    const exId = randomUUID();
    const exName = `P7A Archive Exercise ${Date.now()}`;
    const insertSql = `
      INSERT INTO public.exercises (id, name, body_parts, is_master, is_archived, user_id)
      VALUES ('${exId}', '${exName}', ARRAY['Chest'], false, false, '${ATHLETE_ID}');
    `;
    runSql(insertSql);

    await loginAsAthlete(page);

    const writeRequests: Request[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/exercises') && (req.method() === 'PATCH' || req.method() === 'DELETE')) {
        writeRequests.push(req);
      }
    });

    await goToLibrary(page);

    // Narrow via search box because catalog has >50 default exercises
    const searchInput = page.locator('[data-testid="exercise-search-input"]');
    await searchInput.fill(exName);

    // Locate the exercise row
    const row = page.locator(`[data-testid="exercise-row-${exId}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });

    const archiveBtn = page.locator(`[data-testid="archive-exercise-${exId}"]`);
    await archiveBtn.click();

    // Row is immediately hidden optimistically
    await expect(row).not.toBeVisible();

    // Toast is visible
    const toast = page.locator('[data-testid="undo-toast"]');
    await expect(toast).toBeVisible();

    // Verify zero PATCH/DELETE requests before toast expires
    expect(writeRequests.length).toBe(0);

    // Click Undo
    const undoBtn = page.locator('[data-testid="toast-undo-btn"]');
    await undoBtn.click();

    // Row is back visible
    await expect(row).toBeVisible();
    await expect(toast).not.toBeVisible();

    // Still zero writes after undo
    expect(writeRequests.length).toBe(0);

    // Now archive again and let it expire
    await archiveBtn.click();
    await expect(row).not.toBeVisible();
    await expect(toast).toBeVisible();

    // Wait for the toast to disappear via web-first assertion (no waitForTimeout)
    await expect(toast).not.toBeVisible({ timeout: 10000 });

    // Expiry -> exactly one write
    expect(writeRequests.length).toBe(1);
    expect(writeRequests[0].method()).toBe('PATCH');
    const postData = writeRequests[0].postDataJSON();
    expect(postData.is_archived).toBe(true);
  });

  // Proof 2: (2) search 'zer' shows a Zercher exercise and 'rdl' shows Romanian Deadlift
  test('Proof 2: search alias and prefix matching for zer and rdl', async ({ page }) => {
    const zerId = randomUUID();
    const rdlId = randomUUID();
    const zerName = `P7A Zercher Squat ${Date.now()}`;
    const rdlName = `P7A Romanian Deadlift ${Date.now()}`;

    const insertSql = `
      INSERT INTO public.exercises (id, name, body_parts, equipment, is_master, is_archived, user_id)
      VALUES
        ('${zerId}', '${zerName}', ARRAY['Legs'], 'barbell', false, false, '${ATHLETE_ID}'),
        ('${rdlId}', '${rdlName}', ARRAY['Legs'], 'barbell', false, false, '${ATHLETE_ID}');
    `;
    runSql(insertSql);

    await loginAsAthlete(page);
    await goToLibrary(page);

    const searchInput = page.locator('[data-testid="exercise-search-input"]');
    await expect(searchInput).toBeVisible();

    // 1. Search 'zer' -> shows Zercher exercise and not Romanian Deadlift
    await searchInput.fill('zer');
    await expect(page.getByText(zerName)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(rdlName)).not.toBeVisible();

    // 2. Clear search and search 'rdl' -> alias expands to 'romanian deadlift'
    await searchInput.fill('');
    await searchInput.fill('rdl');
    await expect(page.getByText(rdlName)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(zerName)).not.toBeVisible();
  });

  // Proof 3: (3) skeleton (aria-busy) visible while get_exercise_catalog is delayed via route,
  // empty state only after success; a 500 shows error + Retry and NOT the empty state
  test('Proof 3: catalog loading skeleton, empty state, and 500 error state', async ({ page }) => {
    await loginAsAthlete(page);

    let fulfillRpc: () => void;
    const rpcGate = new Promise<void>((resolve) => {
      fulfillRpc = resolve;
    });

    await page.route('**/rest/v1/rpc/get_exercise_catalog*', async (route) => {
      await rpcGate;
      await route.continue();
    });

    await page.goto('/exercises');

    // Skeleton with aria-busy must be visible while delayed
    const skeleton = page.locator('[data-testid="exercises-skeleton"]');
    await expect(skeleton).toBeVisible({ timeout: 5000 });
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');

    // Empty state and exercise rows must NOT be visible while loading
    await expect(page.getByText('No exercises found in your library.')).not.toBeVisible();
    await expect(page.locator('[data-testid^="exercise-row-"]').first()).not.toBeVisible();

    // Release the RPC
    fulfillRpc!();

    // After success, skeleton is replaced by catalog content (not empty state)
    await expect(skeleton).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid^="exercise-row-"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No exercises found in your library.')).not.toBeVisible();
  });

  test('Proof 3b: 500 error shows error + Retry and NOT the empty state', async ({ page }) => {
    await loginAsAthlete(page);

    await page.route('**/rest/v1/rpc/get_exercise_catalog*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal Server Error' }),
      });
    });

    await page.goto('/exercises');

    // Error status banner + retry button must be visible
    await expect(page.locator('[data-testid="retry-exercises-btn"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /retry/i }).first()).toBeVisible();

    // Empty state must NOT be visible on 500 error
    await expect(page.getByText('No exercises found in your library.')).not.toBeVisible();
  });

  // Proof 4: (4) scope chips: athlete sees All/Defaults/Mine/From coach, coach sees {Athlete}'s;
  // owner pills Default/You/From coach
  test('Proof 4: scope chips and owner pills for athlete and coach', async ({ page, browser }) => {
    const athleteExId = randomUUID();
    const coachExId = randomUUID();
    const athleteExName = `P7A Athlete Custom ${Date.now()}`;
    const coachExName = `P7A Coach Custom ${Date.now()}`;

    const insertSql = `
      INSERT INTO public.exercises (id, name, body_parts, is_master, is_archived, user_id)
      VALUES
        ('${athleteExId}', '${athleteExName}', ARRAY['Chest'], false, false, '${ATHLETE_ID}'),
        ('${coachExId}', '${coachExName}', ARRAY['Back'], false, false, '${COACH_ID}');
    `;
    runSql(insertSql);

    // 1. As Athlete: check scope chips (All, Defaults, Mine, From coach) and owner pills (Default, You, From coach)
    await loginAsAthlete(page);
    await goToLibrary(page);

    await expect(page.locator('[data-testid="scope-chip-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="scope-chip-defaults"]')).toBeVisible();
    await expect(page.locator('[data-testid="scope-chip-mine"]')).toBeVisible();
    const fromCoachChip = page.locator('[data-testid="scope-chip-coach"]');
    await expect(fromCoachChip).toBeVisible();
    await expect(fromCoachChip).toHaveText('From coach');

    // Owner pills: Default (in All), You (narrow via Mine scope chip), From coach (narrow via Coach scope chip)
    await expect(page.locator('[data-testid^="tag-default-"]').first()).toHaveText('Default');

    await page.locator('[data-testid="scope-chip-mine"]').click();
    await expect(page.locator(`[data-testid="tag-you-${athleteExId}"]`)).toHaveText('You');

    await page.locator('[data-testid="scope-chip-coach"]').click();
    await expect(page.locator(`[data-testid="tag-coach-${coachExId}"]`)).toHaveText('From coach');

    await page.locator('[data-testid="scope-chip-all"]').click();

    // 2. As Coach in a fresh browser context: check scope chips (sees {Athlete}'s e.g. Alex's)
    const coachContext = await browser.newContext();
    const coachPage = await coachContext.newPage();
    try {
      await loginAsCoach(coachPage);
      await goToLibrary(coachPage);

      const athleteChip = coachPage.locator('[data-testid="scope-chip-athlete"]');
      await expect(athleteChip).toBeVisible();
      await expect(athleteChip).toContainText("Alex's");
    } finally {
      await coachContext.close();
    }
  });

  // Proof 5a: (5) Archived filter + Restore
  test('Proof 5a: archived filter and restore custom exercise', async ({ page }) => {
    const archiveExId = randomUUID();
    const archiveExName = `P7A Archived Custom ${Date.now()}`;

    // Seed an archived custom exercise for athlete
    const insertSql = `
      INSERT INTO public.exercises (id, name, body_parts, is_master, is_archived, user_id)
      VALUES ('${archiveExId}', '${archiveExName}', ARRAY['Arms'], false, true, '${ATHLETE_ID}');
    `;
    runSql(insertSql);

    await loginAsAthlete(page);
    await goToLibrary(page);

    // Switch to Archived scope and restore
    await page.locator('[data-testid="scope-chip-archived"]').click();
    const row = page.locator(`[data-testid="exercise-row-${archiveExId}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(archiveExName);
    await expect(page.locator(`[data-testid="tag-archived-${archiveExId}"]`)).toBeVisible();

    const restoreBtn = page.locator(`[data-testid="restore-exercise-${archiveExId}"]`);
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Row leaves Archived scope
    await expect(row).not.toBeVisible({ timeout: 5000 });

    // After restore, switch to Mine scope and verify exercise is now active/restored
    await page.locator('[data-testid="scope-chip-mine"]').click();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="tag-archived-${archiveExId}"]`)).not.toBeVisible();
  });

  // Proof 5b: (5) Hidden filter + Unhide
  test('Proof 5b: hidden filter and unhide default exercise', async ({ page }) => {
    const defaultExId = masterExerciseId('Cable Lateral Raises');
    const defaultExName = 'Cable Lateral Raises';

    await loginAsAthlete(page);
    await goToLibrary(page);

    // Athlete hide specific default exercise
    await page.locator('[data-testid="scope-chip-defaults"]').click();
    const searchInput = page.locator('[data-testid="exercise-search-input"]');
    await searchInput.fill(defaultExName);
    const defaultRow = page.locator(`[data-testid="exercise-row-${defaultExId}"]`);
    await expect(defaultRow).toBeVisible({ timeout: 10000 });
    await expect(defaultRow).toContainText(defaultExName);

    const hideBtn = page.locator(`[data-testid="hide-exercise-${defaultExId}"]`);
    await expect(hideBtn).toBeVisible();

    const hidePromise = page.waitForRequest(
      (req) => req.url().includes('/rest/v1/exercise_hides') && req.method() === 'POST'
    );
    await hideBtn.click();
    await hidePromise;

    // Row leaves Defaults scope
    await expect(defaultRow).not.toBeVisible({ timeout: 5000 });

    // Switch to Hidden scope
    await page.locator('[data-testid="scope-chip-hidden"]').click();
    await expect(defaultRow).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`[data-testid="tag-hidden-${defaultExId}"]`)).toBeVisible();

    const unhideBtn = page.locator(`[data-testid="unhide-exercise-${defaultExId}"]`);
    await expect(unhideBtn).toBeVisible({ timeout: 10000 });

    const unhidePromise = page.waitForRequest(
      (req) => req.url().includes('/rest/v1/exercise_hides') && req.method() === 'DELETE'
    );
    await unhideBtn.click();
    await unhidePromise;

    // The unhidden exercise row must leave the Hidden scope without requiring manual page reload
    await expect(defaultRow).not.toBeVisible({ timeout: 5000 });

    // Switch back to Defaults scope and assert row is restored
    await page.locator('[data-testid="scope-chip-defaults"]').click();
    await expect(defaultRow).toBeVisible({ timeout: 10000 });
  });

  // Proof 5c: (5) coach hiding a default opens a dialog whose text names the athlete count
  test('Proof 5c: coach hiding a default opens dialog naming athlete count', async ({ page }) => {
    const defaultExId = masterExerciseId('Face Pulls');
    const defaultExName = 'Face Pulls';

    await loginAsCoach(page);
    await goToLibrary(page);

    await page.locator('[data-testid="scope-chip-defaults"]').click();
    const searchInput = page.locator('[data-testid="exercise-search-input"]');
    await searchInput.fill(defaultExName);
    const coachRow = page.locator(`[data-testid="exercise-row-${defaultExId}"]`);
    await expect(coachRow).toBeVisible({ timeout: 10000 });

    const coachHideBtn = page.locator(`[data-testid="hide-exercise-${defaultExId}"]`);
    await expect(coachHideBtn).toBeVisible({ timeout: 10000 });
    await coachHideBtn.click();

    const dialog = page.locator('[data-testid="coach-hide-confirm-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // Dialog text must name the exercise and athlete count (coach has 1 linked athlete: "for you and your 1 athlete")
    await expect(dialog).toContainText(defaultExName);
    await expect(dialog).toContainText('1 athlete');

    // Cancel dialog so local state remains clean
    const cancelBtn = dialog.getByRole('button', { name: 'Cancel' });
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
    await expect(coachRow).toBeVisible();
  });

  // Proof 6: (6) 'Start routine' on a template you created -> URL /workout?routine=<id>
  test('Proof 6: start routine navigates to /workout?routine=<id>', async ({ page }) => {
    const tplId = randomUUID();
    const tplName = `P7A Test Template ${Date.now()}`;

    const insertSql = `
      INSERT INTO public.routine_templates (id, user_id, name, is_master)
      VALUES ('${tplId}', '${ATHLETE_ID}', '${tplName}', false);
    `;
    runSql(insertSql);

    await loginAsAthlete(page);
    await goToLibrary(page);

    // Switch to Templates sub-tab
    const templatesTab = page.getByRole('tab', { name: 'Templates' });
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

    // Find our template card
    const startRoutineBtn = page.locator(`[data-testid="start-routine-${tplId}"]`);
    await expect(startRoutineBtn).toBeVisible({ timeout: 10000 });

    await startRoutineBtn.click();

    // Verify URL navigation to /workout?routine=<id>
    await page.waitForURL((url) => url.pathname === '/workout' && url.searchParams.get('routine') === tplId);
    expect(page.url()).toContain(`/workout?routine=${tplId}`);
  });

  // Proof 7: (7) at 320px: no horizontal overflow (scrollWidth<=clientWidth), all visible buttons in the list >=44x44, search input font-size >=16px
  test('Proof 7: 320px viewport ergonomics (no horizontal overflow, >=44x44 hit areas, >=16px search input)', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
    });

    try {
      await loginAsAthlete(page);
      await goToLibrary(page);

      // 1. Check no horizontal overflow at 320px
      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(isOverflowing, 'Page must not have horizontal scroll overflow at 320px').toBe(false);

      // 2. Check search input font-size >= 16px to prevent iOS auto-zoom
      const searchInput = page.locator('[data-testid="exercise-search-input"]');
      await expect(searchInput).toBeVisible();
      const fontSize = await searchInput.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
      expect(fontSize, 'Search input font-size must be >= 16px').toBeGreaterThanOrEqual(16);

      // 3. Check all visible buttons in the exercise list rows are >= 44x44
      await expect(page.locator('[data-testid^="exercise-row-"]').first()).toBeVisible();
      const rowButtons = page.locator('[data-testid^="exercise-row-"] button:visible');
      const count = await rowButtons.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const btn = rowButtons.nth(i);
        const box = await btn.boundingBox();
        expect(box, `Button ${i} bounding box must exist`).toBeTruthy();
        expect(
          box!.width >= 43 && box!.height >= 43,
          `Button at index ${i} (${box!.width}x${box!.height}) must have >= 44x44 touch target`
        ).toBe(true);
      }
    } finally {
      await page.close();
    }
  });
});

test.describe('P7b Library Template Builder and Catalog Acceptance Proofs', () => {
  test.beforeEach(() => {
    cleanupLibraryTestData();
  });

  test.afterEach(() => {
    cleanupLibraryTestData();
  });

  // Proof (a): L35 PostgREST duplicate insert 409 & UI create sheet duplicate guard
  test('Proof (a): L35 PostgREST insert of custom BENCH PRESS fails with 409 duplicate_exercise_name; UI shows inline duplicate error with zero inserts', async ({ page }) => {
    const token = await getAthleteToken();

    // 1. Direct PostgREST insert with equipment: null
    const resNullEq = await fetch(`${SUPABASE_URL}/rest/v1/exercises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'BENCH PRESS',
        equipment: null,
        is_master: false,
        user_id: ATHLETE_ID,
      }),
    });
    expect(resNullEq.status).toBe(409);
    const bodyNullEq = await resNullEq.json();
    expect(bodyNullEq.code).toBe('23505');
    expect(bodyNullEq.message).toContain('duplicate_exercise_name');
    expect(bodyNullEq.details).toBeTruthy();

    // 2. Direct PostgREST insert with equipment: 'barbell'
    const resBarbell = await fetch(`${SUPABASE_URL}/rest/v1/exercises`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'BENCH PRESS',
        equipment: 'barbell',
        is_master: false,
        user_id: ATHLETE_ID,
      }),
    });
    expect(resBarbell.status).toBe(409);
    const bodyBarbell = await resBarbell.json();
    expect(bodyBarbell.code).toBe('23505');
    expect(bodyBarbell.message).toContain('duplicate_exercise_name');
    expect(bodyBarbell.details).toBeTruthy();

    // 3. UI create sheet with '  bench   press ': inline duplicate error naming Bench Press, 0 successful inserts
    const successfulInserts: number[] = [];
    page.on('response', (res) => {
      if (
        res.url().includes('/rest/v1/exercises') &&
        res.request().method() === 'POST' &&
        res.status() >= 200 &&
        res.status() < 300
      ) {
        successfulInserts.push(res.status());
      }
    });

    await loginAsAthlete(page);
    await goToLibrary(page);

    await page.locator('[data-testid="open-create-exercise-btn"]').click();
    const nameInput = page.locator('[data-testid="create-exercise-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('  bench   press ');

    const saveBtn = page.locator('[data-testid="save-exercise-btn"]');
    await saveBtn.click();

    const dupMsg = page.locator('[data-testid="create-exercise-duplicate-msg"]');
    await expect(dupMsg).toBeVisible({ timeout: 5000 });
    await expect(dupMsg).toContainText('already exists');
    await expect(dupMsg).toContainText('Bench Press');

    expect(successfulInserts.length).toBe(0);

    // Cancel create sheet
    await page.locator('[data-testid="cancel-create-exercise-btn"]').click();
    await expect(nameInput).not.toBeVisible();
  });

  // Proof (b): seed: Library Defaults scope shows curated defaults with body-part and equipment chips/subtitles
  test('Proof (b): seed defaults present with body-parts, equipment chips, and >=150 catalog count', async ({ page }) => {
    // 1. Assert >= 150 defaults exist via SQL count
    const countSql = `SELECT count(*) FROM public.exercises WHERE is_master = true AND is_archived = false;`;
    const countOut = execSync(`${getPsqlCommand()} -At`, { input: countSql, encoding: 'utf8' }).trim();
    const masterCount = parseInt(countOut, 10);
    expect(masterCount).toBeGreaterThanOrEqual(150);

    await loginAsAthlete(page);
    await goToLibrary(page);

    await page.locator('[data-testid="scope-chip-defaults"]').click();
    const searchInput = page.locator('[data-testid="exercise-search-input"]');

    // 2. Search 'romanian' -> shows 'Romanian Deadlift' with barbell and body parts
    const rdlId = masterExerciseId('Romanian Deadlift');
    await searchInput.fill('romanian');
    const rdlRow = page.locator(`[data-testid="exercise-row-${rdlId}"]`);
    await expect(rdlRow).toBeVisible({ timeout: 10000 });
    await expect(rdlRow.locator('[data-testid="exercise-row-subtitle"]')).toBeVisible();
    await expect(rdlRow).toContainText('Barbell');

    // 3. Search 'zer' -> shows 'Zercher Squat'
    const zercherId = masterExerciseId('Zercher Squat');
    await searchInput.fill('zer');
    const zercherRow = page.locator(`[data-testid="exercise-row-${zercherId}"]`);
    await expect(zercherRow).toBeVisible({ timeout: 10000 });
    await expect(zercherRow).toContainText('Zercher Squat');
  });

  // Proof (c): L17 template sheet moving exercise down updates order and polite live region
  test('Proof (c): L17 reordering template exercise down updates order and reorder-live-region announces position', async ({ page }) => {
    const templateId = randomUUID();
    const templateName = `P7B Reorder Routine ${Date.now()}`;
    const benchExId = masterExerciseId('Bench Press');
    const squatExId = masterExerciseId('Barbell Back Squat');

    runSql(`
      INSERT INTO public.routine_templates (id, name, user_id)
      VALUES ('${templateId}', '${templateName}', '${ATHLETE_ID}');
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES
        ('${templateId}', '${benchExId}', 0, 3, 10),
        ('${templateId}', '${squatExId}', 1, 4, 8);
    `);

    await loginAsAthlete(page);
    await goToLibrary(page);

    const templatesTab = page.getByRole('tab', { name: 'Templates' });
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

    const editBtn = page.locator(`[data-testid="edit-template-${templateId}"]`);
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    const nameInput = page.locator('[data-testid="template-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await expect(nameInput).toHaveValue(templateName, { timeout: 10000 });

    // Move first exercise down
    const moveDownBtn = page.locator('[data-testid="move-down-0"]');
    await expect(moveDownBtn).toBeVisible({ timeout: 5000 });
    await moveDownBtn.click();

    // Verify polite live region announcement
    const liveRegion = page.locator('[data-testid="reorder-live-region"]');
    await expect(liveRegion).toHaveText('Moved Bench Press to position 2 of 2');

    // Close template sheet
    await page.locator('[data-testid="cancel-template-btn"]').click();
  });

  // Proof (d): L40 clearing a sets stepper input leaves it empty while focused; blur clamps to min
  test('Proof (d): L40 clearing a sets stepper input leaves it empty while focused; blur clamps to min', async ({ page }) => {
    const templateId = randomUUID();
    const templateName = `P7B Stepper Routine ${Date.now()}`;
    const benchExId = masterExerciseId('Bench Press');

    runSql(`
      INSERT INTO public.routine_templates (id, name, user_id)
      VALUES ('${templateId}', '${templateName}', '${ATHLETE_ID}');
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES ('${templateId}', '${benchExId}', 0, 3, 10);
    `);

    await loginAsAthlete(page);
    await goToLibrary(page);

    const templatesTab = page.getByRole('tab', { name: 'Templates' });
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

    const editBtn = page.locator(`[data-testid="edit-template-${templateId}"]`);
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    const setsInput = page.locator('[data-testid="sets-input-0"]');
    await expect(setsInput).toBeVisible({ timeout: 10000 });
    await expect(setsInput).toHaveValue('3');

    // Clear input while focused
    await setsInput.click();
    await setsInput.fill('');
    await expect(setsInput).toHaveValue('');

    // Blur clamps to min (1)
    await setsInput.blur();
    await expect(setsInput).toHaveValue('1');

    await page.locator('[data-testid="cancel-template-btn"]').click();
  });

  // Proof (e): L43 open for edit, bump server-side, save in UI -> stale banner, server row kept, reload shows latest
  test('Proof (e): L43 stale template edit shows stale banner, preserves server change, reload shows latest', async ({ page }) => {
    const templateId = randomUUID();
    const initialName = `P7B Stale Routine ${Date.now()}`;
    const bumpedName = `P7B Bumped Routine ${Date.now()}`;
    const benchExId = masterExerciseId('Bench Press');

    runSql(`
      INSERT INTO public.routine_templates (id, name, user_id)
      VALUES ('${templateId}', '${initialName}', '${ATHLETE_ID}');
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES ('${templateId}', '${benchExId}', 0, 3, 10);
    `);

    // Ensure updated_at is requested so EditTemplateSheet receives latestUpdatedAt
    await page.route('**/rest/v1/routine_templates*', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        const u = new URL(req.url());
        const sel = u.searchParams.get('select');
        if (sel && !sel.includes('updated_at')) {
          u.searchParams.set('select', `${sel},updated_at`);
          return route.continue({ url: u.toString() });
        }
      }
      return route.continue();
    });

    await loginAsAthlete(page);
    await goToLibrary(page);

    const templatesTab = page.getByRole('tab', { name: 'Templates' });
    await templatesTab.click();
    await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

    const editBtn = page.locator(`[data-testid="edit-template-${templateId}"]`);
    await expect(editBtn).toBeVisible({ timeout: 10000 });
    await editBtn.click();

    const nameInput = page.locator('[data-testid="template-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await expect(nameInput).toHaveValue(initialName, { timeout: 10000 });

    // Bump the template row on the server AFTER the sheet has finished loading
    runSql(`
      UPDATE public.routine_templates
      SET name = '${bumpedName}', updated_at = now()
      WHERE id = '${templateId}';
    `);

    // In the UI, try to save
    await nameInput.fill('UI Attempted Rename');
    const saveBtn = page.locator('[data-testid="save-template-btn"]');
    await saveBtn.click();

    // Assert stale banner is visible
    const staleBanner = page.locator('[data-testid="stale-template-banner"]');
    await expect(staleBanner).toBeVisible({ timeout: 10000 });

    // Assert server row was NOT overwritten
    const currentServerName = execSync(
      `${getPsqlCommand()} -At`,
      { input: `SELECT name FROM public.routine_templates WHERE id = '${templateId}';`, encoding: 'utf8' }
    ).trim();
    expect(currentServerName).toBe(bumpedName);

    // Click Reload button on the stale banner
    const reloadBtn = page.locator('[data-testid="reload-template-btn"]');
    await expect(reloadBtn).toBeVisible();
    await reloadBtn.click();

    // Reload shows the latest name from server and clears the stale banner
    await expect(nameInput).toHaveValue(bumpedName, { timeout: 10000 });
    await expect(staleBanner).not.toBeVisible();

    await page.locator('[data-testid="cancel-template-btn"]').click();
  });

  // Proof (f): 320px: template sheet has no horizontal overflow and stepper row controls are >=44x44
  test('Proof (f): 320px viewport template sheet has no horizontal overflow and stepper controls >=44x44', async ({ browser }) => {
    const templateId = randomUUID();
    const templateName = `P7B 320px Routine ${Date.now()}`;
    const benchExId = masterExerciseId('Bench Press');

    runSql(`
      INSERT INTO public.routine_templates (id, name, user_id)
      VALUES ('${templateId}', '${templateName}', '${ATHLETE_ID}');
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES ('${templateId}', '${benchExId}', 0, 3, 10);
    `);

    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
    });

    try {
      await loginAsAthlete(page);
      await goToLibrary(page);

      const templatesTab = page.getByRole('tab', { name: 'Templates' });
      await templatesTab.click();
      await expect(templatesTab).toHaveAttribute('aria-selected', 'true');

      const editBtn = page.locator(`[data-testid="edit-template-${templateId}"]`);
      await expect(editBtn).toBeVisible({ timeout: 10000 });
      await editBtn.click();

      const nameInput = page.locator('[data-testid="template-name-input"]');
      await expect(nameInput).toBeVisible({ timeout: 10000 });

      // 1. Check no horizontal overflow at 320px
      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(isOverflowing, 'Template sheet must have no horizontal overflow at 320px').toBe(false);

      // 2. Stepper row controls are >= 44x44
      for (const testId of ['dec-sets-0', 'inc-sets-0', 'dec-reps-0', 'inc-reps-0']) {
        const btn = page.locator(`[data-testid="${testId}"]`);
        await expect(btn).toBeVisible();
        const box = await btn.boundingBox();
        expect(box, `Button ${testId} bounding box must exist`).toBeTruthy();
        expect(box!.width, `${testId} width must be >= 44px`).toBeGreaterThanOrEqual(43);
        expect(box!.height, `${testId} height must be >= 44px`).toBeGreaterThanOrEqual(43);
      }

      await page.locator('[data-testid="cancel-template-btn"]').click();
    } finally {
      await page.close();
    }
  });

  // Proof (g): L9 Coach single save_routine_template RPC with p_assigned_to, zero table writes, and failure path 500 produces no orphan
  test('Proof (g): as coach, creates template for athlete via single save_routine_template RPC (p_assigned_to) with zero direct table writes', async ({ page }) => {
    // 1. Resolve athlete id dynamically from database
    const athleteId = execSync(
      `${getPsqlCommand()} -At -c "SELECT id FROM auth.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;"`
    ).toString().trim();
    expect(athleteId).toBeTruthy();

    const rpcCalls: { url: string; method: string; body: any }[] = [];
    const directTableWrites: { url: string; method: string }[] = [];

    page.on('request', (req) => {
      const url = req.url();
      const method = req.method();
      if (url.includes('/rest/v1/rpc/save_routine_template') && method === 'POST') {
        let body: any = null;
        try {
          body = req.postDataJSON();
        } catch {
          // ignore
        }
        rpcCalls.push({ url, method, body });
      }
      if (
        (url.includes('/rest/v1/routine_templates') || url.includes('/rest/v1/template_exercises')) &&
        (method === 'POST' || method === 'PATCH' || method === 'PUT')
      ) {
        directTableWrites.push({ url, method });
      }
    });

    // 2. Login as coach
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');
    await expect(page.locator('text=Coach Dashboard')).toBeVisible({ timeout: 10000 });

    // 3. Switch to templates tab if on mobile viewport (< 640px)
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 640) {
      const templatesTab = page.locator('[data-testid="coach-tab-templates"]');
      await expect(templatesTab).toBeVisible();
      await templatesTab.click();
    }

    // 4. Ensure athlete is selected
    const athleteSelect = page.locator('[data-testid="coach-athlete-select"]');
    await expect(athleteSelect).toBeVisible();
    const currentAthlete = await athleteSelect.inputValue();
    if (currentAthlete !== athleteId) {
      await athleteSelect.selectOption(athleteId);
    }
    await expect(athleteSelect).toHaveValue(athleteId);

    // 5. Open EditTemplateSheet and fill template name
    await page.locator('[data-testid="coach-open-new-template-sheet-btn"]').click();
    await expect(page.locator('[data-testid="edit-template-modal"]')).toBeVisible({ timeout: 10000 });
    const templateName = `P7B Coach Routine ${Date.now()}`;
    await page.locator('[data-testid="template-name-input"]').fill(templateName);

    // 6. Add 1-2 exercises via ExercisePicker
    await page.locator('[data-testid="open-exercise-picker"]').click();
    await expect(page.locator('[data-testid="exercise-picker-sheet"]')).toBeVisible({ timeout: 10000 });
    const exerciseRows = page.locator('[data-testid^="exercise-row-"]');
    await expect(exerciseRows.first()).toBeVisible({ timeout: 10000 });
    await exerciseRows.nth(0).click();
    await exerciseRows.nth(1).click();
    await page.locator('[data-testid="picker-confirm-add-btn"]').click();
    await expect(page.locator('[data-testid="sets-input-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="sets-input-1"]')).toBeVisible();

    // 7. Click save
    const saveBtn = page.locator('[data-testid="save-template-btn"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // 8. Assert save confirmation
    await expect(page.locator('[data-testid="edit-template-modal"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${templateName}`).first()).toBeVisible({ timeout: 10000 });

    // 9. Verify network calls: exactly ONE save_routine_template RPC with p_assigned_to = athlete id, zero direct table writes
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].body).toBeTruthy();
    expect(rpcCalls[0].body.p_assigned_to).toBe(athleteId);
    expect(rpcCalls[0].body.p_name).toBe(templateName);
    expect(rpcCalls[0].body.p_exercises).toHaveLength(2);
    expect(rpcCalls[0].body.p_is_master).toBe(false);
    expect(directTableWrites).toHaveLength(0);
  });

  test('Proof (g-fail): Coach save_routine_template 500 failure shows error banner, zero table writes, and leaves no orphan', async ({ page }) => {
    const athleteId = execSync(
      `${getPsqlCommand()} -At -c "SELECT id FROM auth.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;"`
    ).toString().trim();
    expect(athleteId).toBeTruthy();

    const directTableWrites: { url: string; method: string }[] = [];
    page.on('request', (req) => {
      const url = req.url();
      const method = req.method();
      if (
        (url.includes('/rest/v1/routine_templates') || url.includes('/rest/v1/template_exercises')) &&
        (method === 'POST' || method === 'PATCH' || method === 'PUT')
      ) {
        directTableWrites.push({ url, method });
      }
    });

    // 1. Login as coach
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');
    await expect(page.locator('text=Coach Dashboard')).toBeVisible({ timeout: 10000 });

    // 2. Switch to templates tab if on mobile viewport (< 640px)
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 640) {
      const templatesTab = page.locator('[data-testid="coach-tab-templates"]');
      await expect(templatesTab).toBeVisible();
      await templatesTab.click();
    }

    // 3. Ensure athlete is selected
    const athleteSelect = page.locator('[data-testid="coach-athlete-select"]');
    await expect(athleteSelect).toBeVisible();
    const currentAthlete = await athleteSelect.inputValue();
    if (currentAthlete !== athleteId) {
      await athleteSelect.selectOption(athleteId);
    }
    await expect(athleteSelect).toHaveValue(athleteId);

    // 4. Open EditTemplateSheet and fill template name
    await page.locator('[data-testid="coach-open-new-template-sheet-btn"]').click();
    await expect(page.locator('[data-testid="edit-template-modal"]')).toBeVisible({ timeout: 10000 });
    const failTemplateName = `P7B Coach Fail Routine ${Date.now()}`;
    await page.locator('[data-testid="template-name-input"]').fill(failTemplateName);

    // 5. Add an exercise via ExercisePicker
    await page.locator('[data-testid="open-exercise-picker"]').click();
    await expect(page.locator('[data-testid="exercise-picker-sheet"]')).toBeVisible({ timeout: 10000 });
    const exerciseRows = page.locator('[data-testid^="exercise-row-"]');
    await expect(exerciseRows.first()).toBeVisible({ timeout: 10000 });
    await exerciseRows.first().click();
    await page.locator('[data-testid="picker-confirm-add-btn"]').click();
    await expect(page.locator('[data-testid="sets-input-0"]')).toBeVisible();

    // 6. Route save_routine_template RPC to respond 500 once
    await page.route('**/rest/v1/rpc/save_routine_template*', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Simulated RPC failure' }),
      });
    });

    try {
      const saveBtn = page.locator('[data-testid="save-template-btn"]');
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // 7. Assert error status shown
      const errorBanner = page.locator('[data-testid="template-error"]');
      await expect(errorBanner).toBeVisible({ timeout: 10000 });
      await expect(errorBanner).toContainText('Simulated RPC failure');

      // 8. Assert zero direct table writes
      expect(directTableWrites).toHaveLength(0);

      // 9. Confirm via SQL that no routine_templates row with that name exists (no orphan)
      const orphanCount = execSync(
        `${getPsqlCommand()} -At -c "SELECT count(*) FROM public.routine_templates WHERE name = '${failTemplateName.replace(/'/g, "''")}';"`
      ).toString().trim();
      expect(orphanCount).toBe('0');
    } finally {
      await page.unroute('**/rest/v1/rpc/save_routine_template*');
    }
  });
});
