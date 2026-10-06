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

interface P5aTestUser {
  id: string;
  email: string;
  password: string;
}

let p5aUser: P5aTestUser;

function cleanupP5aUser(user?: P5aTestUser) {
  if (!user || (!user.id && !user.email)) return;
  const whereClauses: string[] = [];
  if (user.email) whereClauses.push(`email = '${user.email}'`);
  if (user.id) whereClauses.push(`id = '${user.id}'`);

  const idSubquery = `SELECT id FROM auth.users WHERE ${whereClauses.join(' OR ')}`;

  const sql = `
    DELETE FROM public.sets WHERE workout_id IN (
      SELECT id FROM public.workouts WHERE user_id IN (${idSubquery})
    );
    DELETE FROM public.workouts WHERE user_id IN (${idSubquery});
    DELETE FROM public.users WHERE id IN (${idSubquery});
    DELETE FROM auth.users WHERE ${whereClauses.join(' OR ')};
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p5a-history] Cleanup error:', err);
    throw err;
  }
}

async function seedP5aUserAndSessions(): Promise<P5aTestUser> {
  const email = `p5a-history-${Date.now()}-${Math.floor(Math.random() * 1000000)}@yourbody.fyi`;
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

  // Ensure user profile with weight_unit = 'lb' and pr_mode = 'weight'
  // and seed 35 sessions dated 40..74 days ago (all older than 30d, all within 90d/all)
  const sql = `
    INSERT INTO public.users (id, email, username, role, weight_unit, pr_mode)
    VALUES ('${userId}', '${email}', 'P5a Athlete', 'athlete', 'lb', 'weight')
    ON CONFLICT (id) DO UPDATE SET username = 'P5a Athlete', role = 'athlete', weight_unit = 'lb', pr_mode = 'weight';

    DO $$
    DECLARE
      v_uid uuid := '${userId}';
      v_wid uuid;
      v_eid uuid;
      v_date date;
    BEGIN
      SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
      FOR i IN 0..34 LOOP
        v_date := (CURRENT_DATE - (40 + i));
        v_wid := gen_random_uuid();
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES (v_wid, v_uid, 'P5a Session ' || LPAD(i::text, 2, '0'), v_date, v_date::timestamptz);

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES (gen_random_uuid(), v_wid, v_eid, 135, 10, 1, 'working', v_date::timestamptz);
      END LOOP;
    END $$;
  `;
  const cmd = getPsqlCommand();
  execSync(cmd, { input: sql, encoding: 'utf8' });

  return { id: userId, email, password };
}

async function loginAsP5aAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', p5aUser.email);
  await page.fill('input[type="password"]', p5aUser.password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
  await expect(page.locator('[data-testid="workout-date-input"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="nav-history"]').click({ force: true });
  await page.waitForURL('**/history');
  await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
}

test.describe('History Suite (p5a-history)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    p5aUser = await seedP5aUserAndSessions();
  });

  test.afterAll(async () => {
    if (p5aUser) {
      cleanupP5aUser(p5aUser);
    }
  });

  // (a) Range chips:
  // 30D with no recent sessions shows the server-confirmed empty state with 'Clear filters' (not a Load More);
  // All shows sessions and 'Showing N of M'.
  test('(a) range chips: 30D empty state with Clear filters vs All with sessions and count', async ({ page }) => {
    await loginAsP5aAthlete(page);

    const countBanner = page.locator('[data-testid="showing-sessions-count"]');
    const chip30d = page.locator('[data-testid="history-range-30d"]');
    const chipAll = page.locator('[data-testid="history-range-all"]');
    const loadMoreBtn = page.locator('[data-testid="load-more-sessions-btn"]');

    // 1. Initial state defaults to 'all' -> 30 of 35 sessions loaded
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toBeVisible();

    // 2. Select 30D chip: all seeded sessions are >40d ago, server returns 0
    await chip30d.click();
    await expect(page.locator('text=No workout sessions recorded in this time range.')).toBeVisible({ timeout: 10000 });
    const clearFiltersBtn = page.locator('[data-testid="clear-filters-btn"]');
    await expect(clearFiltersBtn).toBeVisible();
    await expect(loadMoreBtn).not.toBeVisible();

    // 3. Click 'Clear filters' -> resets to 'all' range and restores list
    await clearFiltersBtn.click();
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });
    await expect(loadMoreBtn).toBeVisible();
    await expect(chipAll).toHaveAttribute('aria-pressed', 'true');
  });

  // (b) Keep-alive:
  // Load >=2 pages, expand a session, scroll, go to Workout tab and back:
  // -> same pages loaded (count cards/'Showing N of M'), expanded session still expanded, scrollY within 5px.
  test('(b) keep-alive: pages, expanded session, and scroll position preserved across tab switch', async ({ page }) => {
    await loginAsP5aAthlete(page);

    const countBanner = page.locator('[data-testid="showing-sessions-count"]');
    const loadMoreBtn = page.locator('[data-testid="load-more-sessions-btn"]');

    // 1. Load >=2 pages (click Load More to load page 2, reaching all 35 sessions)
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });
    await loadMoreBtn.click();
    await expect(countBanner).toHaveText('Showing 35 of 35 sessions', { timeout: 10000 });

    // Scroll back to top after clicking load-more at the bottom
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // 2. Expand session card #3 (index 2), which is in view and not auto-expanded
    const targetExpandBtn = page.locator('button[data-testid^="expand-session-btn-"]').nth(2);
    await expect(targetExpandBtn).toBeVisible({ timeout: 10000 });
    await expect(targetExpandBtn).toHaveAttribute('aria-expanded', 'false');
    await targetExpandBtn.click();
    await expect(targetExpandBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('text=135 lbs × 10 reps').first()).toBeVisible({ timeout: 5000 });

    // 3. Scroll down
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    expect(scrollYBefore).toBeGreaterThanOrEqual(100);

    // 4. Navigate to Workout tab via BottomNav (use force: true so Playwright does not scroll the fixed nav into view)
    const workoutNav = page.locator('[data-testid="nav-workout"]');
    await workoutNav.click({ force: true });
    await page.waitForURL('**/workout');

    // 5. Navigate back to History tab via BottomNav
    const historyNav = page.locator('[data-testid="nav-history"]');
    await historyNav.click({ force: true });
    await page.waitForURL('**/history');

    // 6. Verify keep-alive state
    // Pages: all 35 sessions remain loaded
    await expect(countBanner).toHaveText('Showing 35 of 35 sessions', { timeout: 10000 });

    // Expanded session: still expanded
    await expect(targetExpandBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('text=135 lbs × 10 reps').first()).toBeVisible();

    // Scroll: position restored within 5px (using expect.poll to allow rAF scroll restoration to complete)
    await expect.poll(async () => {
      const scrollYAfter = await page.evaluate(() => window.scrollY);
      return Math.abs(scrollYAfter - scrollYBefore);
    }, { timeout: 10000 }).toBeLessThanOrEqual(5);
  });

  // (c) Session ⋯ menu:
  // 'Edit in Workout' lands on /workout?date=<civil date> showing that date;
  // 'Delete session' opens ConfirmDialog, Cancel keeps it, Confirm removes it (only on a session you created).
  test('(c) session overflow menu: Edit in Workout deep link and Delete session ConfirmDialog', async ({ page }) => {
    await loginAsP5aAthlete(page);

    const countBanner = page.locator('[data-testid="showing-sessions-count"]');
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });

    // 1. Test 'Edit in Workout'
    const firstMenuBtn = page.locator('button[data-testid^="session-actions-"]').first();
    await expect(firstMenuBtn).toBeVisible({ timeout: 10000 });
    await firstMenuBtn.click();

    const editItem = page.locator('[data-testid^="edit-session-"]').first();
    await expect(editItem).toBeVisible({ timeout: 5000 });
    await editItem.click();

    // Lands on /workout?date=<civil date>
    await page.waitForURL(/\/workout\?date=\d{4}-\d{2}-\d{2}/, { timeout: 10000 });
    const url = new URL(page.url());
    const expectedCivilDate = url.searchParams.get('date');
    expect(expectedCivilDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const workoutDateInput = page.locator('[data-testid="workout-date-input"]');
    await expect(workoutDateInput).toBeVisible({ timeout: 10000 });
    await expect(workoutDateInput).toHaveValue(expectedCivilDate!);

    // 2. Return to /history for 'Delete session' flow
    await page.locator('[data-testid="nav-history"]').click({ force: true });
    await page.waitForURL('**/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible({ timeout: 10000 });
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions', { timeout: 10000 });

    const targetMenuBtn = page.locator('button[data-testid^="session-actions-"]').first();
    await expect(targetMenuBtn).toBeVisible({ timeout: 10000 });
    await targetMenuBtn.click();

    const deleteItem = page.locator('[data-testid^="delete-session-"]').first();
    await expect(deleteItem).toBeVisible({ timeout: 5000 });
    await deleteItem.click();

    // ConfirmDialog opens
    const confirmDialog = page.locator('[data-testid="delete-session-confirm-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Cancel preserves the session
    const cancelBtn = confirmDialog.locator('button:has-text("Cancel")');
    await cancelBtn.click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(countBanner).toHaveText('Showing 30 of 35 sessions');

    // Confirm removes the session
    await targetMenuBtn.click();
    await expect(deleteItem).toBeVisible({ timeout: 5000 });
    await deleteItem.click();
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    const confirmDeleteBtn = confirmDialog.locator('button:has-text("Delete")');
    await confirmDeleteBtn.click();
    await expect(confirmDialog).not.toBeVisible();

    // Session count decreases by 1 (total is now 34)
    await expect(countBanner).toHaveText(/Showing (29|30) of 34 sessions/, { timeout: 10000 });
  });

  // (d) Tabs ARIA:
  // role=tablist, ArrowRight moves selection.
  test('(d) tabs ARIA: role=tablist and ArrowRight moves selection on SegmentedTabs', async ({ page }) => {
    await loginAsP5aAthlete(page);

    // 1. History domain tabs (Workouts / Nutrition)
    const domainTablist = page.locator('[aria-label="History domain"][role="tablist"]');
    await expect(domainTablist).toBeVisible({ timeout: 10000 });

    const workoutsTab = domainTablist.locator('[role="tab"][data-testid="history-tab-workouts"]');
    const nutritionTab = domainTablist.locator('[role="tab"][data-testid="history-tab-nutrition"]');

    await expect(workoutsTab).toHaveAttribute('aria-selected', 'true');
    await expect(nutritionTab).toHaveAttribute('aria-selected', 'false');

    await workoutsTab.focus();
    await page.keyboard.press('ArrowRight');

    await expect(nutritionTab).toHaveAttribute('aria-selected', 'true');
    await expect(nutritionTab).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(workoutsTab).toHaveAttribute('aria-selected', 'true');
    await expect(workoutsTab).toBeFocused();

    // 2. Workout view mode sub-tabs (By Session / By Exercise)
    const viewModeTablist = page.locator('[aria-label="Workout view mode"][role="tablist"]');
    await expect(viewModeTablist).toBeVisible({ timeout: 10000 });

    const sessionTab = viewModeTablist.locator('[role="tab"][data-testid="history-subview-session"]');
    const exerciseTab = viewModeTablist.locator('[role="tab"][data-testid="history-subview-exercise"]');

    await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
    await expect(exerciseTab).toHaveAttribute('aria-selected', 'false');

    await sessionTab.focus();
    await page.keyboard.press('ArrowRight');

    await expect(exerciseTab).toHaveAttribute('aria-selected', 'true');
    await expect(exerciseTab).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
    await expect(sessionTab).toBeFocused();
  });

  // (e) 320px viewport:
  // No horizontal document overflow on /history (scrollWidth <= clientWidth) in both sub-views.
  test('(e) 320px: no horizontal document overflow in both By Session and By Exercise sub-views', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await loginAsP5aAthlete(page);

    // 1. By Session sub-view
    await expect(page.locator('[data-testid="history-subview-session"]')).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    const isOverflowingSession = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowingSession, 'No horizontal overflow on /history By Session at 320px').toBe(false);

    // 2. By Exercise sub-view
    const exerciseTab = page.locator('[data-testid="history-subview-exercise"]');
    await exerciseTab.click();
    await expect(page.locator('[data-testid="all-time-stats-caption"]')).toBeVisible({ timeout: 10000 });

    const isOverflowingExercise = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowingExercise, 'No horizontal overflow on /history By Exercise at 320px').toBe(false);
  });

  // (f) By-Exercise shows 'All-time stats' and no date chips.
  test('(f) by-exercise sub-view shows All-time stats caption and hides date chips', async ({ page }) => {
    await loginAsP5aAthlete(page);

    const sessionTab = page.locator('[data-testid="history-subview-session"]');
    const exerciseTab = page.locator('[data-testid="history-subview-exercise"]');
    const allTimeStats = page.locator('[data-testid="all-time-stats-caption"]');
    const dateChips = page.locator('[data-testid^="history-range-"]');

    // In By Session mode: date chips visible, all-time stats caption absent
    await expect(sessionTab).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    await expect(dateChips).toHaveCount(4);
    await expect(allTimeStats).not.toBeVisible();

    // Switch to By Exercise mode: date chips hidden, all-time stats caption visible
    await exerciseTab.click();
    await expect(exerciseTab).toHaveAttribute('aria-selected', 'true');
    await expect(allTimeStats).toBeVisible({ timeout: 10000 });
    await expect(allTimeStats).toHaveText('All-time stats');
    await expect(dateChips).toHaveCount(0);

    // Switch back to By Session mode: date chips reappear
    await sessionTab.click();
    await expect(sessionTab).toHaveAttribute('aria-selected', 'true');
    await expect(allTimeStats).not.toBeVisible();
    await expect(dateChips).toHaveCount(4);
  });
});
