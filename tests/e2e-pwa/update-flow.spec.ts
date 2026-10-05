import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  type PwaTestUser,
} from './fixtures';

test.describe('PWA Service Worker Update Flow & Safety Blockers', () => {
  let user: PwaTestUser;
  const swPath = path.resolve('dist/sw.js');
  let originalSwContent = '';

  test.beforeAll(() => {
    if (fs.existsSync(swPath)) {
      originalSwContent = fs.readFileSync(swPath, 'utf8');
    }
  });

  test.beforeEach(async () => {
    user = await createPwaTestUser('pwa-update');
  });

  test.afterEach(async () => {
    // Restore original sw.js if modified on disk
    if (originalSwContent && fs.existsSync(swPath)) {
      fs.writeFileSync(swPath, originalSwContent);
    }
    if (user) {
      cleanupPwaTestUser(user);
    }
  });

  test('update flow: banner appears, soft workout drafts trigger confirm dialog, hard modal blocks reload, and applies on tap when safe', async ({
    page,
  }) => {
    // 1. Initial sign-in and SW activation
    await signInUser(page, user);
    await waitForSwControl(page);

    // Track page navigations after SW is controlling
    let navigations = 0;
    page.on('load', () => {
      navigations++;
    });

    // 2. Serve a byte-modified sw.js via page.route and disk sync
    const updatedSwContent =
      (originalSwContent || fs.readFileSync(swPath, 'utf8')) +
      `\n/* pwa-update-spec-${Date.now()} */`;

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

    // Trigger registration update check
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });

    // 3. Assert "Update available · Reload" banner appears
    const banner = page.locator('[data-testid="update-banner"]');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('Update available · Reload');

    // Invariant: Never auto-reloads before user tap
    expect(navigations).toBe(0);

    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    const reason = page.locator('[data-testid="update-block-reason"]');

    // 4. Soft Blocker: Active workout session with typed draft inputs (D-YB2-3)
    await page.evaluate((uid) => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const today = `${year}-${month}-${day}`;
      localStorage.setItem(`yourbody_current_session_pointer_${uid}`, today);
      localStorage.setItem(
        `yourbody_active_session_${uid}_${today}`,
        JSON.stringify({
          schemaVersion: 1,
          sessionId: 'active-session-blocker',
          userId: uid,
          workoutDate: today,
          routineName: 'Active Session Routine',
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

    // Clicking reload opens the update confirmation dialog (soft blocker)
    await reloadBtn.click();
    expect(navigations).toBe(0);

    const dialog = page.locator('[data-testid="update-confirm-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Update now?');
    await expect(dialog).toContainText(
      'Your open workout and the values you typed will still be here after the update.'
    );

    // Cancel out of dialog via "Keep logging"
    const cancelBtn = page.locator('[data-testid="update-confirm-dialog-cancel"]');
    await cancelBtn.click();
    await expect(dialog).toBeHidden();
    expect(navigations).toBe(0);

    // Clear active workout session
    await page.evaluate((uid) => {
      localStorage.removeItem(`yourbody_current_session_pointer_${uid}`);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('yourbody_current_session_pointer_') ||
            key.startsWith('yourbody_active_session_'))
        ) {
          localStorage.removeItem(key);
        }
      }
    }, user.id);

    // 5. Hard Blocker: Open accessible dialog
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'test-modal-dialog-blocker';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      document.body.appendChild(d);
    });

    // Hard blocker disables the reload button and shows the reason
    await expect(reloadBtn).toBeDisabled();
    await expect(reason).toBeVisible();
    await expect(reason).toContainText('Close open dialog before updating');
    expect(navigations).toBe(0);

    // Remove dialog blocker
    await page.evaluate(() => {
      document.getElementById('test-modal-dialog-blocker')?.remove();
    });

    // Reload button automatically re-enables
    await expect(reloadBtn).toBeEnabled();
    await expect(reason).toBeHidden();

    // 6. With no blockers, tap reloads once onto the new SW
    const reloadPromise = page.waitForNavigation({ waitUntil: 'load' });
    await reloadBtn.click();
    await reloadPromise;

    // Verify exactly one reload occurred
    expect(navigations).toBe(1);

    // Verify that after reload, service worker is active and controlling
    const isControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(isControlled).toBe(true);
  });

  test('UpdateBanner at 320px fits without overflow, tap target >= 44px, and does not overlap header or pills', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });

    // 1. Initial sign-in and SW activation
    await signInUser(page, user);
    await waitForSwControl(page);

    // 2. Serve a byte-modified sw.js via page.route and disk sync
    const updatedSwContent =
      (originalSwContent || fs.readFileSync(swPath, 'utf8')) +
      `\n/* pwa-update-density-${Date.now()} */`;

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

    // Trigger registration update check
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.update();
    });

    // 3. Assert "Update available · Reload" banner appears
    const banner = page.locator('[data-testid="update-banner"]');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('Update available · Reload');

    // 4. Density asserts:
    // (a) No horizontal overflow
    const overflow = await banner.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow, 'UpdateBanner must not horizontally overflow at 320px').toBe(false);

    // (b) Tap target >= 44px
    const reloadBtn = page.locator('[data-testid="update-reload-btn"]');
    const box = await reloadBtn.boundingBox();
    expect(box, 'Reload button bounding box exists').not.toBeNull();
    expect(box!.height, `Reload button height (${box!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);
    expect(box!.width, `Reload button width (${box!.width}px) >= 44px`).toBeGreaterThanOrEqual(44);

    // (c) Sits in normal flow below the app header: fully inside the 320px viewport and
    // never overlapping the header or its connection-status badge.
    const bannerBox = await banner.boundingBox();
    expect(bannerBox, 'Banner bounding box exists').not.toBeNull();
    expect(bannerBox!.x, 'banner left edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(bannerBox!.x + bannerBox!.width, 'banner right edge inside 320px').toBeLessThanOrEqual(320);

    const connectionStatus = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toBeVisible();
    const statusBox = await connectionStatus.boundingBox();
    expect(statusBox, 'connection-status bounding box exists').not.toBeNull();
    expect(
      bannerBox!.y,
      `banner top (${bannerBox!.y}) must be below the connection-status badge bottom (${statusBox!.y + statusBox!.height})`
    ).toBeGreaterThanOrEqual(statusBox!.y + statusBox!.height - 1);

    const headerBox = await page.locator('header').first().boundingBox();
    expect(headerBox, 'app header bounding box exists').not.toBeNull();
    expect(
      bannerBox!.y,
      `banner top (${bannerBox!.y}) must not overlap the app header bottom (${headerBox!.y + headerBox!.height})`
    ).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  });
});
