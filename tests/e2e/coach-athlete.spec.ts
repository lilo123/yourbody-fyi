import { test, expect } from '@playwright/test';

test.describe('Coach-Athlete Multi-Tenant Flow E2E', () => {
  test('coach logs in and accesses coach cockpit', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');

    // Assert coach cockpit elements
    await expect(page.locator('text=Coach Dashboard')).toBeVisible();
    await expect(page.locator('text=Active Athlete')).toBeVisible();

    // Verify athlete switcher select
    const athleteSelect = page.locator('select').first();
    await expect(athleteSelect).toBeVisible();
    const optionsCount = await athleteSelect.locator('option').count();
    expect(optionsCount).toBeGreaterThan(0);
  });

  test('coach builds and saves a workout routine template', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'coach@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/coach');
    await expect(page.locator('text=Coach Dashboard')).toBeVisible();

    // Switch to templates tab if on mobile viewport
    const templatesTab = page.locator('[data-testid="coach-tab-templates"]');
    if (await templatesTab.isVisible()) {
      await templatesTab.click();
    }

    // Open EditTemplateSheet via + New Template button
    const newTplBtn = page.locator('[data-testid="coach-open-new-template-sheet-btn"]');
    await expect(newTplBtn).toBeVisible();
    await newTplBtn.click();

    await expect(page.locator('[data-testid="edit-template-modal"]')).toBeVisible({ timeout: 10000 });

    // Enter template name
    const templateName = `Playwright Test Coach Routine ${Date.now()}`;
    const nameInput = page.locator('[data-testid="template-name-input"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(templateName);

    // Pick an exercise via ExercisePicker
    await page.locator('[data-testid="open-exercise-picker"]').click();
    await expect(page.locator('[data-testid="exercise-picker-sheet"]')).toBeVisible({ timeout: 10000 });

    const exerciseRows = page.locator('[data-testid^="exercise-row-"]');
    await expect(exerciseRows.first()).toBeVisible({ timeout: 10000 });
    await exerciseRows.first().click();

    await page.locator('[data-testid="picker-confirm-add-btn"]').click();
    await expect(page.locator('[data-testid="sets-input-0"]')).toBeVisible();

    // Click save in EditTemplateSheet
    const saveBtn = page.locator('[data-testid="save-template-btn"]');
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Assert modal closes and template appears in list
    await expect(page.locator('[data-testid="edit-template-modal"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${templateName}`).first()).toBeVisible({ timeout: 10000 });
  });
});
