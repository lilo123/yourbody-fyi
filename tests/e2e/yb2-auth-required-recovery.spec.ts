import { execSync } from 'child_process';
import { test, expect, Page } from '@playwright/test';

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

const SPEC_WORKOUT_DATE = '2026-10-31';

/**
 * Narrow DB cleanup scoped strictly to workouts created during this spec.
 * In contrast to tests/e2e/workout-session-flows.spec.ts:26-45 which performs a broad
 * non-benchmark wipe (name <> 'Push Day Benchmark'), this spec isolates test mutations
 * to SPEC_WORKOUT_DATE ('2026-10-31') and only removes rows matching that specific date.
 */
function cleanupSpecWorkouts() {
  const sql = `
    DELETE FROM public.sets
    WHERE workout_id IN (
      SELECT id FROM public.workouts
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND (workout_date = '${SPEC_WORKOUT_DATE}' OR date = '${SPEC_WORKOUT_DATE}')
    );
    DELETE FROM public.workouts
    WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
      AND (workout_date = '${SPEC_WORKOUT_DATE}' OR date = '${SPEC_WORKOUT_DATE}');
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[yb2-auth-required-recovery] Error cleaning up spec workouts:', err);
    throw err;
  }
}

/**
 * Deterministically initializes a workout session on SPEC_WORKOUT_DATE without any
 * non-deterministic "if visible" branching. SPEC_WORKOUT_DATE is a Saturday (rest day),
 * guaranteeing a clean start state with the "Choose Routine" button always visible.
 */
async function setupWorkoutForDate(page: Page) {
  await page.goto(`/workout?date=${SPEC_WORKOUT_DATE}`);
  await page.locator('button:has-text("Choose Routine")').click();
  await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A (Push, Quads & Core)")').click();
  await page.locator('[data-testid="routine-picker-modal"]').waitFor({ state: 'hidden' });
  await expect(page.locator('[data-testid="ghost-weight-0-0"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="ghost-reps-0-0"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="commit-set-btn-0-0"]')).toBeVisible({ timeout: 10000 });
}

test.describe('YB2 Auth Flag Recovery & Multi-Tab Synchronization (D-YB2-2)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    cleanupSpecWorkouts();
  });

  test.afterEach(async () => {
    cleanupSpecWorkouts();
  });

  test.afterAll(async () => {
    cleanupSpecWorkouts();
  });

  // Scenario (i): fresh context -> /login -> sign in as coach via form -> pill reads "Online" on /coach and /workout
  test('(i) fresh context -> /login -> sign in as coach -> pill reads "Online" on /coach and /workout', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');

    const pill = page.locator('[data-testid="connection-status"]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('title', 'Online');

    // Navigate to /workout and assert pill remains Online
    await page.goto('/workout');
    await expect(page.locator('[data-testid="workout-date-input"]')).toBeVisible();
    await expect(pill).toHaveAttribute('title', 'Online');
  });

  // Scenario (ii): athlete signed in, route-intercept token once -> pill shows "Sign in to sync",
  // then sign out and sign back in via real UI form -> pill returns to "Online" without page reload
  test('(ii) athlete signed in, route-intercept token once -> pill shows "Sign in to sync", then sign in again via UI -> pill returns to "Online" without reload', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout*');

    const pill = page.locator('[data-testid="connection-status"]');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('title', 'Online');

    // Deterministically initialize workout session on isolated spec date
    await setupWorkoutForDate(page);

    // Mark window before error occurs to verify no full page reload during the entire recovery flow
    await page.evaluate(() => {
      (window as any).__testNoReloadSentinel = 42;
    });

    await page.locator('[data-testid="ghost-weight-0-0"]').fill('135');
    await page.locator('[data-testid="ghost-reps-0-0"]').fill('10');

    // Intercept token endpoint with invalid_grant to force flusher refresh failure
    await page.route('**/auth/v1/token*', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token: Refresh Token Not Found',
          code: 'refresh_token_not_found',
        }),
      });
    });

    // Intercept REST sets with 401 so replay encounters AUTH error
    await page.route('**/rest/v1/sets*', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
        body: JSON.stringify({ message: 'JWT expired', code: 401 }),
      });
    });

    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');
    await commitBtn.click();

    // Flusher catches 401, attempts refreshSession, hits intercepted token endpoint, and sets authRequired = true
    await expect(pill).toHaveAttribute('title', 'Sign in to sync', { timeout: 10000 });

    // Unroute so future auth requests succeed
    await page.unroute('**/rest/v1/sets*');
    await page.unroute('**/auth/v1/token*');

    // Real UI re-authentication flow:
    // Sign out through Header UI -> Confirm modal -> SPA redirects to /login without full reload
    await page.locator('[data-testid="sign-out-button"]').click();
    await page.locator('button:has-text("Sign out anyway")').click();
    await page.waitForURL('**/login');

    // Sign in through real UI form
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout*');

    // Pill must return to "Online" via markAuthValid
    await expect(pill).toHaveAttribute('title', 'Online', { timeout: 10000 });

    // Verify no full page reload occurred (sentinel intact across SPA navigation)
    const sentinel = await page.evaluate(() => (window as any).__testNoReloadSentinel);
    expect(sentinel).toBe(42);
  });

  // Scenario (iii): two tabs in one context: tab B shows "Sign in to sync", tab A signs in via UI form -> tab B pill becomes "Online" without reload in B
  test('(iii) two tabs in one context: tab B shows "Sign in to sync", tab A signs in via UI form -> tab B pill becomes "Online" without reload in B', async ({
    context,
  }) => {
    // Open Tab B and sign in as athlete
    const pageB = await context.newPage();
    await pageB.goto('/login');
    await pageB.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await pageB.fill('input[type="password"]', 'password123');
    await pageB.click('button[type="submit"]');
    await pageB.waitForURL('**/workout*');

    const pillB = pageB.locator('[data-testid="connection-status"]');
    await expect(pillB).toBeVisible();
    await expect(pillB).toHaveAttribute('title', 'Online');

    // Deterministically initialize workout session on isolated spec date in Tab B
    await setupWorkoutForDate(pageB);

    // Mark Tab B to verify it does not reload during cross-tab synchronization
    await pageB.evaluate(() => {
      (window as any).__tabBNoReloadSentinel = 99;
    });

    await pageB.locator('[data-testid="ghost-weight-0-0"]').fill('135');
    await pageB.locator('[data-testid="ghost-reps-0-0"]').fill('10');

    // Intercept on pageB only right before commit to force flusher refresh failure
    await pageB.route('**/auth/v1/token*', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token: Refresh Token Not Found',
          code: 'refresh_token_not_found',
        }),
      });
    });

    await pageB.route('**/rest/v1/sets*', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
        body: JSON.stringify({ message: 'JWT expired', code: 401 }),
      });
    });

    const commitBtnB = pageB.locator('[data-testid="commit-set-btn-0-0"]');
    await commitBtnB.click();

    // Verify Tab B pill transitioned to "Sign in to sync"
    await expect(pillB).toHaveAttribute('title', 'Sign in to sync', { timeout: 10000 });

    // Unroute pageB so subsequent auth flows succeed
    await pageB.unroute('**/rest/v1/sets*');
    await pageB.unroute('**/auth/v1/token*');

    // Now open Tab A in the same browser context.
    // Clear the stored auth session in localStorage before Tab A navigates so /login
    // presents the login form instead of redirecting (without sending SIGNED_OUT broadcast to Tab B).
    const pageA = await context.newPage();
    await pageB.evaluate(() => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('sb-') || k.includes('auth-token') || k === 'yourbody_user')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    });

    // Tab A navigates to /login and performs UI form login
    await pageA.goto('/login');
    await pageA.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await pageA.fill('input[type="password"]', 'password123');
    await pageA.click('button[type="submit"]');
    await pageA.waitForURL('**/workout*');

    // Tab B must automatically clear the authRequired flag via BroadcastChannel SIGNED_IN event and become "Online"
    await expect(pillB).toHaveAttribute('title', 'Online', { timeout: 10000 });

    // Assert Tab B never reloaded
    const sentinelB = await pageB.evaluate(() => (window as any).__tabBNoReloadSentinel);
    expect(sentinelB).toBe(99);

    await pageA.close();
    await pageB.close();
  });
});
