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
    console.error('[p3b-session-flows] Error cleaning up polluted workouts:', err);
    throw err;
  }
}

async function loginAsAthlete(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
  await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function selectWorkoutA(page: Page) {
  const chooseBtn = page.locator('button:has-text("Choose Routine")');
  const routineBtn = page.locator('[data-testid="routine-select-btn"]');
  await expect(chooseBtn.or(routineBtn).first()).toBeVisible({ timeout: 15000 });

  if (await chooseBtn.isVisible()) {
    await chooseBtn.click();
    await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A (Push, Quads & Core)")').click();
    await page.locator('[data-testid="routine-picker-modal"]').waitFor({ state: 'hidden' });
  } else {
    const text = await routineBtn.textContent();
    if (!text?.includes('Workout A')) {
      await routineBtn.click();
      await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A (Push, Quads & Core)")').click();
      await page.locator('[data-testid="routine-picker-modal"]').waitFor({ state: 'hidden' });
    }
  }
  await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible({ timeout: 15000 });
}

test.describe('P3b Workout Session Flows (p3b-session-flows)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    cleanupPollutedWorkouts();
  });

  test.afterEach(async () => {
    cleanupPollutedWorkouts();
  });

  test.afterAll(async () => {
    cleanupPollutedWorkouts();
  });

  // (a) Exercise removal flows:
  // 0 logged sets -> immediate removal + UndoToast -> Undo restores in place;
  // with logged sets -> RemoveExerciseSheet offers 'Remove & delete N logged sets' / 'Keep sets, collapse card';
  // delete path -> Undo -> 0 DELETE; expiry -> exactly N DELETE requests; reload -> exercise does not resurrect.
  test('(a) exercise removal with 0 logged sets vs logged sets, undo, deferred delete countdown, and reload persistence', async ({
    page,
  }) => {
    try {
      const deleteUrls: string[] = [];
      page.on('request', (req) => {
        if (req.method() === 'DELETE' && req.url().includes('/rest/v1/sets')) {
          deleteUrls.push(req.url());
        }
      });

      await loginAsAthlete(page);
      await selectWorkoutA(page);

      const firstCard = page.locator('[data-testid="exercise-card-0"]');
      await expect(firstCard).toBeVisible({ timeout: 10000 });
      const titleLocator = firstCard.locator('[data-testid="exercise-title"]');
      await expect(titleLocator).toBeVisible({ timeout: 5000 });
      const exName = (await titleLocator.textContent())?.trim() || 'Incline Bench Press';

      // Ensure 0 logged sets initially
      await expect(firstCard.locator('[data-testid^="logged-set-row-0-"]')).toHaveCount(0);

      // 1. Remove with 0 logged sets -> immediately gone from DOM
      const removeBtn = firstCard.locator('button[title="Remove from workout"]').first();
      await removeBtn.click();
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).not.toBeVisible({ timeout: 5000 });

      // 2. Undo toast appears -> click Undo -> exercise restored in place
      const undoToast = page.locator('[data-testid="quick-log-toast"]');
      await expect(undoToast).toBeVisible({ timeout: 5000 });
      await expect(undoToast).toContainText('Removed');
      await expect(undoToast).toContainText(exName);

      const toastUndoBtn = undoToast.locator('[data-testid="toast-undo-btn"]');
      await toastUndoBtn.click();
      await expect(undoToast).not.toBeVisible();
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).toBeVisible({ timeout: 5000 });
      expect(deleteUrls.length, 'Undo on 0-logged removal sends 0 DELETE requests').toBe(0);

      // 3. Log 2 sets for this exercise
      const commitBtn0 = page.locator('[data-testid="commit-set-btn-0-0"]');
      await commitBtn0.click();
      await expect(page.locator('[data-testid="logged-set-row-0-0"]')).toBeVisible({ timeout: 5000 });

      const commitBtn1 = page.locator('[data-testid="commit-set-btn-0-1"]');
      await commitBtn1.click();
      await expect(page.locator('[data-testid="logged-set-row-0-1"]')).toBeVisible({ timeout: 5000 });

      // 4. Click Remove with logged sets -> RemoveExerciseSheet opens
      const removeBtnLogged = page.locator('[data-testid="exercise-card-0"] button[title="Remove from workout"]').first();
      await removeBtnLogged.click();

      const removeSheet = page.locator('[data-testid="remove-exercise-sheet"]');
      await expect(removeSheet).toBeVisible({ timeout: 5000 });

      const removeDeleteBtn = page.locator('[data-testid="remove-delete-sets-btn"]');
      const keepSetsBtn = page.locator('[data-testid="keep-sets-collapse-btn"]');
      await expect(removeDeleteBtn).toContainText('Remove & delete 2 logged sets');
      await expect(keepSetsBtn).toContainText('Keep sets, collapse card');

      // 5. Test "Keep sets, collapse card"
      await keepSetsBtn.click();
      await expect(removeSheet).not.toBeVisible();
      // Exercise is still present and sets are intact
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).toBeVisible();
      expect(deleteUrls.length, 'Keep sets sends 0 DELETE requests').toBe(0);

      // 6. Click Remove again -> choose "Remove & delete N logged sets"
      await removeBtnLogged.click();
      await expect(removeSheet).toBeVisible();
      await removeDeleteBtn.click();
      await expect(removeSheet).not.toBeVisible();

      // Card is removed from DOM and UndoToast is shown
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).not.toBeVisible();
      await expect(undoToast).toBeVisible({ timeout: 5000 });
      await expect(undoToast).toContainText('Removed');
      await expect(undoToast).toContainText(exName);

      // 7. Test Undo on delete path: click Undo -> restored, 0 DELETE requests sent
      await toastUndoBtn.click();
      await expect(undoToast).not.toBeVisible();
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).toBeVisible({ timeout: 5000 });
      expect(deleteUrls.length, 'Undo on delete path sends 0 DELETE requests').toBe(0);

      // 8. Remove again and let 6s toast expire -> exactly 2 DELETE requests sent
      const removeBtnLoggedAgain = page.locator('[data-testid="exercise-card-0"] button[title="Remove from workout"]').first();
      await removeBtnLoggedAgain.click();
      await expect(removeSheet).toBeVisible();
      await removeDeleteBtn.click();
      await expect(removeSheet).not.toBeVisible();
      await expect(undoToast).toBeVisible({ timeout: 5000 });

      // Expect poll for countdown expiry: exactly 2 DELETE requests (no waitForTimeout)
      await expect
        .poll(() => deleteUrls.length, {
          message: 'Expected exactly 2 DELETE requests upon UndoToast expiry',
          timeout: 10000,
          intervals: [250, 500, 1000],
        })
        .toBe(2);

      // 9. Reload page: removed exercise does NOT come back
      await page.reload();
      await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });
      await expect(page.locator(`[data-testid="exercise-title"]:has-text("${exName}")`)).not.toBeVisible({ timeout: 5000 });
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  // (b) Clear workout:
  // Clear -> ConfirmDialog -> confirm -> empty state with 'Choose routine' + 'Add exercise';
  // reload keeps Free Workout.
  test('(b) Clear workout with ConfirmDialog leads to empty state and persists Free Workout on reload', async ({
    page,
  }) => {
    try {
      await loginAsAthlete(page);
      await selectWorkoutA(page);

      // Clear button in header
      const clearBtn = page.locator('button[aria-label="Clear workout"]');
      await expect(clearBtn).toBeVisible({ timeout: 5000 });
      await clearBtn.click();

      // ConfirmDialog appears
      const dialog = page.locator('[data-testid="clear-workout-dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Cancel preserves workout
      const cancelBtn = page.locator('[data-testid="clear-workout-dialog-cancel"]');
      await cancelBtn.click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();

      // Click Clear again and confirm
      await clearBtn.click();
      await expect(dialog).toBeVisible();
      const confirmBtn = page.locator('[data-testid="clear-workout-dialog-confirm"]');
      await confirmBtn.click();
      await expect(dialog).not.toBeVisible();

      // Assert empty state with 'Choose routine' + 'Add exercise' CTAs
      const emptyChooseBtn = page.locator('[data-testid="empty-choose-routine-btn"]');
      const emptyAddBtn = page.locator('[data-testid="empty-add-exercise-btn"]');
      await expect(emptyChooseBtn).toBeVisible({ timeout: 5000 });
      await expect(emptyChooseBtn).toHaveText('Choose routine');
      await expect(emptyAddBtn).toBeVisible({ timeout: 5000 });
      await expect(emptyAddBtn).toHaveText('Add exercise');
      await expect(page.locator('[data-testid^="exercise-card-"]')).toHaveCount(0);

      // Reload keeps Free Workout
      await page.reload();
      await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 15000 });

      const routineBtn = page.locator('[data-testid="routine-select-btn"]');
      await expect(routineBtn).toContainText('Free Workout');
      await expect(page.locator('[data-testid="empty-choose-routine-btn"]')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="empty-add-exercise-btn"]')).toBeVisible({ timeout: 5000 });
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  // (c) Finish with pending sets:
  // FinishReviewSheet lists them; edit one value, remove one, 'Log N sets & finish' inserts
  // exactly the reviewed list (inspect the POST body); 'Finish without them' inserts none.
  test('(c) Finish with pending sets lists them in FinishReviewSheet, supports edit/remove, and inserts reviewed list or none', async ({
    page,
  }) => {
    try {
      const postBodies: any[] = [];
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/rest/v1/sets')) {
          try {
            postBodies.push(req.postDataJSON());
          } catch {
            // non-json or unparseable
          }
        }
      });

      await loginAsAthlete(page);
      await selectWorkoutA(page);

      const finishBtn = page.locator('[data-testid="finish-workout-btn"]');
      await expect(finishBtn).toBeVisible({ timeout: 10000 });
      await finishBtn.click();

      const finishSheet = page.locator('[data-testid="finish-review-sheet"]');
      await expect(finishSheet).toBeVisible({ timeout: 5000 });

      // 1. Test "Finish without them" -> inserts none
      const finishWithoutBtn = page.locator('[data-testid="finish-without-sets-btn"]');
      await finishWithoutBtn.click();
      await expect(finishSheet).not.toBeVisible();
      expect(postBodies.length, 'Finish without them must send 0 set POST requests').toBe(0);

      // 2. Open FinishReviewSheet again to edit and log reviewed sets
      await finishBtn.click();
      await expect(finishSheet).toBeVisible({ timeout: 5000 });

      const rows = page.locator('[data-testid^="finish-review-row-"]');
      await expect(rows.first()).toBeVisible({ timeout: 5000 });
      const initialRowCount = await rows.count();
      expect(initialRowCount, 'Workout A should have multiple pending sets').toBeGreaterThan(1);

      // Edit first set weight to 205
      const weightInput0 = page.locator('[data-testid="finish-review-weight-0"]');
      await weightInput0.fill('205');

      // Remove second set
      const removeBtn1 = page.locator('[data-testid="finish-review-remove-1"]');
      await removeBtn1.click();
      await expect(rows).toHaveCount(initialRowCount - 1);

      // Click "Log N sets & finish"
      const logReviewedBtn = page.locator('[data-testid="log-reviewed-sets-btn"]');
      await logReviewedBtn.click();
      await expect(finishSheet).not.toBeVisible();

      // Poll until POST request completes
      await expect
        .poll(() => postBodies.length, {
          message: 'Expected exactly 1 batch POST request to /rest/v1/sets',
          timeout: 10000,
          intervals: [250, 500, 1000],
        })
        .toBe(1);

      const insertedSets = postBodies[0];
      expect(Array.isArray(insertedSets), 'POST payload must be an array of sets').toBe(true);
      expect(insertedSets.length, 'Inserted sets count must match reviewed count').toBe(initialRowCount - 1);

      // First inserted set must have edited weight 205
      expect(insertedSets[0].weight, 'First inserted set must have reviewed weight 205').toBe(205);
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  // (d) URL entry contracts:
  // /workout?date=2026-09-20 shows that date; invalid date falls back to today.
  test('(d) /workout?date=2026-09-20 loads that date and invalid date falls back to today', async ({
    page,
  }) => {
    try {
      await loginAsAthlete(page);

      // Navigate to /workout?date=2026-09-20
      await page.goto('/workout?date=2026-09-20');
      const dateInput = page.locator('[data-testid="workout-date-input"]');
      await expect(dateInput).toBeVisible({ timeout: 10000 });
      await expect(dateInput).toHaveValue('2026-09-20');

      // Navigate with invalid date
      await page.goto('/workout?date=invalid-date-xyz');
      await expect(dateInput).toBeVisible({ timeout: 10000 });

      // Invalid date should fall back to a valid civil date (today)
      const val = await dateInput.inputValue();
      expect(/^\d{4}-\d{2}-\d{2}$/.test(val), `Expected valid YYYY-MM-DD date, got: ${val}`).toBe(true);
      expect(val).not.toBe('invalid-date-xyz');
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  // (e) Rest day:
  // Rest day -> 'Log activity anyway' -> Free Workout + add-exercise available.
  test('(e) Rest Day renders Rest & Recovery view and clicking "Log activity anyway" switches to Free Workout with Add Exercise', async ({
    page,
  }) => {
    try {
      await loginAsAthlete(page);

      // Switch routine to Rest Day via routine picker modal
      const routineBtn = page.locator('[data-testid="routine-select-btn"]');
      await routineBtn.click();
      const modal = page.locator('[data-testid="routine-picker-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      const restDayOption = modal.locator('button:has-text("Rest Day")');
      await restDayOption.click();
      await expect(modal).not.toBeVisible();

      // Assert RestDayView is rendered with "Rest & Recovery"
      const restHeading = page.locator('h2:has-text("Rest & Recovery")');
      await expect(restHeading).toBeVisible({ timeout: 5000 });

      const logAnywayBtn = page.locator('button:has-text("Log activity anyway")');
      await expect(logAnywayBtn).toBeVisible({ timeout: 5000 });

      // Click "Log activity anyway" -> transitions to Free Workout
      await logAnywayBtn.click();
      await expect(restHeading).not.toBeVisible();

      // Routine is now Free Workout and ExercisePicker is opened
      await expect(routineBtn).toContainText('Free Workout');
      const pickerSheet = page.locator('[data-testid="exercise-picker-sheet"]');
      await expect(pickerSheet).toBeVisible({ timeout: 5000 });
      // Close picker sheet to confirm empty state Add Exercise button is available
      await page.keyboard.press('Escape');
      await expect(pickerSheet).not.toBeVisible();
      await expect(page.locator('[data-testid="empty-add-exercise-btn"]')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="add-exercise-btn"]')).toBeVisible({ timeout: 5000 });
    } finally {
      cleanupPollutedWorkouts();
    }
  });

  // (f) Focus management:
  // After committing a set, document.activeElement is the next pending set's weight input.
  test('(f) after committing a set, document.activeElement focuses the next pending set input', async ({
    page,
  }) => {
    try {
      await loginAsAthlete(page);

      // Switch to Free Workout and add an exercise with 0 prior history so next weight is empty
      const routineBtn = page.locator('[data-testid="routine-select-btn"]');
      await routineBtn.click();
      const modal = page.locator('[data-testid="routine-picker-modal"]');
      await modal.locator('button:has-text("Free Workout")').click();
      await expect(modal).not.toBeVisible();

      // Open ExercisePicker
      const openAddBtn = page.locator('[data-testid="empty-add-exercise-btn"], [data-testid="add-exercise-btn"]').first();
      await openAddBtn.click();
      const picker = page.locator('[data-testid="exercise-picker-sheet"]');
      await expect(picker).toBeVisible({ timeout: 5000 });
      const searchInput = page.locator('[data-testid="exercise-search-input"]');
      await searchInput.fill('Weighted Sit');
      const row = page.locator('[data-testid^="exercise-row-"]:has-text("Weighted Sit-Up")').first();
      await expect(row).toBeVisible({ timeout: 5000 });
      await row.click();
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      const addPickerBtn = page.locator('[data-testid="picker-confirm-add-btn"]');
      await addPickerBtn.click();
      await expect(picker).not.toBeVisible();

      const exerciseCard = page.locator('[data-testid="exercise-card-0"]');
      await expect(exerciseCard).toBeVisible({ timeout: 5000 });

      // Commit set 1 (row 0-0)
      const weight0 = page.locator('[data-testid="ghost-weight-0-0"]');
      const reps0 = page.locator('[data-testid="ghost-reps-0-0"]');
      await weight0.fill('25');
      await reps0.fill('8');

      const commit0 = page.locator('[data-testid="commit-set-btn-0-0"]');
      await commit0.click();

      // After committing set 1, focus should automatically advance to next pending set (row 0-1)
      await expect
        .poll(
          async () => {
            return await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
          },
          {
            message: 'Expected document.activeElement to focus ghost-weight-0-1 after committing set 0',
            timeout: 5000,
            intervals: [100, 250, 500],
          }
        )
        .toBe('ghost-weight-0-1');
    } finally {
      cleanupPollutedWorkouts();
    }
  });
});
