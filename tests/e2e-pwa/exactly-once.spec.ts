import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOffline,
  goOnline,
  getUserSets,
  type PwaTestUser,
} from './fixtures';

test.describe('Exactly Once - Idempotency & Concurrency', () => {
  let user: PwaTestUser;

  test.beforeEach(async () => {
    user = await createPwaTestUser('exactly-once-user');
  });

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    if (user) cleanupPwaTestUser(user);
  });

  test('lost response after commit: tab closed mid-sync leaves server committed; replay prevents duplicates', async ({
    page,
    context,
  }) => {
    // 1. Sign in online and verify SW control
    await signInUser(page, user);
    await waitForSwControl(page);

    // 2. Pre-warm /workout while online
    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // 3. Go offline
    await goOffline(context);

    // 4. Log 3 sets offline
    // Set 1
    const weight0 = page.locator('[data-testid="ghost-weight-0-0"]');
    const reps0 = page.locator('[data-testid="ghost-reps-0-0"]');
    const commit0 = page.locator('[data-testid="commit-set-btn-0-0"]');
    await expect(commit0).toBeVisible({ timeout: 10000 });
    await weight0.fill('100');
    await reps0.fill('10');
    await commit0.click();
    await expect(page.locator('[data-testid="logged-set-row-0-0"] [data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // Set 2
    const weight1 = page.locator('[data-testid="ghost-weight-0-1"]');
    const reps1 = page.locator('[data-testid="ghost-reps-0-1"]');
    const commit1 = page.locator('[data-testid="commit-set-btn-0-1"]');
    await expect(commit1).toBeVisible({ timeout: 10000 });
    await weight1.fill('105');
    await reps1.fill('10');
    await commit1.click();
    await expect(page.locator('[data-testid="logged-set-row-0-1"] [data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // Set 3
    const weight2 = page.locator('[data-testid="ghost-weight-0-2"]');
    const reps2 = page.locator('[data-testid="ghost-reps-0-2"]');
    const commit2 = page.locator('[data-testid="commit-set-btn-0-2"]');
    await expect(commit2).toBeVisible({ timeout: 10000 });
    await weight2.fill('110');
    await reps2.fill('10');
    await commit2.click();
    await expect(page.locator('[data-testid="logged-set-row-0-2"] [data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // 5. Intercept Supabase POST /rest/v1/sets*
    // Server commits the insert, but we immediately close the page before the response reaches the page
    let killed = false;
    await context.route('**/rest/v1/sets*', async (route) => {
      if (route.request().method() === 'POST' && !killed) {
        killed = true;
        // Upstream server commits the row: verify response is success (201/200)
        const upstreamRes = await route.fetch();
        expect(upstreamRes.ok()).toBe(true);
        // Immediately close the page without fulfilling response (simulating hard tab termination)
        await page.close();
        return;
      }
      await route.continue();
    });

    // 6. Go online: flusher begins sync, hits route handler, server commits set, tab is closed
    await goOnline(context);

    // 7. Wait briefly for route interception to trigger and page to close
    await expect.poll(() => page.isClosed(), { timeout: 10000 }).toBe(true);

    // Remove route interception so the new page can sync cleanly
    await context.unroute('**/rest/v1/sets*');

    // 8. Open a new page in the same context and load /workout
    const newPage = await context.newPage();
    try {
      await newPage.goto('/workout');
      await waitForSwControl(newPage);

      // Trigger online event to ensure flusher replays remaining outbox
      await newPage.evaluate(() => {
        window.dispatchEvent(new Event('online'));
      });

      // 9. Assert replay completes: toast appears, pending marks clear, online status confirmed
      const syncToast = newPage.locator('text=/Synced \\d+ changes?/').first();
      await expect(syncToast).toBeVisible({ timeout: 15000 });
      await expect(newPage.locator('[data-testid="pending-mark"]')).toHaveCount(0);
      await expect(newPage.locator('[data-testid="connection-status"]')).toContainText('Online');

      // 10. Verify in Postgres: exactly 3 sets exist, no duplicate rows!
      const sets = getUserSets(user.id);
      expect(sets.length).toBe(3);
      expect(sets.map((s) => s.set_index)).toEqual([1, 2, 3]);
      expect(Number(sets[0].weight)).toBe(100);
      expect(Number(sets[1].weight)).toBe(105);
      expect(Number(sets[2].weight)).toBe(110);
    } finally {
      await newPage.close();
    }
  });

  test('flaky reconnect: rapidly toggling connection flushes all pending ops exactly once', async ({
    page,
    context,
  }) => {
    // 1. Sign in online and verify SW control
    await signInUser(page, user);
    await waitForSwControl(page);

    // 2. Pre-warm /workout while online
    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // 3. Go offline
    await goOffline(context);

    // 4. Log set 1
    const weightInput1 = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput1 = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn1 = page.locator('[data-testid="commit-set-btn-0-0"]');

    await expect(commitBtn1).toBeVisible({ timeout: 10000 });
    await weightInput1.fill('120');
    await repsInput1.fill('10');
    await commitBtn1.click();

    const loggedRow1 = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow1).toBeVisible({ timeout: 10000 });
    await expect(loggedRow1.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // Log set 2
    const weightInput2 = page.locator('[data-testid="ghost-weight-0-1"]');
    const repsInput2 = page.locator('[data-testid="ghost-reps-0-1"]');
    const commitBtn2 = page.locator('[data-testid="commit-set-btn-0-1"]');

    await expect(commitBtn2).toBeVisible({ timeout: 10000 });
    await weightInput2.fill('125');
    await repsInput2.fill('8');
    await commitBtn2.click();

    const loggedRow2 = page.locator('[data-testid="logged-set-row-0-1"]');
    await expect(loggedRow2).toBeVisible({ timeout: 10000 });
    await expect(loggedRow2.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // 5. Flaky reconnect: toggle 3 times rapidly
    await goOnline(context, page);
    await goOffline(context);
    await goOnline(context, page);
    await goOffline(context);
    await goOnline(context, page);

    // 6. Verify sync toast appears and pending marks clear
    const syncToast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(syncToast).toBeVisible({ timeout: 15000 });

    await expect(loggedRow1.locator('[data-testid="pending-mark"]')).not.toBeVisible({ timeout: 10000 });
    await expect(loggedRow2.locator('[data-testid="pending-mark"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Online', { timeout: 10000 });

    // 7. Verify in Postgres: exactly 2 sets exist, no duplicates!
    const sets = getUserSets(user.id);
    expect(sets.length).toBe(2);
    expect(sets.map((s) => s.set_index)).toEqual([1, 2]);
  });

  test('multi-tab race with Web Locks: concurrent tabs transition online with 0 duplicate rows', async ({
    page: page1,
    context,
  }) => {
    // 1. Sign in on page1
    await signInUser(page1, user);
    await waitForSwControl(page1);
    await expect(page1.locator('[data-testid="exercise-card-0"]')).toBeVisible({ timeout: 10000 });

    // 2. Open workout on page2 (shares authenticated session)
    const page2 = await context.newPage();
    try {
      await page2.goto('/workout');
      await waitForSwControl(page2);
      await expect(page2.locator('[data-testid="exercise-card-0"]')).toBeVisible({ timeout: 10000 });

      // 3. Go offline
      await goOffline(context);

      // 4. Log set offline on page1
      const weightInput = page1.locator('[data-testid="ghost-weight-0-0"]');
      const repsInput = page1.locator('[data-testid="ghost-reps-0-0"]');
      const commitBtn = page1.locator('[data-testid="commit-set-btn-0-0"]');

      await expect(commitBtn).toBeVisible({ timeout: 10000 });
      await weightInput.fill('140');
      await repsInput.fill('5');
      await commitBtn.click();

      const loggedRow = page1.locator('[data-testid="logged-set-row-0-0"]');
      await expect(loggedRow).toBeVisible({ timeout: 10000 });
      await expect(loggedRow.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

      // 5. Transition both tabs online simultaneously
      await goOnline(context);
      await Promise.all([
        page1.evaluate(() => window.dispatchEvent(new Event('online'))),
        page2.evaluate(() => window.dispatchEvent(new Event('online'))),
      ]);

      // 6. Assert sync toast appears on page1 and pending mark disappears
      const syncToast = page1.locator('text=/Synced \\d+ changes?/').first();
      await expect(syncToast).toBeVisible({ timeout: 15000 });
      await expect(loggedRow.locator('[data-testid="pending-mark"]')).not.toBeVisible({ timeout: 10000 });

      await expect(page1.locator('[data-testid="connection-status"]')).toContainText('Online', { timeout: 10000 });
      await expect(page2.locator('[data-testid="connection-status"]')).toContainText('Online', { timeout: 10000 });

      // 7. Verify in Postgres: Web Lock ensured single execution - exactly 1 row in DB!
      const sets = getUserSets(user.id);
      expect(sets.length).toBe(1);
      expect(sets[0].weight).toBe(140);
      expect(sets[0].reps).toBe(5);
    } finally {
      await page2.close();
    }
  });
});
