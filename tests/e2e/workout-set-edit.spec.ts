import { execSync } from 'child_process';
import { test, expect } from '@playwright/test';

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
    console.error('[p3a-set-edit] Error cleaning up polluted workouts:', err);
    throw err;
  }
}


// Captured at base 62bd8a5; z-50 -> z-[65] in YB5-T (D-YB5-T1)
// Logs "Poached Chicken Slices" (+132 kcal) from favorites.
// Normalized: dynamic bottom style (style="bottom: \d+px;") normalized to [BOTTOM]
// to account for dynamic nav/viewport calculation across devices.
// Hotfix: toast background made opaque (bg-zinc-900/95 -> bg-zinc-900!) so list text no longer shows through.
const EXPECTED_62BD8A5_TOAST_OUTER_HTML =
  '<div data-testid="quick-log-toast" class="border-emerald-500/30 bg-emerald-500/10 text-emerald-300 fixed left-1/2 -translate-x-1/2 z-[65] max-w-sm w-[calc(100%-2rem)] bg-zinc-900! border border-emerald-500/40 backdrop-blur-xl shadow-2xl shadow-emerald-500/20 rounded-2xl py-2 px-3 flex items-center justify-between gap-3 text-white transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 select-none" style="bottom: [BOTTOM];"><div class="flex items-center gap-3 min-w-0 flex-1"><div class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check w-4 h-4 text-emerald-400" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path></svg></div><div class="min-w-0 flex-1"><div class="text-xs text-zinc-400 font-normal leading-none">Logged</div><div data-testid="toast-dish-text" title="Poached Chicken Slices · +132 kcal" class="text-sm font-semibold text-white truncate mt-1 leading-snug"><span>Poached Chicken Slices</span><span class="text-zinc-400 font-normal"> · </span><span>+132 kcal</span></div></div></div><button type="button" data-testid="toast-undo-btn" aria-label="Undo log Poached Chicken Slices" class="shrink-0 h-11 min-h-[44px] min-w-[48px] px-3.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 text-xs font-bold text-emerald-200 transition touch-manipulation cursor-pointer flex items-center justify-center"><span data-testid="undo-add-favorite-btn">Undo</span></button></div>';

function normalizeToast(html: string): string {
  return html.replace(/style="bottom:\s*\d+px;?"/g, 'style="bottom: [BOTTOM];"').trim();
}

test.describe('Set Edit and Delete Workflows (p3a-set-edit)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    cleanupPollutedWorkouts();
  });

  test.afterEach(async () => {
    cleanupPollutedWorkouts();
  });

  test.afterAll(async () => {
    cleanupPollutedWorkouts();
  });

  test('(2a) Workout: tapping logged row sends NO DELETE; delete -> UndoToast -> Undo cancels -> delete again -> expiry sends 1 DELETE', async ({
    page,
  }) => {
    try {
    const deleteUrls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/sets')) {
        deleteUrls.push(req.url());
      }
    });

    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await page.waitForLoadState('networkidle');

    const chooseBtn = page.locator('button:has-text("Choose Routine")');
    const routineBtn = page.locator('[data-testid="routine-select-btn"]');
    await expect(chooseBtn.or(routineBtn).first()).toBeVisible({ timeout: 15000 });

    if (await chooseBtn.isVisible()) {
      await chooseBtn.click();
      await page.click('button:has-text("Workout A (Push, Quads & Core)")');
    } else {
      const text = await routineBtn.textContent();
      if (!text?.includes('Workout A')) {
        await routineBtn.click();
        await page.click('button:has-text("Workout A (Push, Quads & Core)")');
      }
    }

    const card = page.locator('[data-testid="exercise-card-0"]');
    await expect(card).toBeVisible({ timeout: 15000 });

    // Ensure at least one logged set exists in the exercise
    let loggedRow = card.locator('[data-testid^="logged-set-row-0-"]').first();
    if (!(await loggedRow.isVisible())) {
      const ghostWeight = card.locator('[data-testid="ghost-weight-0-0"]');
      const ghostReps = card.locator('[data-testid="ghost-reps-0-0"]');
      const commitBtn = card.locator('[data-testid="commit-set-btn-0-0"]');
      await ghostWeight.fill('135');
      await ghostReps.fill('10');
      await commitBtn.click();
      await expect(loggedRow).toBeVisible({ timeout: 5000 });
    }

    // 1. Tapping logged row opens sheet and sends NO DELETE requests
    await loggedRow.click();
    const sheet = page.locator('[data-testid="edit-set-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });
    expect(deleteUrls.length, 'Tapping a logged set must send NO DELETE requests').toBe(0);

    // 2. Click Delete inside sheet -> sheet closes, UndoToast visible
    const deleteBtn = sheet.locator('[data-testid="delete-set-btn"]');
    await deleteBtn.click();
    await expect(sheet).not.toBeVisible();

    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Set deleted');

    // 3. Click Undo on toast -> 0 DELETE requests sent, row restored
    const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
    await undoBtn.click();
    await expect(toast).not.toBeVisible();
    expect(deleteUrls.length, 'Undo must send 0 DELETE requests').toBe(0);

    loggedRow = card.locator('[data-testid^="logged-set-row-0-"]').first();
    await expect(loggedRow).toBeVisible({ timeout: 5000 });

    // 4. Delete again -> wait for 6s expiry -> exactly 1 DELETE request
    await loggedRow.click();
    await expect(sheet).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();
    await expect(sheet).not.toBeVisible();
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Wait for deferred delete countdown expiry using expect.poll (no waitForTimeout)
    await expect
      .poll(() => deleteUrls.length, {
        message: 'Expected exactly 1 DELETE request upon UndoToast expiry',
        timeout: 10000,
        intervals: [250, 500, 1000],
      })
      .toBe(1);
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  test('(2b) History: open a session with 6 rows, Esc keeps 6 rows and returns focus; save 105 shows 105 with no "No sets recorded" flash', async ({
    page,
  }) => {
    let setsData = [
      { id: 'set-1', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 10, set_index: 1, set_type: 'working', rpe: null, created_at: '2026-09-25T10:00:00Z' },
      { id: 'set-2', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 10, set_index: 2, set_type: 'working', rpe: null, created_at: '2026-09-25T10:02:00Z' },
      { id: 'set-3', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 8, set_index: 3, set_type: 'working', rpe: null, created_at: '2026-09-25T10:04:00Z' },
      { id: 'set-4', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 8, set_index: 4, set_type: 'working', rpe: null, created_at: '2026-09-25T10:06:00Z' },
      { id: 'set-5', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 6, set_index: 5, set_type: 'working', rpe: null, created_at: '2026-09-25T10:08:00Z' },
      { id: 'set-6', workout_id: 'mock-session-6', exercise_id: 'ex-1', exercise_name: 'Incline Bench Press', weight: 100, reps: 6, set_index: 6, set_type: 'working', rpe: null, created_at: '2026-09-25T10:10:00Z' },
    ];

    await page.route('**/rest/v1/rpc/get_history_sessions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify([
          {
            id: 'mock-session-6',
            name: 'Full Body Strength',
            date: '2026-09-25',
            workout_date: '2026-09-25',
            civil_date: '2026-09-25',
            set_count: 6,
            total_volume: 600,
            sets: [],
          },
        ]),
      });
    });

    await page.route('**/rest/v1/sets*', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        const url = new URL(req.url());
        const idParam = url.searchParams.get('id')?.replace('eq.', '');
        const responseData = idParam ? setsData.filter((s) => s.id === idParam) : setsData;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(responseData),
        });
      } else if (req.method() === 'PATCH') {
        const body = req.postDataJSON() || {};
        const url = new URL(req.url());
        const idParam = url.searchParams.get('id')?.replace('eq.', '');
        setsData = setsData.map((s) => (s.id === idParam ? { ...s, ...body } : s));
        const updated = setsData.find((s) => s.id === idParam);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify([updated]),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    await page.goto('/history');
    await page.waitForSelector("text=Workout History");

    const expandBtn = page.locator('[data-testid="expand-session-btn-mock-session-6"]');
    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    // Auto-expands the first sessions within the 100-set budget, so this 6-set session opens by itself.
    // Do not click: a click racing the (microtask-deferred) auto-expand would collapse it again.
    await expect(expandBtn).toHaveAttribute('aria-expanded', 'true', { timeout: 10000 });

    const editBtns = page.locator('[data-testid^="edit-set-btn-"]');
    await expect(editBtns.first()).toBeVisible({ timeout: 10000 });
    await expect(editBtns).toHaveCount(6);

    // Open set sheet on row 2
    const targetRowBtn = page.locator('[data-testid="edit-set-btn-set-2"]');
    await targetRowBtn.click();

    const sheet = page.locator('[data-testid="edit-set-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Press Escape -> still 6 rows and focus returns to targetRowBtn
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
    await expect(editBtns).toHaveCount(6);
    await expect(targetRowBtn).toBeFocused();

    // Open sheet again to edit weight to 105
    await targetRowBtn.click();
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Install MutationObserver to detect any sampled flash of "No sets recorded"
    await page.evaluate(() => {
      (window as any).__sawNoSetsFlash = false;
      const observer = new MutationObserver(() => {
        if (document.body.innerText.includes('No sets recorded')) {
          (window as any).__sawNoSetsFlash = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      (window as any).__noSetsObserverInstance = observer;
    });

    const weightInput = page.locator('[data-testid="edit-set-weight-input"]');
    await weightInput.fill('105');

    const saveBtn = sheet.locator('[data-testid="save-set-btn"]');
    await saveBtn.click();
    await expect(sheet).not.toBeVisible();

    // Assert 105 is visible
    const updatedSetText = page.locator('text=105 lbs × 10 reps');
    await expect(updatedSetText).toBeVisible({ timeout: 5000 });

    // Assert "No sets recorded" was never present at any sampled moment
    const sawNoSetsFlash = await page.evaluate(() => {
      (window as any).__noSetsObserverInstance?.disconnect();
      return (window as any).__sawNoSetsFlash;
    });
    expect(sawNoSetsFlash, 'Found flash of "No sets recorded" during set edit save').toBe(false);
    await expect(page.getByText('No sets recorded for this workout.')).not.toBeVisible();
  });

  test('(2c) Nutrition toast: log a quick item and assert toast outerHTML equals the one captured at base 62bd8a5', async ({
    page,
  }) => {
    // Provide a deterministic quick-log favorite so the test is self-sufficient on fresh seed DBs
    // (supabase/seed.sql lines 492-508 seed custom dishes only for bench-athlete, 0 for athlete@yourbody.fyi).
    const favoriteDish = {
      id: 'dish-poached-chicken-fav',
      user_id: 'a0000000-0000-0000-0000-000000000002',
      name: 'Poached Chicken Slices',
      calories: 132,
      protein: 27,
      carbs: 0,
      fat: 2,
      fiber: 0,
      created_at: new Date().toISOString(),
      kind: 'dish',
      use_count: 5,
      notes: null,
    };

    await page.route('**/rest/v1/custom_dishes*', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
            'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'content-range': '0-0/1',
        },
        body: JSON.stringify([favoriteDish]),
      });
    });

    await page.route('**/rest/v1/rpc/increment_dish_use_count*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({}),
      });
    });

    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    await page.goto('/nutrition');
    await page.waitForSelector("text=Today's Nutrition");

    const quickLogBtn = page.locator('[data-testid^="quick-log-btn-"]').first();
    await expect(quickLogBtn).toBeVisible({ timeout: 10000 });
    await quickLogBtn.click();

    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 5000 });

    const actualHtml = await toast.evaluate((el) => el.outerHTML);

    expect(
      normalizeToast(actualHtml),
      'Nutrition quick log toast outerHTML must match base 62bd8a5 verbatim (normalized bottom px style)'
    ).toBe(normalizeToast(EXPECTED_62BD8A5_TOAST_OUTER_HTML));

    // Cleanup: dismiss toast by clicking Undo
    const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
    if (await undoBtn.isVisible()) {
      await undoBtn.click();
      await expect(toast).not.toBeVisible();
    }
  });
});
