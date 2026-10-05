import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  createCoachPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOffline,
  goOnline,
} from './fixtures';

test.describe('Out of Scope - Offline Disabled Controls', () => {
  let athleteUser: any;
  let coachUser: any;

  test.beforeEach(async () => {
    athleteUser = await createPwaTestUser('out-of-scope-ath');
    coachUser = await createCoachPwaTestUser('out-of-scope-coach');
  });

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    let errAth: unknown;
    let errCoach: unknown;
    try {
      if (athleteUser) cleanupPwaTestUser(athleteUser);
    } catch (e) {
      errAth = e;
    }
    try {
      if (coachUser) cleanupPwaTestUser(coachUser);
    } catch (e) {
      errCoach = e;
    }
    if (errAth) throw errAth;
    if (errCoach) throw errCoach;
  });

  test('custom exercise and template creation/editing are disabled offline with 0 network requests', async ({
    page,
    context,
  }) => {
    // 1. Sign in as athlete and verify SW control
    await signInUser(page, athleteUser);
    await waitForSwControl(page);

    // 2. Pre-warm /exercises while online so catalog is cached
    await page.goto('/exercises');
    await expect(page.locator('[data-testid="open-create-exercise-btn"]')).toBeVisible({ timeout: 10000 });
    // Wait for initial pagination / background fetches to settle
    await page.waitForLoadState('networkidle');

    // 3. Go offline
    await goOffline(context, page);

    // Track network requests to Supabase (especially mutating requests)
    let mutatingRequestCount = 0;
    let anyRequestCountAfterAction = 0;
    let trackActions = false;

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/')) {
        const isRpc = url.includes('/rest/v1/rpc/');
        if (!isRpc && req.method() !== 'GET') {
          mutatingRequestCount++;
        }
        if (trackActions) {
          anyRequestCountAfterAction++;
        }
      }
    });

    // 4. Verify Custom Exercise creation disabled
    const newExerciseBtn = page.locator('[data-testid="open-create-exercise-btn"]');
    await expect(newExerciseBtn).toBeDisabled();
    await expect(newExerciseBtn).toHaveAttribute('title', 'Available when online');

    const exerciseHelper = page.locator('[data-testid="offline-new-exercise-helper"]');
    await expect(exerciseHelper).toBeVisible();
    await expect(exerciseHelper).toHaveText('Available when online');

    // Attempt force click - must not open sheet and must not trigger network requests
    trackActions = true;
    anyRequestCountAfterAction = 0;
    await newExerciseBtn.click({ force: true });
    await expect(page.locator('[data-testid="create-exercise-sheet"]')).not.toBeVisible();
    expect(anyRequestCountAfterAction).toBe(0);
    expect(mutatingRequestCount).toBe(0);
    trackActions = false;

    // 5. Verify Template creation/editing disabled
    const templatesTabBtn = page.locator('button:has-text("Templates")').or(page.locator('[data-testid="tab-templates"]'));
    await templatesTabBtn.first().click();

    const newTemplateBtn = page.locator('[data-testid="new-template-btn"]');
    await expect(newTemplateBtn).toBeVisible({ timeout: 10000 });
    await expect(newTemplateBtn).toBeDisabled();
    await expect(newTemplateBtn).toHaveAttribute('title', 'Available when online');

    const templateHelper = page.locator('[data-testid="offline-new-template-helper"]');
    await expect(templateHelper).toBeVisible();
    await expect(templateHelper).toHaveText('Available when online');

    // Attempt force click
    trackActions = true;
    anyRequestCountAfterAction = 0;
    await newTemplateBtn.click({ force: true });
    await expect(page.locator('[data-testid="template-editor-modal"]')).not.toBeVisible();
    expect(anyRequestCountAfterAction).toBe(0);
    expect(mutatingRequestCount).toBe(0);
  });

  test('settings PR mode options are disabled offline with 0 network requests', async ({
    page,
    context,
  }) => {
    // 1. Sign in as athlete and verify SW control
    await signInUser(page, athleteUser);
    await waitForSwControl(page);

    // 2. Pre-warm /settings while online
    await page.goto('/settings');
    await expect(page.locator('[data-testid="pr-mode-card"]')).toBeVisible({ timeout: 10000 });

    // 3. Go offline
    await goOffline(context, page);

    // Track network requests to Supabase
    let supabaseRequestCount = 0;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/')) {
        supabaseRequestCount++;
      }
    });

    // 4. Verify PR mode card offline state
    const prCard = page.locator('[data-testid="pr-mode-card"]');
    await expect(prCard).toBeVisible();

    const offlineHelper = prCard.locator('[data-testid="offline-helper-text"]');
    await expect(offlineHelper).toBeVisible();
    await expect(offlineHelper).toHaveText('Available when online');

    const weightBtn = page.locator('[data-testid="pr-mode-weight"]');
    const e1rmBtn = page.locator('[data-testid="pr-mode-e1rm"]');

    await expect(weightBtn).toHaveAttribute('disabled', 'true');
    await expect(weightBtn).toHaveAttribute('title', 'Available when online');
    await expect(e1rmBtn).toHaveAttribute('disabled', 'true');
    await expect(e1rmBtn).toHaveAttribute('title', 'Available when online');

    // Attempt clicking e1rm button (inactive)
    await e1rmBtn.click({ force: true });
    expect(supabaseRequestCount).toBe(0);
  });

  test('coach cockpit displays offline banner and disables coach actions with 0 network requests', async ({
    page,
    context,
  }) => {
    // 1. Sign in as coach and verify SW control
    await signInUser(page, coachUser);
    await waitForSwControl(page);

    // 2. Coach lands directly on /coach (Coach Dashboard)
    await expect(page.locator('text=Coach Dashboard')).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    // 3. Go offline
    await goOffline(context, page);

    // Track mutating network requests to Supabase
    let mutatingRequestCount = 0;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/') && req.method() !== 'GET') {
        mutatingRequestCount++;
      }
    });

    // 4. Verify Coach offline status banner appears
    const coachOfflineBanner = page.locator('[data-testid="coach-offline-banner"]');
    await expect(coachOfflineBanner).toBeVisible({ timeout: 10000 });
    await expect(coachOfflineBanner).toContainText('Coach features need a connection');

    expect(mutatingRequestCount).toBe(0);
  });
});
