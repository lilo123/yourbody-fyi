import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  waitForOfflineDataReady,
  goOffline,
  goOnline,
  createCustomExercise,
  deleteExercise,
  countRows,
} from './fixtures';

test.describe('Needs Attention - Conflict & Permanent Error Handling', () => {
  let user: any;
  let customExerciseId: string;

  test.beforeEach(async () => {
    user = await createPwaTestUser('needs-attention-user');
    customExerciseId = createCustomExercise(user.id, 'Attention Test Press');
  });

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    let errEx: unknown;
    let errUser: unknown;
    try {
      if (customExerciseId) deleteExercise(customExerciseId);
    } catch (e) {
      errEx = e;
    }
    try {
      if (user) cleanupPwaTestUser(user);
    } catch (e) {
      errUser = e;
    }
    if (errEx) throw errEx;
    if (errUser) throw errUser;
  });

  test('deleted custom exercise triggers 23503 error, attention badge, retry failure, and discard with confirmation', async ({
    page,
    context,
  }) => {
    // 1. Sign in online and verify SW control
    await signInUser(page, user);
    await waitForSwControl(page);

    // 2. Pre-warm /workout while online so custom exercise is loaded in cache
    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // 3. Wait for offline prefetch data, then go offline
    await waitForOfflineDataReady(page, user.id);
    await goOffline(context, page);

    // 4. Switch to Free Workout via routine selector
    const routineBtn = page
      .locator('[data-testid="routine-select-btn"]')
      .or(page.locator('button:has-text("Choose Routine")'));
    await routineBtn.first().click();

    const freeWorkoutBtn = page.locator('button:has-text("Free Workout")');
    await expect(freeWorkoutBtn).toBeVisible({ timeout: 10000 });
    await freeWorkoutBtn.click();

    // 5. Add custom exercise from cached catalog via picker
    const addExerciseBtn = page.locator('[data-testid="add-exercise-btn"]');
    await expect(addExerciseBtn).toBeVisible({ timeout: 10000 });
    await addExerciseBtn.click();

    // Assert "Offline — showing saved catalog"
    const offlineCatalogBanner = page.locator('[data-testid="offline-catalog-banner"]');
    await expect(offlineCatalogBanner).toBeVisible({ timeout: 10000 });

    // Search for the custom exercise in picker
    const searchInput = page.locator('input[placeholder*="Search exercises"]');
    await searchInput.fill('Attention Test Press');

    const exerciseRow = page.locator(`[data-testid="exercise-row-${customExerciseId}"]`);
    await expect(exerciseRow).toBeVisible({ timeout: 10000 });
    await exerciseRow.click();

    const confirmAddBtn = page.locator('[data-testid="picker-confirm-add-btn"]');
    await expect(confirmAddBtn).toBeEnabled({ timeout: 10000 });
    await confirmAddBtn.click();

    // Exercise card is mounted in the workout
    const exerciseCard = page.locator('[data-testid^="exercise-card-"]').first();
    await expect(exerciseCard).toBeVisible({ timeout: 10000 });

    // 6. Log set offline
    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');

    await weightInput.fill('100');
    await repsInput.fill('8');
    await commitBtn.click();

    const loggedRow = page.locator('[data-testid="logged-set-row-0-0"]');
    await expect(loggedRow).toBeVisible({ timeout: 10000 });
    await expect(loggedRow.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 10000 });

    const connectionStatusBtn = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatusBtn).toContainText('Offline', { timeout: 10000 });

    // 7. Delete the custom exercise directly in Postgres while offline
    deleteExercise(customExerciseId);

    // 8. Reconnect online - flusher attempts sync, hits FK 23503 error, marks op as attention
    await goOnline(context, page);

    // 9. Connection badge updates to "1 need attention"
    await expect(connectionStatusBtn).toContainText('1 need attention', { timeout: 15000 });

    // 10. Click connection status badge to open SyncStatusSheet
    await connectionStatusBtn.click();
    const syncSheet = page.locator('[data-testid="sync-status-sheet"]');
    await expect(syncSheet).toBeVisible({ timeout: 10000 });

    // Verify "Needs attention" section is rendered
    const needsAttentionSection = page.locator('[data-testid="needs-attention-section"]');
    await expect(needsAttentionSection).toBeVisible({ timeout: 10000 });

    // 11. Test Retry button: retry fails again because exercise is still deleted
    const retryBtn = page.locator('[data-testid^="retry-op-btn-"]').first();
    await expect(retryBtn).toBeVisible({ timeout: 10000 });
    await retryBtn.click();

    // Still in needs attention after retry
    await expect(needsAttentionSection).toBeVisible({ timeout: 10000 });
    await expect(connectionStatusBtn).toContainText('1 need attention', { timeout: 10000 });

    // 12. Test Discard button: open confirmation dialog
    const discardBtn = page.locator('[data-testid^="discard-op-btn-"]').first();
    await expect(discardBtn).toBeVisible({ timeout: 10000 });
    await discardBtn.click();

    const confirmDialog = page.locator('[data-testid="discard-confirm-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 10000 });

    // 13. Confirm Discard
    const confirmDiscardBtn = confirmDialog.locator('button:has-text("Discard change")');
    await confirmDiscardBtn.click();

    // 14. Verify op is removed, needs attention clears, all changes synced
    await expect(needsAttentionSection).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=All changes synced')).toBeVisible({ timeout: 10000 });

    // 15. Close SyncStatusSheet and verify Header returns to Online
    const closeSheetBtn = page.locator('[data-testid="sync-status-sheet-close"]').or(page.locator('button[aria-label="Close Sync status"]'));
    await closeSheetBtn.first().click();
    await expect(syncSheet).not.toBeVisible({ timeout: 10000 });

    await expect(connectionStatusBtn).toContainText('Online', { timeout: 10000 });

    // 16. Verify Postgres state: 0 sets were saved for that exercise
    expect(countRows('sets', `exercise_id = '${customExerciseId}'`)).toBe(0);
  });
});
