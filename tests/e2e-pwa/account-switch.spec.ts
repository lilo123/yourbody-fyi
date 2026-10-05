import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOffline,
  goOnline,
  getUserSets,
} from './fixtures';

test.describe('Account Switch - Multi-User Outbox Isolation', () => {
  let userA: any;
  let userB: any;

  test.beforeEach(async () => {
    userA = await createPwaTestUser('account-user-a');
    userB = await createPwaTestUser('account-user-b');
  });

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    let errA: unknown;
    let errB: unknown;
    try {
      if (userA) cleanupPwaTestUser(userA);
    } catch (e) {
      errA = e;
    }
    try {
      if (userB) cleanupPwaTestUser(userB);
    } catch (e) {
      errB = e;
    }
    if (errA) throw errA;
    if (errB) throw errB;
  });

  test('user A offline pending sets -> sign out warning dialog -> user B isolated -> user A signs back in -> sync replay', async ({
    page,
    context,
  }) => {
    // 1. Sign in as User A and verify SW control
    await signInUser(page, userA);
    await waitForSwControl(page);

    // 2. Pre-warm /workout while online
    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // 3. User A goes offline
    await goOffline(context, page);

    // 4. User A logs a set offline
    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');

    await expect(commitBtn).toBeVisible({ timeout: 10000 });
    await weightInput.fill('135');
    await repsInput.fill('5');
    await commitBtn.click();

    // Verify row appears with pending mark
    const loggedRow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow).toBeVisible({ timeout: 10000 });
    await expect(loggedRow.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    const connectionStatusBtn = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatusBtn).toContainText('Offline', { timeout: 10000 });

    // 5. User A clicks Sign Out
    const signOutBtn = page.locator('[data-testid="sign-out-button"]');
    await expect(signOutBtn).toBeVisible({ timeout: 10000 });
    await signOutBtn.click();

    // 6. Warning dialog appears for unsynced changes
    const confirmDialog = page.locator('[data-testid="sign-out-confirm-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 10000 });
    await expect(confirmDialog.getByRole('heading', { name: 'Unsynced changes' })).toBeVisible();
    await expect(confirmDialog).toContainText('stay on this device');

    // 7. User A confirms sign out anyway
    const confirmSignOutBtn = page.locator('[data-testid="sign-out-confirm-dialog-confirm"]').or(page.locator('button:has-text("Sign out anyway")'));
    await confirmSignOutBtn.first().click();

    // Reconnect online and clear stale Supabase client session token so User B can log in
    await goOnline(context, page);
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('sb-')) {
          localStorage.removeItem(k);
        }
      }
    });

    // 8. Sign in as User B
    await signInUser(page, userB);

    // 9. User B lands on /workout - verify isolation
    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // User B should see clean routine without User A's logged sets
    const userBLoggedRow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(userBLoggedRow).not.toBeVisible();

    // User B's connection status should be Online (no pending changes)
    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Online', { timeout: 10000 });

    // Verify in database: User A's set is not committed yet, User B has 0 sets
    expect(getUserSets(userA.id).length).toBe(0);
    expect(getUserSets(userB.id).length).toBe(0);

    // 10. User B signs out (has 0 unsynced changes -> direct sign out without dialog)
    await page.locator('[data-testid="sign-out-button"]').click();
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(confirmDialog).not.toBeVisible();

    // 11. User A signs back in
    await signInUser(page, userA);
    await page.goto('/workout');

    // User A goes offline to inspect pending set
    await goOffline(context, page);
    const userARow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(userARow).toBeVisible({ timeout: 10000 });
    await expect(userARow.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    // 12. User A reconnects online to trigger outbox flush
    await goOnline(context, page);

    // 13. User A's pending changes sync now that owner matches
    const syncToast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(syncToast).toBeVisible({ timeout: 15000 });
    await expect(userARow.locator('[data-testid="pending-mark"]')).not.toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-testid="connection-status"]')).toContainText('Online', { timeout: 10000 });

    // 14. Verify in Postgres: User A's set is saved in DB, User B has 0 sets
    const userASets = getUserSets(userA.id);
    expect(userASets.length).toBe(1);
    expect(userASets[0].weight).toBe(135);
    expect(userASets[0].reps).toBe(5);

    expect(getUserSets(userB.id).length).toBe(0);
  });
});
