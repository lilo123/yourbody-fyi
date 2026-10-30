import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

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

function cleanupPollutedWorkouts() {
  const sql = `
    DELETE FROM public.sets
    WHERE workout_id IN (
      SELECT id FROM public.workouts
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND name <> 'Push Day Benchmark'
    );
    DELETE FROM public.workouts
    WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
      AND name <> 'Push Day Benchmark';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[workout-flow] Error cleaning up polluted workouts:', err);
    throw err;
  }
}

async function selectWorkoutA(page: Page) {
  const chooseBtn = page.locator('button:has-text("Choose Routine")');
  const routineBtn = page.locator('[data-testid="routine-select-btn"]');
  await expect(chooseBtn.or(routineBtn).first()).toBeVisible({ timeout: 15000 });

  let openedModal = false;
  if (await chooseBtn.isVisible()) {
    try {
      await chooseBtn.click({ timeout: 3000 });
      openedModal = true;
    } catch {
      // Element detached during catalog load race; fall back to routineBtn
    }
  }
  if (!openedModal) {
    const text = await routineBtn.textContent();
    if (!text?.includes('Workout A')) {
      await routineBtn.click();
      openedModal = true;
    }
  }
  if (openedModal) {
    await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A (Push, Quads & Core)")').click();
    await page.locator('[data-testid="routine-picker-modal"]').waitFor({ state: 'hidden' });
  }
  await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible({ timeout: 15000 });
}

test.describe('Workout Flow E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    cleanupPollutedWorkouts();
    await page.goto('/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(() => {
    cleanupPollutedWorkouts();
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
    await selectWorkoutA(page);

    const commitBtn = page.locator('button[title*="Commit Set"]').first();

    if (await commitBtn.isVisible()) {
      const weightInput = page.locator('input[inputmode="decimal"]').first();
      const repsInput = page.locator('input[inputmode="numeric"]').first();
      if (await weightInput.isVisible() && (await repsInput.isVisible())) {
        await weightInput.fill('135');
        await repsInput.fill('10');
        await commitBtn.click();
        await expect(page.locator('[data-testid="rest-timer-pill"]')).toBeVisible();

        // Unlog the set to restore pristine benchmark state
        const unlogBtn = page.locator('[data-testid^="unlog-set-btn-"]').first();
        if (await unlogBtn.isVisible()) {
          await unlogBtn.click();
          await expect(commitBtn).toBeVisible();
        }
      }
    }

    // Verify navigating to History view
    await page.goto('/history');
    await expect(page.locator('text=Workout History')).toBeVisible();
  });

  test('renders real historical workout set benchmarks (ghost sets) and history session data', async ({ page }) => {
    // Assert no query error banner is displayed
    await expect(page.locator('[data-testid="workout-logs-error"]')).not.toBeVisible();

    await selectWorkoutA(page);

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



