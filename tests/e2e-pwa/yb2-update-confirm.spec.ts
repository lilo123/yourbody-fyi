import * as fs from 'fs';
import * as path from 'path';
import { test, expect, type Page } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOfflineAndNotify,
  goOnline,
  countRows,
  type PwaTestUser,
} from './fixtures';

test.describe('YB2 Update Gate Confirmation Dialog Flow (D-YB2-3)', () => {
  let user: PwaTestUser;
  const swPath = path.resolve('dist/sw.js');
  let originalSwContent = '';

  test.beforeAll(() => {
    if (fs.existsSync(swPath)) {
      originalSwContent = fs.readFileSync(swPath, 'utf8');
    }
  });

  test.beforeEach(async () => {
    user = await createPwaTestUser('pwa-yb2-upd');
  });

  test.afterEach(async () => {
    if (originalSwContent && fs.existsSync(swPath)) {
      fs.writeFileSync(swPath, originalSwContent);
    }
    if (user) {
      cleanupPwaTestUser(user);
    }
  });

  async function triggerSwUpdate(page: Page): Promise<void> {
    const updatedSwContent =
      (originalSwContent || fs.readFileSync(swPath, 'utf8')) +
      `\n/* pwa-yb2-update-${Date.now()}-${Math.random()} */`;

    await page.route('**/sw.js*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: updatedSwContent,
      });
    });

    if (fs.existsSync(swPath)) {
      fs.writeFileSync(swPath, updatedSwContent);
    }

    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });

    const banner = page.locator('[data-testid="update-banner"]');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('Update available · Reload');
  }

  test('Row 1: signed-out /login with another users stale pointer applies reload immediately', async ({
    page,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    // Navigate to /login (signed out simulation) and leave a stale pointer belonging to another user
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const staleUid = 'stale-user-999';
      const today = '2026-10-02';
      localStorage.setItem(`yourbody_current_session_pointer_${staleUid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${staleUid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'stale-sess',
          userId: staleUid,
          workoutDate: today,
          routineName: 'Stale Routine',
          exercises: [],
          targetSetCounts: {},
          targetRepCounts: {},
          expandedExercises: [],
          inputDrafts: { 'Bench_0': { weight: '225', reps: '5' } },
          startedAt: new Date().toISOString(),
          lastModifiedAt: new Date().toISOString(),
          completedAt: null,
        })
      );
    });

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    const dialog = page.locator('[data-testid="update-confirm-dialog"]');

    const reloadPromise = page.waitForNavigation({ waitUntil: 'load' });
    await reloadBtn.click();
    await reloadPromise;

    // Reload applied immediately: no dialog opened, and new SW is controlling
    await expect(dialog).toBeHidden();
    const isControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(isControlled).toBe(true);
  });

  test('Row 2: ghost-only session applies reload immediately without dialog', async ({
    page,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    // Initialize ghost-only session (no drafts, completedAt null)
    await page.evaluate((uid) => {
      const now = new Date();
      const today = '2026-10-02';
      localStorage.setItem(`yourbody_current_session_pointer_${uid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${uid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'ghost-only-sess',
          userId: uid,
          workoutDate: today,
          routineName: 'Ghost Routine',
          exercises: ['Bench Press'],
          targetSetCounts: { 'Bench Press': 3 },
          targetRepCounts: { 'Bench Press': 10 },
          expandedExercises: ['Bench Press'],
          inputDrafts: {},
          startedAt: now.toISOString(),
          lastModifiedAt: now.toISOString(),
          completedAt: null,
        })
      );
    }, user.id);

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    const dialog = page.locator('[data-testid="update-confirm-dialog"]');

    const reloadPromise = page.waitForNavigation({ waitUntil: 'load' });
    await reloadBtn.click();
    await reloadPromise;

    // Reload applied immediately without confirm dialog
    await expect(dialog).toBeHidden();
    const isControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(isControlled).toBe(true);
  });

  test('Row 3: typed draft opens dialog, Keep logging keeps banner and draft', async ({
    page,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.evaluate((uid) => {
      const now = new Date();
      const today = '2026-10-02';
      localStorage.setItem(`yourbody_current_session_pointer_${uid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${uid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'draft-sess',
          userId: uid,
          workoutDate: today,
          routineName: 'Chest Routine',
          exercises: ['Bench Press'],
          targetSetCounts: { 'Bench Press': 3 },
          targetRepCounts: { 'Bench Press': 10 },
          expandedExercises: ['Bench Press'],
          inputDrafts: { 'Bench Press_0': { weight: '155', reps: '8' } },
          startedAt: now.toISOString(),
          lastModifiedAt: now.toISOString(),
          completedAt: null,
        })
      );
    }, user.id);

    let navigations = 0;
    page.on('load', () => {
      navigations++;
    });

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    await reloadBtn.click();

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Update now?');
    await expect(dialog).toContainText(
      'Your open workout and the values you typed will still be here after the update.'
    );

    // Tap "Keep logging"
    const cancelBtn = page.locator('[data-testid="update-confirm-dialog-cancel"]');
    await cancelBtn.click();

    await expect(dialog).toBeHidden();
    const banner = page.locator('[data-testid="update-banner"]');
    await expect(banner).toBeVisible();
    expect(navigations).toBe(0);

    // Draft is preserved
    const draftValue = await page.evaluate((uid) => {
      const today = '2026-10-02';
      const raw = localStorage.getItem(`yourbody_active_session_${uid}_${today}`);
      if (!raw) return null;
      return JSON.parse(raw)?.inputDrafts?.['Bench Press_0'];
    }, user.id);
    expect(draftValue).toEqual({ weight: '155', reps: '8' });
  });

  test('Row 4: Reload now gives new SW active AND typed draft value present after reload', async ({
    page,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.evaluate((uid) => {
      const now = new Date();
      const today = '2026-10-02';
      localStorage.setItem(`yourbody_current_session_pointer_${uid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${uid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'draft-reload-sess',
          userId: uid,
          workoutDate: today,
          routineName: 'Chest Routine',
          exercises: ['Bench Press'],
          targetSetCounts: { 'Bench Press': 3 },
          targetRepCounts: { 'Bench Press': 10 },
          expandedExercises: ['Bench Press'],
          inputDrafts: { 'Bench Press_0': { weight: '205', reps: '5' } },
          startedAt: now.toISOString(),
          lastModifiedAt: now.toISOString(),
          completedAt: null,
        })
      );
    }, user.id);

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    await reloadBtn.click();

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();

    const confirmBtn = page.locator('[data-testid="update-confirm-dialog-confirm"]');
    const reloadPromise = page.waitForNavigation({ waitUntil: 'load' });
    await confirmBtn.click();
    await reloadPromise;

    // After reload, new SW is controlling
    const isControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(isControlled).toBe(true);

    // Typed draft survives the reload
    const draftValue = await page.evaluate((uid) => {
      const today = '2026-10-02';
      const raw = localStorage.getItem(`yourbody_active_session_${uid}_${today}`);
      if (!raw) return null;
      return JSON.parse(raw)?.inputDrafts?.['Bench Press_0'];
    }, user.id);
    expect(draftValue).toEqual({ weight: '205', reps: '5' });
  });

  test('Row 5: pending outbox (offline) opens dialog, reload keeps pending op, then syncs exactly once after online', async ({
    page,
    context,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // Go offline
    await goOfflineAndNotify(context, page);

    // Commit 1 set while offline to create a pending outbox op
    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');
    await expect(commitBtn).toBeVisible({ timeout: 10000 });
    await weightInput.fill('135');
    await repsInput.fill('10');
    await commitBtn.click();

    // Verify pending mark
    const pendingMark = page.locator('[data-testid="logged-set-row-0-0"] [data-testid="pending-mark"]');
    await expect(pendingMark).toBeVisible({ timeout: 10000 });

    // Trigger SW update while offline
    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    await reloadBtn.click();

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('waiting to sync will sync after the update.');

    const confirmBtn = page.locator('[data-testid="update-confirm-dialog-confirm"]');
    const reloadPromise = page.waitForNavigation({ waitUntil: 'load' });
    await confirmBtn.click();
    await reloadPromise;

    // After reload, pending mark is still present
    await expect(page.locator('[data-testid="logged-set-row-0-0"] [data-testid="pending-mark"]')).toBeVisible({
      timeout: 10000,
    });

    // Go back online and verify syncs exactly once
    await goOnline(context, page);
    await expect(page.locator('[data-testid="pending-mark"]')).toHaveCount(0, { timeout: 15000 });

    const totalSets = countRows(
      'public.sets',
      `exercise_id = '${user.exerciseId}' AND workout_id IN (SELECT id FROM public.workouts WHERE user_id = '${user.id}')`
    );
    expect(totalSets).toBe(1);
  });

  test('Row 6: replay in flight disables Reload then re-enables automatically', async ({
    page,
    context,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/workout');
    await page.waitForLoadState('networkidle');

    // Go offline
    await goOfflineAndNotify(context, page);

    // Commit 1 set while offline to create a pending outbox op
    const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
    const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
    const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');
    await expect(commitBtn).toBeVisible({ timeout: 10000 });
    await weightInput.fill('135');
    await repsInput.fill('10');
    await commitBtn.click();

    // Verify pending mark
    const pendingMark = page.locator('[data-testid="logged-set-row-0-0"] [data-testid="pending-mark"]');
    await expect(pendingMark).toBeVisible({ timeout: 10000 });

    // Set up route interceptor to hold Supabase REST replay requests
    let resolveReplay: (() => void) | null = null;
    const replayHoldPromise = new Promise<void>((resolve) => {
      resolveReplay = resolve;
    });

    await page.route('**/rest/v1/**', async (route) => {
      const method = route.request().method();
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        await replayHoldPromise;
      }
      await route.continue();
    });

    try {
      // Trigger SW update
      await triggerSwUpdate(page);

      const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
      const reason = page.locator('[data-testid="update-block-reason"]');

      // Restore online network state to trigger outbox replay
      await goOnline(context, page);

      // During replay in flight, reload button must be disabled with status text
      await expect(reloadBtn).toBeDisabled({ timeout: 10000 });
      await expect(reason).toBeVisible({ timeout: 10000 });
      await expect(reason).toContainText('Syncing changes in progress');

      // Release replay
      if (resolveReplay) {
        resolveReplay();
        resolveReplay = null;
      }

      // Replay completes, reload button re-enables automatically and reason hides
      await expect(reloadBtn).toBeEnabled({ timeout: 15000 });
      await expect(reason).toBeHidden({ timeout: 15000 });
      await expect(page.locator('[data-testid="pending-mark"]')).toHaveCount(0, { timeout: 15000 });
    } finally {
      if (resolveReplay) {
        resolveReplay();
      }
      await page.unroute('**/rest/v1/**');
    }
  });

  test('Row 7: dirty meal form dialog names the meal loss', async ({
    page,
  }) => {
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await page.waitForLoadState('networkidle');

    // Click Manual Entry to open manual meal form
    const manualBtn = page.getByRole('button', { name: /Manual Entry/i });
    await expect(manualBtn).toBeVisible({ timeout: 10000 });
    await manualBtn.click();

    // Type in the dish name to trigger markFormDirty('manual-meal-form', true)
    const dishInput = page.locator('[data-testid="dish-name-input"]');
    await expect(dishInput).toBeVisible({ timeout: 10000 });
    await dishInput.fill('Protein Oatmeal');

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    await reloadBtn.click();

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The meal you're editing will be lost.");

    const cancelBtn = page.locator('[data-testid="update-confirm-dialog-cancel"]');
    await cancelBtn.click();
    await expect(dialog).toBeHidden();
  });

  test('Row 8: 320px dialog fits viewport, buttons >=44px, no overflow, and screenshot captured', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });

    await signInUser(page, user);
    await waitForSwControl(page);

    // Setup active session with drafts to trigger dialog
    await page.evaluate((uid) => {
      const now = new Date();
      const today = '2026-10-02';
      localStorage.setItem(`yourbody_current_session_pointer_${uid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${uid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: '320px-dialog-sess',
          userId: uid,
          workoutDate: today,
          routineName: 'Chest Routine',
          exercises: ['Bench Press'],
          targetSetCounts: { 'Bench Press': 3 },
          targetRepCounts: { 'Bench Press': 10 },
          expandedExercises: ['Bench Press'],
          inputDrafts: { 'Bench Press_0': { weight: '135', reps: '10' } },
          startedAt: now.toISOString(),
          lastModifiedAt: now.toISOString(),
          completedAt: null,
        })
      );
    }, user.id);

    await triggerSwUpdate(page);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    await reloadBtn.click();

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();

    // Capture screenshot of dialog at 320px
    const shotPath = test.info().outputPath('upd_dialog_320.png');
    await page.screenshot({ path: shotPath });
    expect(fs.existsSync(shotPath)).toBe(true);

    // Density assertions:
    // (a) Dialog fits within 320px viewport without horizontal overflow
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox, 'Dialog bounding box exists').not.toBeNull();
    expect(dialogBox!.width, 'dialog width fits within 320px').toBeLessThanOrEqual(320);
    expect(dialogBox!.x, 'dialog left edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width, 'dialog right edge inside viewport').toBeLessThanOrEqual(320);

    const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow, 'Confirm dialog must not horizontally overflow at 320px').toBe(false);

    // (b) Buttons >= 44px tap target
    const cancelBtn = page.locator('[data-testid="update-confirm-dialog-cancel"]');
    const confirmBtn = page.locator('[data-testid="update-confirm-dialog-confirm"]');

    const cancelBox = await cancelBtn.boundingBox();
    expect(cancelBox, 'Cancel button bounding box exists').not.toBeNull();
    expect(cancelBox!.height, `Cancel button height (${cancelBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);
    expect(cancelBox!.width, `Cancel button width (${cancelBox!.width}px) >= 44px`).toBeGreaterThanOrEqual(44);

    const confirmBox = await confirmBtn.boundingBox();
    expect(confirmBox, 'Confirm button bounding box exists').not.toBeNull();
    expect(confirmBox!.height, `Confirm button height (${confirmBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);
    expect(confirmBox!.width, `Confirm button width (${confirmBox!.width}px) >= 44px`).toBeGreaterThanOrEqual(44);
  });
});
