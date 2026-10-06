import { test, expect } from '@playwright/test';

const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;

if (!smokeEmail || !smokePassword) {
  throw new Error(
    'Missing required smoke test credentials: SMOKE_EMAIL and SMOKE_PASSWORD must be set.'
  );
}

test.describe('Production Smoke Suite', () => {
  test('end-to-end smoke verification', async ({ page }) => {
    // -------------------------------------------------------------------------
    // Step 1: Load the app and see the sign-in screen or the app shell
    // -------------------------------------------------------------------------
    await page.goto('/');

    // Check for either the sign-in screen or the already-authenticated app shell
    const emailInput = page.locator('input[type="email"]');
    const workoutEngine = page.locator('[data-testid="workout-engine"]');
    const routineSelectBtn = page.locator('[data-testid="routine-select-btn"]');
    const chooseRoutineBtn = page.locator('button:has-text("Choose Routine")');

    await expect(
      emailInput.or(workoutEngine).or(routineSelectBtn).or(chooseRoutineBtn).first()
    ).toBeVisible({ timeout: 20000 });

    // -------------------------------------------------------------------------
    // Step 2: Sign in with SMOKE_EMAIL / SMOKE_PASSWORD through the real UI
    // -------------------------------------------------------------------------
    if (await emailInput.isVisible()) {
      await emailInput.fill(smokeEmail);
      const passwordInput = page.locator('input[type="password"]');
      await passwordInput.fill(smokePassword);
      const submitBtn = page.locator('button[type="submit"]');
      await submitBtn.click();
      await page.waitForURL('**/workout', { timeout: 20000 });
    }

    await page.waitForLoadState('networkidle');

    // -------------------------------------------------------------------------
    // Step 3: Log one workout set with a unique marker, verify, delete, verify gone
    // -------------------------------------------------------------------------
    // Ensure an active routine is loaded so exercise cards render
    const routineBtn = page.locator('[data-testid="routine-select-btn"]');
    const chooseBtn = page.locator('button:has-text("Choose Routine")');
    await expect(routineBtn.or(chooseBtn).first()).toBeVisible({ timeout: 15000 });

    if (await chooseBtn.isVisible()) {
      await chooseBtn.click();
      await page.click('button:has-text("Workout A (Push, Quads & Core)")');
    } else {
      const routineName = await routineBtn.textContent();
      if (!routineName?.includes('Workout A')) {
        await routineBtn.click();
        await page.click('button:has-text("Workout A (Push, Quads & Core)")');
      }
    }

    const card = page.locator('[data-testid="exercise-card-0"]');
    await expect(card).toBeVisible({ timeout: 15000 });

    // Distinctive weight marker using high unique value
    const uniqueMarkerWeight = '239';
    const markerReps = '11';

    const ghostWeight = card.locator('[data-testid^="ghost-weight-0-"]').first();
    const ghostReps = card.locator('[data-testid^="ghost-reps-0-"]').first();
    const commitBtn = card.locator('[data-testid^="commit-set-btn-0-"]').first();

    await expect(ghostWeight).toBeVisible({ timeout: 5000 });
    await ghostWeight.fill(uniqueMarkerWeight);
    await ghostReps.fill(markerReps);
    await commitBtn.click();

    // Verify the logged set appears
    const loggedRow = card
      .locator('[data-testid^="logged-set-row-0-"]')
      .filter({ hasText: uniqueMarkerWeight })
      .first();
    await expect(loggedRow).toBeVisible({ timeout: 10000 });

    // Delete the logged set through the UI
    await loggedRow.click();
    const editSheet = page.locator('[data-testid="edit-set-sheet"]');
    await expect(editSheet).toBeVisible({ timeout: 5000 });

    const deleteBtn = editSheet.locator('[data-testid="delete-set-btn"]');
    await deleteBtn.click();
    await expect(editSheet).not.toBeVisible();

    // Confirm UndoToast indicates deletion
    const undoToast = page.locator('[data-testid="quick-log-toast"]');
    await expect(undoToast).toBeVisible({ timeout: 5000 });
    await expect(undoToast).toContainText('Set deleted');

    // Verify the logged set row is gone
    await expect(loggedRow).toHaveCount(0, { timeout: 15000 });

    // Wait for the undo toast countdown/expiry to dispatch the background DELETE
    await expect(undoToast).not.toBeVisible({ timeout: 10000 });

    // Reload and confirm the set stays gone, i.e. the delete persisted.
    await page.reload();
    await expect(card).toBeVisible({ timeout: 15000 });
    await expect(loggedRow).toHaveCount(0, { timeout: 15000 });

    // -------------------------------------------------------------------------
    // Step 4: One AI nutrition parse through the UI, assert parsed result, WITHOUT saving
    // -------------------------------------------------------------------------
    await page.goto('/nutrition');
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await expect(nlTextarea).toBeVisible({ timeout: 15000 });

    await nlTextarea.fill('1 medium banana');
    const analyzeBtn = page.locator('button:has-text("Analyze Meal")');
    await expect(analyzeBtn).toBeVisible({ timeout: 5000 });
    await analyzeBtn.click();

    // Staged meal card appears with parsed results
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 25000 });

    // Assert parsed meal contents appear (WITHOUT clicking Log Meal)
    await expect(
      stagedCard.getByText(/banana/i).first()
    ).toBeVisible({ timeout: 10000 });

    // Explicit invariant: Do NOT click 'Log Meal' or save the staged meal
    const logMealBtn = stagedCard.locator('button:has-text("Log Meal")');
    await expect(logMealBtn).toBeVisible();
  });
});
