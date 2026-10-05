import { test, expect } from '@playwright/test';

test.describe('Coach-Athlete Code Linking & Lifecycle E2E', () => {
  test('complete lifecycle: link, macro target update, and disconnect', async ({ page }) => {
    // Handle confirm dialogs globally
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // 1. Athlete logs in
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 2. Navigate to Settings
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // 3. Handle initial connection state: wait for either linked state or unlinked input
    await page.waitForSelector('[data-testid="coach-link-loading"]', { state: 'detached' }).catch(() => {});
    const disconnectBtn = page.locator('[data-testid="disconnect-coach-btn"]');
    const codeInput = page.locator('[data-testid="link-coach-code-input"]');
    await expect(disconnectBtn.or(codeInput)).toBeVisible();

    if (await disconnectBtn.isVisible()) {
      await disconnectBtn.click();
      const confirmBtn = page.locator('[data-testid="disconnect-coach-confirm-dialog-confirm"]');
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();
      await expect(codeInput).toBeVisible();
    }

    // 4. Link to Demo Coach using code YB-DEMO01
    await expect(codeInput).toBeVisible();
    await codeInput.fill('YB-DEMO01');

    const linkBtn = page.locator('[data-testid="link-coach-btn"]');
    await expect(linkBtn).toBeEnabled();
    await linkBtn.click({ force: true });

    // Verify link confirmation & assigned coach display
    await expect(page.locator('[data-testid="link-coach-status"]')).toContainText('Successfully linked to coach!');
    await expect(disconnectBtn).toBeVisible();
    await expect(page.locator('text=YB-DEMO01')).toBeVisible();

    // 5. Athlete signs out
    const signOutBtn = page.locator('button[title="Sign Out"]');
    await signOutBtn.click();
    await page.waitForURL('**/login');

    // 6. Coach logs in
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');

    // 7. Verify coach cockpit & athlete roster
    await expect(page.locator('text=Coach Dashboard')).toBeVisible();
    await expect(page.locator('text=Alex Athlete').first()).toBeVisible();

    // Switch to macros tab if on mobile viewport
    const macrosTab = page.locator('[data-testid="coach-tab-macros"]');
    if (await macrosTab.isVisible()) {
      await macrosTab.click();
    }

    // 8. Coach updates athlete's macro targets
    const calInput = page.locator('[data-testid="athlete-macro-cal"]');
    await expect(calInput).toBeVisible();
    await calInput.clear();
    await calInput.fill('2550');

    const proInput = page.locator('[data-testid="athlete-macro-pro"]');
    await proInput.clear();
    await proInput.fill('185');

    const carbInput = page.locator('[data-testid="athlete-macro-carb"]');
    await carbInput.clear();
    await carbInput.fill('245');

    const fatInput = page.locator('[data-testid="athlete-macro-fat"]');
    await fatInput.clear();
    await fatInput.fill('75');

    const fiberInput = page.locator('[data-testid="athlete-macro-fiber"]');
    await fiberInput.clear();
    await fiberInput.fill('32');

    const updateMacrosBtn = page.locator('[data-testid="update-athlete-macros-btn"]');
    await updateMacrosBtn.click();

    await expect(page.locator('[data-testid="athlete-macro-status"]')).toContainText('Athlete nutrition targets updated!');

    // 9. Coach signs out
    await page.locator('button[title="Sign Out"]').click();
    await page.waitForURL('**/login');

    // 10. Athlete logs back in
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');

    // 11. Athlete verifies updated targets in Settings
    await page.goto('/settings');
    await expect(page.locator('text=Daily Macro Goals')).toBeVisible();

    // Calories input should now reflect 2550
    const athleteCalInput = page.locator('input[type="number"]').first();
    await expect(athleteCalInput).toHaveValue('2550');

    // 12. Athlete disconnects from coach
    const finalDisconnectBtn = page.locator('[data-testid="disconnect-coach-btn"]');
    await expect(finalDisconnectBtn).toBeVisible();
    await finalDisconnectBtn.click();
    const confirmBtn = page.locator('[data-testid="disconnect-coach-confirm-dialog-confirm"]');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(page.locator('[data-testid="link-coach-status"]')).toContainText('Successfully disconnected from coach.');
    await expect(page.locator('[data-testid="link-coach-code-input"]')).toBeVisible();

    // 13. Re-link at the end to leave DB in seeded state for other test suites
    await codeInput.fill('YB-DEMO01');
    await expect(linkBtn).toBeEnabled();
    await linkBtn.click({ force: true });
    await expect(page.locator('[data-testid="link-coach-status"]')).toContainText('Successfully linked to coach!');
  });
});
