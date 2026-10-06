import { test, expect } from '@playwright/test';

test.describe('Payload & Cache Key Disambiguation Verification', () => {
  test.describe.configure({ mode: 'serial' });

  // /workout loads routine templates via the paged RPC get_routine_catalog
  // (keyset cursor, server-clamped limit <= 200) instead of GET routine_templates?limit=100.
  // The payload bound and the "no nested template_exercises embed on /workout" contract are kept.
  test('Order A: Cold navigation directly to /workout measures <= 51,200 B via bounded get_routine_catalog page', async ({ page }) => {
    const legacyWorkoutTplGets: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/rest/v1/routine_templates') && !req.url().includes('template_exercises')) {
        legacyWorkoutTplGets.push(req.url());
      }
    });
    const workoutTplPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/rpc/get_routine_catalog') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    const response = await workoutTplPromise;
    const body = await response.body();
    const reqBody = response.request().postDataJSON() as { p_limit: number; p_user_id: string; p_cursor: string | null };
    const rows = JSON.parse(body.toString()) as Array<Record<string, unknown>>;

    console.log(`[Order A: Cold /workout]`);
    console.log(`URL: ${response.url()}`);
    console.log(`HTTP Status: ${response.status()}`);
    console.log(`p_limit: ${reqBody.p_limit}  p_cursor: ${reqBody.p_cursor}`);
    console.log(`Rows: ${rows.length}`);
    console.log(`Payload Bytes: ${body.length}`);

    expect(response.status()).toBe(200);
    expect(reqBody.p_limit).toBeGreaterThan(0);
    expect(reqBody.p_limit).toBeLessThanOrEqual(200);
    expect(reqBody.p_cursor).toBeNull();
    expect(typeof reqBody.p_user_id).toBe('string');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(reqBody.p_limit);
    expect(Object.keys(rows[0])).not.toContain('template_exercises');
    expect(Object.keys(rows[0])).not.toContain('exercises');

    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThanOrEqual(51200);
    // The RPC succeeded, so the legacy unpaged fallback query must not have been issued.
    expect(legacyWorkoutTplGets).toEqual([]);

    console.log(`VERIFICATION_ORDER_A_BYTES=${body.length}`);
    console.log(`VERIFICATION_ORDER_A_LIMIT=${reqBody.p_limit}`);
    console.log(`VERIFICATION_ORDER_A_STATUS=PASS`);
  });

  /**
   * NOTE ON REWRITE (Cache Disambiguation):
   * /exercises now uses get_routine_catalog RPC from TemplateListTab (only when the Templates sub-tab is opened),
   * replacing the legacy unpaged/REST routine_templates query.
   *
   * This test proves that:
   * 1. The /exercises route's routine load is the bounded get_routine_catalog page (<= 51,200 B).
   * 2. No GET /rest/v1/routine_templates list request is made from /exercises.
   * 3. /workout and /exercises maintain cache-key separation, refetching their respective bounded queries.
   */
  test('Order B: Client navigation /exercises -> /workout refetches bounded query <= 51,200 B and asserts projection & order', async ({ page }) => {
    // 1. Authenticate session
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Open /exercises with fresh client cache and monitor requests
    const legacyExercisesTplGets: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/rest/v1/routine_templates') && req.method() === 'GET') {
        legacyExercisesTplGets.push(req.url());
      }
    });

    await page.goto('/exercises');
    await page.waitForURL('**/exercises');

    // Switch to Templates sub-tab to trigger routine catalog load via get_routine_catalog RPC
    const exercisesCatalogPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/rpc/get_routine_catalog') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await page.click('button[role="tab"]:has-text("Templates")');

    const exercisesCatalogRes = await exercisesCatalogPromise;
    const exercisesBody = await exercisesCatalogRes.body();
    const exercisesUrl = exercisesCatalogRes.url();
    const exercisesReq = exercisesCatalogRes.request().postDataJSON() as { p_limit: number; p_user_id?: string };
    const exercisesLimit = exercisesReq.p_limit;
    const exercisesRows = JSON.parse(exercisesBody.toString()) as Array<Record<string, unknown>>;

    console.log(`[Order B Step 1: /exercises Templates tab]`);
    console.log(`URL: ${exercisesUrl}`);
    console.log(`HTTP Status: ${exercisesCatalogRes.status()}`);
    console.log(`p_limit: ${exercisesLimit}`);
    console.log(`Rows: ${exercisesRows.length}`);
    console.log(`Payload Bytes: ${exercisesBody.length}`);

    expect(exercisesCatalogRes.status()).toBe(200);
    expect(exercisesLimit).toBe(50);
    expect(exercisesBody.length).toBeGreaterThan(0);
    expect(exercisesBody.length).toBeLessThanOrEqual(51200);
    expect(exercisesRows.length).toBeGreaterThan(0);
    expect(exercisesRows.length).toBeLessThanOrEqual(exercisesLimit);
    // Routine catalog loaded via RPC, so no GET /rest/v1/routine_templates list request is made from /exercises
    expect(legacyExercisesTplGets).toEqual([]);
    console.log(`VERIFICATION_ORDER_B_EXERCISES_BYTES=${exercisesBody.length}`);

    // Wait for bottom navigation
    await expect(page.locator('[data-testid="nav-workout"]')).toBeVisible();

    // 3. Navigate client-side to /workout
    // Because cache keys are disambiguated, /workout MUST issue its own bounded request
    // (the paged get_routine_catalog RPC) and cannot silently inherit the /exercises cache entry.
    const workoutTplPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/rpc/get_routine_catalog') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 6000 }
    );

    await page.click('[data-testid="nav-workout"]');
    await page.waitForURL('**/workout');

    const workoutRes = await workoutTplPromise;
    const workoutBody = await workoutRes.body();
    const workoutUrl = workoutRes.url();
    const workoutReq = workoutRes.request().postDataJSON() as { p_limit: number; p_cursor: string | null };
    const workoutLimit = workoutReq.p_limit;
    const workoutRows = JSON.parse(workoutBody.toString()) as Array<Record<string, unknown>>;

    console.log(`[Order B Step 2: /exercises -> /workout]`);
    console.log(`URL: ${workoutUrl}`);
    console.log(`HTTP Status: ${workoutRes.status()}`);
    console.log(`p_limit: ${workoutLimit}`);
    console.log(`Rows: ${workoutRows.length}`);
    console.log(`Payload Bytes: ${workoutBody.length}`);

    expect(workoutRes.status()).toBe(200);
    expect(workoutLimit).toBeGreaterThan(0);
    expect(workoutLimit).toBeLessThanOrEqual(200);
    expect(workoutReq.p_cursor).toBeNull();
    expect(workoutRows.length).toBeGreaterThan(0);
    expect(workoutRows.length).toBeLessThanOrEqual(workoutLimit);

    expect(workoutBody.length).toBeGreaterThan(0);
    expect(workoutBody.length).toBeLessThanOrEqual(51200);

    // 4 & 5. Explicitly assert cache-key separation and request contracts
    // /exercises loads the template catalog page with limit 50; /workout loads the routine picker catalog with limit 200 without nested exercises embed
    expect(exercisesLimit).toBe(50);
    expect(workoutLimit).toBe(200);
    expect(Object.keys(workoutRows[0])).not.toContain('exercises');

    console.log(`VERIFICATION_ORDER_B_EXERCISES_LIMIT=${exercisesLimit}`);
    console.log(`VERIFICATION_ORDER_B_WORKOUT_LIMIT=${workoutLimit}`);
    console.log(`VERIFICATION_ORDER_B_WORKOUT_BYTES=${workoutBody.length}`);
    console.log(`VERIFICATION_ORDER_B_STATUS=PASS`);
  });
});
