import { test, expect } from '@playwright/test';

test.describe('Workout Flow E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
  });

  test('loads workout engine with sticky rest timer and exercise routines', async ({ page }) => {
    // Assert routine button and date input
    await expect(page.locator('[data-testid="routine-select-btn"]')).toBeVisible();

    // Verify date input is present and enforces native dark color-scheme
    const dateInput = page.locator('[data-testid="workout-date-input"]');
    await expect(dateInput).toBeVisible();
    const colorScheme = await dateInput.evaluate((el) => window.getComputedStyle(el).colorScheme);
    expect(colorScheme).toBe('dark');

    // Verify rest timer launcher button exists
    const timerBtn = page.locator('[data-testid="rest-timer-btn"]');
    await expect(timerBtn).toBeVisible();
  });

  test('allows toggling rest timer presets and controls', async ({ page }) => {
    // Click rest timer button to launch timer
    const restTimerButton = page.locator('[data-testid="rest-timer-btn"]');
    await restTimerButton.click();

    // Verify floating bottom rest timer pill appears
    const timerPill = page.locator('[data-testid="rest-timer-pill"]');
    await expect(timerPill).toBeVisible();

    const timerDisplay = page.locator('[data-testid="rest-timer-display"]');
    await expect(timerDisplay).toBeVisible();

    // Test +90s button
    const add90Btn = timerPill.locator('button:has-text("+90s")');
    await expect(add90Btn).toBeVisible();
    await add90Btn.click();

    // Test stop timer button
    const stopBtn = timerPill.locator('button[title="Stop timer"]');
    await expect(stopBtn).toBeVisible();
    await stopBtn.click();
    await expect(timerPill).not.toBeVisible();
  });

  test('interacts with workout sets, draft inputs, and commit action', async ({ page }) => {
    // If on Rest Day, click Choose Routine to select Workout A so exercise set cards appear
    const chooseRoutineBtn = page.locator('button:has-text("Choose Routine")');
    if (await chooseRoutineBtn.isVisible()) {
      await chooseRoutineBtn.click();
      await page.click('button:has-text("Workout A (Push, Quads & Core)")');
      await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
    }

    const commitBtn = page.locator('button[title*="Commit Set"]').first();
    const deleteBtn = page.locator('button[title*="Delete set"]').first();

    if (await commitBtn.isVisible()) {
      const weightInput = page.locator('input[inputmode="decimal"]').first();
      const repsInput = page.locator('input[inputmode="numeric"]').first();
      if (await weightInput.isVisible() && (await repsInput.isVisible())) {
        await weightInput.fill('135');
        await repsInput.fill('10');
        await commitBtn.click();
        await expect(page.locator('[data-testid="rest-timer-pill"]')).toBeVisible();
      }
    } else if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await expect(page.locator('button[title*="Commit Set"]').first()).toBeVisible();
    }

    // Verify navigating to History view
    await page.goto('/history');
    await expect(page.locator('text=Workout History')).toBeVisible();
  });

  test('renders real historical workout set benchmarks (ghost sets) and history session data', async ({ page }) => {
    // Assert no query error banner is displayed
    await expect(page.locator('[data-testid="workout-logs-error"]')).not.toBeVisible();

    // Wait for routine controls to render
    const routineSelectBtn = page.locator('[data-testid="routine-select-btn"]');
    const chooseRoutineBtn = page.locator('button:has-text("Choose Routine")');
    await expect(page.locator('[data-testid="routine-select-btn"], button:has-text("Choose Routine")').first()).toBeVisible();

    if (await chooseRoutineBtn.isVisible()) {
      await chooseRoutineBtn.click();
      await page.click('button:has-text("Workout A (Push, Quads & Core)")');
    } else {
      const routineText = await routineSelectBtn.textContent();
      if (!routineText?.includes('Workout A (Push, Quads & Core)')) {
        await routineSelectBtn.click();
        await page.click('button:has-text("Workout A (Push, Quads & Core)")');
      }
    }

    const firstCard = page.locator('[data-testid="exercise-card-0"]');
    await expect(firstCard).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-testid="workout-logs-error"]')).not.toBeVisible();

    // Assert that real historical data from the database is rendered as ghost benchmarks
    const ghostWeightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    await expect(ghostWeightInput).toBeVisible();
    await expect(ghostWeightInput).toHaveAttribute('placeholder', '185');
    await expect(firstCard.getByText('185 lbs × 8').first()).toBeVisible();

    // Assert historical session renders in History view
    await page.goto('/history');
    await expect(page.locator('text=Workout History')).toBeVisible();
    await expect(page.locator('text=Push Day Benchmark').first()).toBeVisible();
    await expect(page.locator('text=185 lbs').first()).toBeVisible();
  });

  test('negative control: displays error banner and retry affordance if workout queries fail', async ({ page }) => {
    // Intercept workouts queries with 400 Bad Request simulating P0 phantom column error
    await page.route('**/rest/v1/workouts*', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'column sets_1.weight_lbs does not exist', code: '42703' }),
      })
    );

    await page.goto('/workout');
    await expect(page.locator('[data-testid="workout-logs-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="retry-logs-btn"]')).toBeVisible();
  });
});



