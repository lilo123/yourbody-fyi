import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOffline,
  goOnline,
  type PwaTestUser,
} from './fixtures';

test.describe('PWA Offline App Shell & Session Durability', () => {
  let user: PwaTestUser;

  test.beforeEach(async () => {
    user = await createPwaTestUser('pwa-shell');
  });

  test.afterEach(async ({ context }) => {
    // Ensure network is restored for subsequent tests
    await goOnline(context);
    if (user) {
      cleanupPwaTestUser(user);
    }
  });

  test('signed-in user loads /workout, SW controls page, offline reload, deep link, last-used route, and clock shift', async ({
    page,
    context,
  }) => {
    // 1. Initial login online
    await signInUser(page, user);
    await expect(page).toHaveURL(/.*\/workout/);

    // 2. Wait for Service Worker control
    await waitForSwControl(page);

    // Verify initial online shell elements
    const dateInput = page.locator('[data-testid="workout-date-input"]');
    await expect(dateInput).toBeVisible();
    await expect(page.locator('header')).toBeVisible();

    // 3. Emulate offline
    await goOffline(context);

    // 4. Reload /workout offline
    await page.reload();
    await expect(page).toHaveURL(/.*\/workout/);

    // Negative check: /login is NOT shown, user remains authenticated
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page).not.toHaveURL(/.*\/login/);

    // App shell & workout tab render offline from service worker cache
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('[data-testid="workout-date-input"]')).toBeVisible();

    // 5. Cold deep link /history offline renders
    await page.goto('/history');
    await expect(page).toHaveURL(/.*\/history/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.locator('header')).toBeVisible();

    // 6. Last-used route: visit /history, offline cold open '/' lands on /history
    await page.goto('/');
    await expect(page).toHaveURL(/.*\/history/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page).not.toHaveURL(/.*\/login/);

    // 7. Clock-shifted: move system time +7 days before offline reload (A8)
    await page.clock.setSystemTime(Date.now() + 7 * 86400 * 1000);
    await page.reload();

    // Still signed in: user session and cached data visible, not on /login
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page.locator('header')).toBeVisible();

    // Deep link back to /workout while still offline and clock-shifted
    await page.goto('/workout');
    await expect(page).toHaveURL(/.*\/workout/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="workout-date-input"]')).toBeVisible();
  });
});
