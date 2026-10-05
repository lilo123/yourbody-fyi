import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  waitForOfflineDataReady,
  goOffline,
  goOnline,
  seedPriorWorkoutSession,
  getUserWorkouts,
  getUserSets,
  type PwaTestUser,
} from './fixtures';

test.describe('PWA Offline Workout Acceptance Specs', () => {
  let user: PwaTestUser;

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    if (user) {
      cleanupPwaTestUser(user);
    }
  });

  test('offline workout flow on pinned routine: log, edit, delete sets, PR update, history mark, and clean sync', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    user = await createPwaTestUser('offline-workout');

    // Seed prior session on fixed past date so PR chip & last session benchmarks exist
    seedPriorWorkoutSession(user, '2026-09-28', 100, 10);

    // 1. Sign in online & establish service worker control
    await signInUser(page, user);
    await waitForSwControl(page);

    // Warm history cache while online so offline navigation has base cache
    await page.goto('/history');
    await expect(page.getByRole('heading', { name: 'Workout History' })).toBeVisible();
    await page.goto('/workout');
    await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();

    // Verify initial prior session / PR chips loaded online
    const prChip = page.locator('[data-testid="pr-chip-0"]');
    await expect(prChip).toBeVisible();
    await expect(prChip).toContainText('100×10');

    const lastChip = page.locator('[data-testid="last-chip-0"]');
    await expect(lastChip).toBeVisible();
    await expect(lastChip).toContainText('100×10');

    // 2. Wait for offline prefetch data, then go offline
    await waitForOfflineDataReady(page, user.id);
    await goOffline(context, page);

    // Header connection status reflects offline state
    const connectionStatus = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();
    await expect(connectionStatus).toHaveText(/^Offline/);

    // 3. Log 3 sets offline
    // Set 1: 125 lb x 10 (exceeds prior PR 100 lb)
    const weightInput0 = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput0 = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn0 = page.locator('[data-testid="commit-set-btn-0-0"]');

    await weightInput0.fill('125');
    await repsInput0.fill('10');
    await commitBtn0.click();

    const loggedRow0 = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow0).toBeVisible();
    await expect(loggedRow0.locator('[data-testid="pending-mark"]')).toBeVisible();

    // Verify PR chip immediately reflects offline set (125 lb > 100 lb in 'weight' mode)
    await expect(prChip).toContainText('125×10');

    // Verify header status shows pending count
    await expect(connectionStatus).toHaveText(/Offline · \d+ pending/);

    // Set 2: 125 lb x 10
    const weightInput1 = page.locator('[data-testid="ghost-weight-0-1"]');
    const repsInput1 = page.locator('[data-testid="ghost-reps-0-1"]');
    const commitBtn1 = page.locator('[data-testid="commit-set-btn-0-1"]');

    await weightInput1.fill('125');
    await repsInput1.fill('10');
    await commitBtn1.click();

    const loggedRow1 = page.locator('[data-testid="logged-set-row-0-1"]');
    await expect(loggedRow1).toBeVisible();
    await expect(loggedRow1.locator('[data-testid="pending-mark"]')).toBeVisible();

    // Set 3: 125 lb x 10
    const weightInput2 = page.locator('[data-testid="ghost-weight-0-2"]');
    const repsInput2 = page.locator('[data-testid="ghost-reps-0-2"]');
    const commitBtn2 = page.locator('[data-testid="commit-set-btn-0-2"]');

    await weightInput2.fill('125');
    await repsInput2.fill('10');
    await commitBtn2.click();

    const loggedRow2 = page.locator('[data-testid="logged-set-row-0-2"]');
    await expect(loggedRow2).toBeVisible();
    await expect(loggedRow2.locator('[data-testid="pending-mark"]')).toBeVisible();

    // 4. Edit Set 1: change weight to 115 and set_type to 'warmup'
    await loggedRow0.click();
    const editSheet = page.locator('[data-testid="edit-set-sheet"]');
    await expect(editSheet).toBeVisible();

    await page.locator('[data-testid="edit-set-weight-input"]').fill('115');
    await page.locator('[data-testid="edit-set-type-select"]').selectOption('warmup');
    await page.locator('[data-testid="save-set-btn"]').click();
    await expect(editSheet).not.toBeVisible({ timeout: 15000 });

    // 5. Edit Set 2: add RPE 8.5
    await loggedRow1.click();
    await expect(editSheet).toBeVisible();
    await page.locator('[data-testid="edit-set-rpe-input"]').fill('8.5');
    await page.locator('[data-testid="save-set-btn"]').click();
    await expect(editSheet).not.toBeVisible({ timeout: 15000 });

    // 6. Delete Set 3
    await loggedRow2.click();
    await expect(editSheet).toBeVisible();
    await page.locator('[data-testid="delete-set-btn"]').click();
    await expect(editSheet).not.toBeVisible({ timeout: 15000 });

    // 7. Finish workout
    const finishBtn = page.locator('[data-testid="finish-workout-btn"]');
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();

    const finishWithoutBtn = page.locator('[data-testid="finish-without-sets-btn"]');
    await expect(finishWithoutBtn).toBeVisible();
    await finishWithoutBtn.click();

    // 8. Assert History tab shows the offline session with pending mark
    await page.locator('nav a[href="/history"]').click();
    await expect(page).toHaveURL(/.*\/history/);
    const historyPendingMark = page.locator('[data-testid="pending-mark"]').first();
    await expect(historyPendingMark).toBeVisible();

    // Return to /workout via client-side nav
    await page.locator('nav a[href="/workout"]').click();
    await expect(page).toHaveURL(/.*\/workout/);

    // 9. Reconnect online
    await goOnline(context);

    // Toast "Synced N changes" appears exactly once
    const syncToast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(syncToast).toBeVisible();

    // Pending marks disappear and header returns to clean Online state
    await expect(page.locator('[data-testid="pending-mark"]')).toHaveCount(0);
    await expect(connectionStatus).not.toHaveText(/pending/);
    await expect(connectionStatus).toContainText('Online');

    // 10. Database assertions via psql:
    // Exactly ONE workout row for this session (excluding prior seeded session)
    const workouts = getUserWorkouts(user.id, { excludeDates: ['2026-09-28'] });
    expect(workouts).toHaveLength(1);

    // Sets match final offline state exactly: 2 sets (set 3 deleted, excluding prior session)
    const sets = getUserSets(user.id, { excludeDates: ['2026-09-28'] });
    expect(sets).toHaveLength(2);

    // Set 1: 115 lb, 10 reps, set_type 'warmup'
    expect(Number(sets[0].weight)).toBe(115);
    expect(sets[0].reps).toBe(10);
    expect(sets[0].set_type).toBe('warmup');
    expect(sets[0].set_index).toBe(1);

    // Set 2: 125 lb, 10 reps, RPE 8.5
    expect(Number(sets[1].weight)).toBe(125);
    expect(sets[1].reps).toBe(10);
    expect(Number(sets[1].rpe)).toBe(8.5);
    expect(sets[1].set_index).toBe(2);
  });

  test('offline free workout: select Free Workout, pick cached exercise, log set, and sync', async ({
    page,
    context,
  }) => {
    user = await createPwaTestUser('offline-free');

    // 1. Sign in online & wait for SW and initial exercise load
    await signInUser(page, user);
    await waitForSwControl(page);
    await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();

    // 2. Wait for offline prefetch data, then go offline
    await waitForOfflineDataReady(page, user.id);
    await goOffline(context, page);

    // 3. Switch to Free Workout via routine selector
    const routineBtn = page
      .locator('[data-testid="routine-select-btn"]')
      .or(page.locator('button:has-text("Choose Routine")'));
    await routineBtn.first().click();

    const freeWorkoutBtn = page.locator('button:has-text("Free Workout")');
    await expect(freeWorkoutBtn).toBeVisible();
    await freeWorkoutBtn.click();

    // 4. Add existing exercise from cached catalog via picker
    const addExerciseBtn = page.locator('[data-testid="add-exercise-btn"]');
    await expect(addExerciseBtn).toBeVisible();
    await addExerciseBtn.click();

    // Assert "Offline — showing saved catalog"
    const offlineCatalogBanner = page.locator('[data-testid="offline-catalog-banner"]');
    await expect(offlineCatalogBanner).toBeVisible();
    await expect(offlineCatalogBanner).toContainText('Offline — showing saved catalog');

    // Pick an exercise from the saved catalog
    const exerciseRow = page.locator('[data-testid^="exercise-row-"]').first();
    await expect(exerciseRow).toBeVisible();
    await exerciseRow.click();

    const confirmAddBtn = page.locator('[data-testid="picker-confirm-add-btn"]');
    await expect(confirmAddBtn).toBeEnabled();
    await confirmAddBtn.click();

    // Exercise card is mounted in the workout
    const exerciseCard = page.locator('[data-testid^="exercise-card-"]').first();
    await expect(exerciseCard).toBeVisible();

    // 5. Log set offline
    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');

    await weightInput.fill('135');
    await repsInput.fill('8');
    await commitBtn.click();

    const loggedRow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow).toBeVisible();
    await expect(loggedRow.locator('[data-testid="pending-mark"]')).toBeVisible();

    // 6. Go online
    await goOnline(context);

    // Toast appears, pending marks disappear
    const toast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(toast).toBeVisible();
    await expect(page.locator('[data-testid="pending-mark"]')).toHaveCount(0);

    // 7. DB verification
    const workouts = getUserWorkouts(user.id);
    expect(workouts).toHaveLength(1);

    const sets = getUserSets(user.id);
    expect(sets).toHaveLength(1);
    expect(Number(sets[0].weight)).toBe(135);
    expect(sets[0].reps).toBe(8);
  });
});
