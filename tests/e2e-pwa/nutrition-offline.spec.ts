import { test, expect } from '@playwright/test';
import {
  createPwaTestUser,
  cleanupPwaTestUser,
  signInUser,
  waitForSwControl,
  goOffline,
  goOfflineAndNotify,
  goOnline,
  seedCustomDish,
  getCustomDish,
  getUserNutritionLogs,
  countRows,
  execPsql,
  type PwaTestUser,
} from './fixtures';

const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('PWA Nutrition Offline Acceptance Specs (O2)', () => {
  let user: PwaTestUser;

  test.beforeEach(async () => {
    test.setTimeout(60000);
  });

  test.afterEach(async ({ context }) => {
    await goOnline(context);
    if (user) {
      try {
        cleanupPwaTestUser(user);
      } catch (err) {
        console.error('[nutrition-offline] Cleanup error (rethrown):', err);
        throw err;
      }
    }
  });

  test('a) paste clear label block offline -> staged with Parsed locally badge -> confirm logs with pending mark + header -> reconnect syncs exactly once to DB', async ({
    page,
    context,
  }) => {
    user = await createPwaTestUser('nutr-label-offline');

    // 1. Sign in online and ensure service worker control
    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

    // 2. Go offline
    await goOfflineAndNotify(context, page);
    const connectionStatus = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toHaveText(/^Offline/);

    // 3. Paste clear single nutrition block into natural language input
    const clearBlock = [
      'Chicken Breast Plate',
      'Serving: 200 g',
      'Calories: 330',
      'Protein: 62 g',
      'Carbs: 0 g',
      'Fat: 7.2 g',
    ].join('\n');

    const textarea = page.locator('textarea');
    await textarea.fill(clearBlock);
    await page.locator('[data-testid="analyze-meal-button"]').click();

    // 4. Verify staged locally without auto-logging
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 10000 });

    const badge = stagedCard.locator('[data-testid="parsed-locally-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Parsed locally');

    // Assert not auto-logged yet: 0 rows in database, 0 meal log items in UI
    expect(countRows('public.nutrition_logs', `user_id = '${user.id}'`)).toBe(0);
    await expect(page.locator('[data-testid="meal-log-item"]')).toHaveCount(0);

    // 5. User confirms by clicking "Log Meal"
    const logBtn = stagedCard.locator('[data-testid="staged-card-actions"] button:has-text("Log Meal")');
    await expect(logBtn).toBeVisible();
    await logBtn.click();
    await expect(stagedCard).not.toBeVisible({ timeout: 10000 });

    // 6. Meal appears in Today's Meals with pending mark
    const mealRow = page.locator('[data-testid="meal-log-item"]').first();
    await expect(mealRow).toBeVisible({ timeout: 10000 });
    await expect(mealRow.locator('[data-testid="meal-log-name"]')).toHaveText('Chicken Breast Plate');

    const pendingMark = mealRow.locator('[data-testid="pending-mark"]');
    await expect(pendingMark).toBeVisible({ timeout: 5000 });

    // Header reflects pending count
    await expect(connectionStatus).toHaveText(/Offline · \d+ pending/);

    // 7. Reconnect online
    await goOnline(context, page);

    // Toast "Synced N changes" appears
    const toast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(toast).toBeVisible({ timeout: 15000 });

    // Pending marks clear and header returns to clean Online state
    await expect(page.locator('[data-testid="pending-mark"]')).toHaveCount(0);
    await expect(connectionStatus).toContainText('Online');

    // 8. Server DB verification via psql: exactly 1 nutrition_logs row with expected values
    const logs = getUserNutritionLogs(user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].food_name).toBe('Chicken Breast Plate');
    expect(Number(logs[0].calories)).toBe(330);
    expect(Number(logs[0].protein)).toBe(62);
    expect(Number(logs[0].carbs)).toBe(0);
    expect(Number(logs[0].fat)).toBe(7.2);
  });

  test('b) online paste of clear block -> Parsed locally + Analyze with AI instead visible -> clicking sends original text verbatim to parse-nutrition', async ({
    page,
  }) => {
    user = await createPwaTestUser('nutr-ai-instead');

    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

    const clearBlock = [
      'Atlantic Salmon Fillet',
      'Serving: 250 g',
      'Calories: 330',
      'Protein: 40 g',
      'Carbs: 0 g',
      'Fat: 19 g',
    ].join('\n');

    let interceptedRequestText = '';
    await page.route('**/functions/v1/parse-nutrition', async (route) => {
      const postData = route.request().postDataJSON() || {};
      interceptedRequestText = postData.text || postData.input || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          name: 'Atlantic Salmon Fillet (AI Deep Parsed)',
          calories: 330,
          protein: 40,
          carbs: 0,
          fat: 19,
          fiber: 0,
          items: [
            {
              name: 'Atlantic Salmon Fillet',
              portion: '250 g',
              quantity: 250,
              unit: 'g',
              calories: 330,
              protein: 40,
              carbs: 0,
              fat: 19,
              fiber: 0,
            },
          ],
        }),
      });
    });

    // Paste clear block while online
    await page.locator('textarea').fill(clearBlock);
    await page.locator('[data-testid="analyze-meal-button"]').click();

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 10000 });

    // Both badge and button are visible online
    await expect(stagedCard.locator('[data-testid="parsed-locally-badge"]')).toHaveText('Parsed locally');
    const aiInsteadBtn = stagedCard.locator('[data-testid="analyze-with-ai-instead-btn"]');
    await expect(aiInsteadBtn).toBeVisible();
    await expect(aiInsteadBtn).toContainText('Analyze with AI instead');

    // Click "Analyze with AI instead"
    await aiInsteadBtn.click();

    // Verify verbatim text reached parse-nutrition endpoint
    await expect.poll(() => interceptedRequestText).toBe(clearBlock);

    // Verify card updated with AI response without local badge
    await expect(stagedCard.locator('[data-testid="parsed-locally-badge"]')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="dish-name-input"]')).toHaveValue(
      'Atlantic Salmon Fillet (AI Deep Parsed)'
    );

    // Discard
    await page.locator('[data-testid="staged-card-actions"] button[aria-label="Discard staged meal"]').click();
    await expect(stagedCard).not.toBeVisible();
  });

  test('c) mixed input online preserves explicit numbers to server; mixed input offline disables AI submit with connection hint and queues 0 items', async ({
    page,
    context,
  }) => {
    user = await createPwaTestUser('nutr-mixed-input');

    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

    // 1. Online mixed input
    const mixedOnlineText = '2 eggs, 1 slice sourdough with 10g butter and honey';
    let interceptedMixed = '';
    await page.route('**/functions/v1/parse-nutrition', async (route) => {
      const postData = route.request().postDataJSON() || {};
      interceptedMixed = postData.text || postData.input || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          name: 'Eggs and Sourdough Breakfast',
          calories: 340,
          protein: 16,
          carbs: 28,
          fat: 18,
          fiber: 1,
          items: [
            { name: 'Eggs', portion: '2 large', quantity: 2, unit: 'egg', calories: 140, protein: 12, carbs: 1, fat: 10, fiber: 0 },
            { name: 'Sourdough', portion: '1 slice', quantity: 1, unit: 'slice', calories: 120, protein: 4, carbs: 24, fat: 1, fiber: 1 },
            { name: 'Butter', portion: '10 g', quantity: 10, unit: 'g', calories: 80, protein: 0, carbs: 3, fat: 7, fiber: 0 },
          ],
        }),
      });
    });

    await page.locator('textarea').fill(mixedOnlineText);
    await page.locator('[data-testid="analyze-meal-button"]').click();

    // Verify explicit numbers were forwarded verbatim
    await expect.poll(() => interceptedMixed).toBe(mixedOnlineText);

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="staged-card-actions"] button[aria-label="Discard staged meal"]').click();
    await expect(stagedCard).not.toBeVisible();

    // 2. Mixed input offline: AI is online-only, so submit is disabled with connection hint
    await goOfflineAndNotify(context, page);

    const mixedOfflineText = 'Whey shake with 30g protein and a banana';
    await page.locator('textarea').fill(mixedOfflineText);

    // Verify hint is visible and submit button is disabled
    await expect(page.locator('text=AI needs a connection: use quick log')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="analyze-meal-button"]')).toBeDisabled();

    // Verify nothing is queued in Pending review
    await expect(page.locator('[data-testid="pending-review-list"]')).not.toBeVisible();

    // Assert nothing logged in database or UI
    expect(countRows('public.nutrition_logs', `user_id = '${user.id}'`)).toBe(0);
    await expect(page.locator('[data-testid="meal-log-item"]')).toHaveCount(0);

    // Reconnect restores input without reload
    await goOnline(context, page);
    await expect(page.locator('[data-testid="analyze-meal-button"]')).toBeEnabled();
    await expect(page.locator('text=AI needs a connection: use quick log')).not.toBeVisible();
  });

  test('d) queued text + photo offline: reload survival, 429 Retry-After handling, photo deleted from IDB on analysis, review logs with capture timestamp, 422 discard cleans up', async ({
    browser,
  }) => {
    test.setTimeout(90000);

    // Pin browser timezone to Asia/Tokyo
    const context = await browser.newContext({
      timezoneId: 'Asia/Tokyo',
    });
    const page = await context.newPage();

    user = await createPwaTestUser('nutr-aiq-tokyo');
    execPsql(`UPDATE public.users SET timezone = 'Asia/Tokyo' WHERE id = '${user.id}';`);

    try {
      await signInUser(page, user);
      await waitForSwControl(page);

      await page.goto('/nutrition');
      await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
      await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

      // 1. Go offline
      await goOfflineAndNotify(context, page);

      // Seed pre-existing queued text item and photo item in IndexedDB aiq (simulating legacy client queue)
      const now = new Date();
      const capturedAt = now.toISOString();
      const captureDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      await page.evaluate(
        async ({ uid, capturedAt, captureDate, base64Photo }) => {
          const req = indexedDB.open(`yourbody-offline-${uid}`);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const tx = db.transaction('aiq', 'readwrite');
          const store = tx.objectStore('aiq');
          store.put({
            id: 'queued-text-item',
            userId: uid,
            kind: 'text',
            text: 'Tokyo Ramen with chashu and soft egg',
            capturedAt,
            captureDate,
            status: 'queued',
            attempts: 0,
            nextAttemptAt: Date.now(),
          });
          store.put({
            id: 'queued-photo-item',
            userId: uid,
            kind: 'photo',
            photo: { base64: base64Photo, mime: 'image/png' },
            capturedAt,
            captureDate,
            status: 'queued',
            attempts: 0,
            nextAttemptAt: Date.now(),
          });
          await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(undefined);
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        },
        {
          uid: user.id,
          capturedAt,
          captureDate,
          base64Photo: FIXTURE_PNG.toString('base64'),
        }
      );
      await page.reload();

      // 2. Both items queued in Pending review
      const pendingList = page.locator('[data-testid="pending-review-list"]');
      await expect(pendingList).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid^="pending-review-item-"]')).toHaveCount(2);

      // Verify photo item has photo data in IDB initially
      const hasPhotoInitially = await page.evaluate(async (uid) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readonly');
        const items = await new Promise<any[]>((resolve, reject) => {
          const r = tx.objectStore('aiq').getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        const photoItem = items.find((it) => it.kind === 'photo');
        return Boolean(photoItem && photoItem.photo && photoItem.photo.base64);
      }, user.id);
      expect(hasPhotoInitially).toBe(true);

      // 3. Page RELOAD while offline -> both still queued
      await page.reload();
      await expect(page.locator('[data-testid="pending-review-list"]')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid^="pending-review-item-"]')).toHaveCount(2);

      // Record civil date at capture
      const expectedCaptureDate = await page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });

      // 4. Setup parse-nutrition route: return 429 once (Retry-After: 1), then success
      let parseNutritionCallCount = 0;
      await page.route('**/functions/v1/parse-nutrition', async (route) => {
        parseNutritionCallCount++;
        if (parseNutritionCallCount === 1) {
          await route.fulfill({
            status: 429,
            contentType: 'application/json',
            headers: {
              'access-control-allow-origin': '*',
              'Retry-After': '1',
              'retry-after': '1',
            },
            body: JSON.stringify({ error: 'Rate limited (15 RPM)' }),
          });
          return;
        }

        const postData = route.request().postDataJSON() || {};
        const isPhoto = Boolean(postData.image_base64 || postData.photo);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            name: isPhoto ? 'Captured Photo Bento' : 'Tokyo Ramen Bowl',
            calories: 650,
            protein: 35,
            carbs: 75,
            fat: 20,
            fiber: 3,
            items: [
              {
                name: isPhoto ? 'Captured Photo Bento' : 'Tokyo Ramen Bowl',
                portion: '1 bowl',
                quantity: 1,
                unit: 'bowl',
                calories: 650,
                protein: 35,
                carbs: 75,
                fat: 20,
                fiber: 3,
              },
            ],
          }),
        });
      });

      // Reconnect online: processor wakes up and attempts processing
      await goOnline(context, page);

      // Poll IDB until 429 backoff has elapsed, then dispatch online event to wake processor
      await expect.poll(async () => {
        return page.evaluate(async (uid) => {
          const openReq = indexedDB.open(`yourbody-offline-${uid}`);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            openReq.onsuccess = () => resolve(openReq.result);
            openReq.onerror = () => reject(openReq.error);
          });
          const tx = db.transaction('aiq', 'readonly');
          const items = await new Promise<any[]>((resolve, reject) => {
            const getAllReq = tx.objectStore('aiq').getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result);
            getAllReq.onerror = () => reject(getAllReq.error);
          });
          db.close();
          const now = Date.now();
          const hadAttempt = items.some((item) => (item.attempts || 0) > 0);
          const allEligible = items.every((item) => item.status === 'ready' || (item.nextAttemptAt || 0) <= now);
          return hadAttempt && allEligible;
        }, user.id);
      }, { timeout: 45000, intervals: [2000] }).toBe(true);

      await page.evaluate(() => {
        window.dispatchEvent(new Event('online'));
      });

      // Both items reach 'ready' with "Review" button visible
      await expect(page.locator('[data-testid^="review-aiq-item-"]')).toHaveCount(2, { timeout: 45000 });

      // 5. Verify IndexedDB aiq photo field is deleted after analysis
      const isPhotoDeleted = await page.evaluate(async (uid) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readonly');
        const items = await new Promise<any[]>((resolve, reject) => {
          const r = tx.objectStore('aiq').getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        const photoItem = items.find((it) => it.kind === 'photo');
        return photoItem ? photoItem.photo === undefined : false;
      }, user.id);
      expect(isPhotoDeleted).toBe(true);

      // Nothing logged before user confirms
      expect(countRows('public.nutrition_logs', `user_id = '${user.id}'`)).toBe(0);

      // 6. Review -> Confirm logs with capture timestamp & capture date
      const firstReviewBtn = page.locator('[data-testid^="review-aiq-item-"]').first();
      const testId = await firstReviewBtn.getAttribute('data-testid');
      const reviewItemId = testId?.replace('review-aiq-item-', '') || '';

      // Read capturedAt stored in the specific aiq item from IDB before review
      const capturedAiItem = await page.evaluate(async ({ uid, itemId }) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readonly');
        const item = await new Promise<any>((resolve, reject) => {
          const r = tx.objectStore('aiq').get(itemId);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return item;
      }, { uid: user.id, itemId: reviewItemId });
      expect(capturedAiItem).toBeTruthy();
      const expectedCapturedAt = capturedAiItem.capturedAt;

      await firstReviewBtn.click();

      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible({ timeout: 10000 });

      // Click Log Meal
      await page.locator('[data-testid="staged-card-actions"] button:has-text("Log Meal")').click();
      await expect(stagedCard).not.toBeVisible({ timeout: 10000 });

      // Server DB verification: logged_date and logged_at match the capturedAt from IDB before review (exact instant)
      const serverLogs = getUserNutritionLogs(user.id);
      expect(serverLogs.length).toBeGreaterThanOrEqual(1);
      expect(serverLogs[0].logged_date).toBe(expectedCaptureDate);
      expect(new Date(serverLogs[0].logged_at).toISOString()).toBe(new Date(expectedCapturedAt).toISOString());

      // 7. Test Discard on failed (422) item
      // Seed a failed item into IDB
      await page.evaluate(async (uid) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readwrite');
        tx.objectStore('aiq').put({
          id: 'failed-422-item',
          userId: uid,
          kind: 'photo',
          photo: { base64: 'mock', mime: 'image/png' },
          capturedAt: new Date().toISOString(),
          captureDate: '2026-10-01',
          status: 'failed',
          attempts: 1,
          nextAttemptAt: 0,
          lastError: 'NON_FOOD_DETECTED: No food items identified',
        });
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => {
            db.close();
            resolve(undefined);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        });
      }, user.id);

      // Refresh page to load failed item
      await page.reload();
      const failedDiscardBtn = page.locator('[data-testid="discard-aiq-item-failed-422-item"]');
      await expect(failedDiscardBtn).toBeVisible({ timeout: 10000 });
      await failedDiscardBtn.click();

      // Confirm discard box
      const confirmDiscardBtn = page.locator('[data-testid="confirm-discard-btn-failed-422-item"]');
      await expect(confirmDiscardBtn).toBeVisible();
      await confirmDiscardBtn.click();

      await expect(failedDiscardBtn).not.toBeVisible({ timeout: 5000 });

      // Verify item and photo gone from IDB
      const failedItemInDb = await page.evaluate(async (uid) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readonly');
        const item = await new Promise((resolve, reject) => {
          const r = tx.objectStore('aiq').get('failed-422-item');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return item;
      }, user.id);
      expect(failedItemInDb).toBeUndefined();
    } finally {
      await context.close();
    }
  });

  test('e) quick-log cached custom dish offline: pending row, reconnect -> exactly one row + use_count incremented by 1, replay creates no duplicate', async ({
    page,
    context,
  }) => {
    user = await createPwaTestUser('nutr-quick-dish');

    // 1. Seed custom dish in DB while online
    const dishId = seedCustomDish(user, 'Golden Oatmeal Bowl', 360, 24, 52, 6);

    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

    // Wait for custom dish to appear in Quick Log Favorites
    const quickLogBtn = page.locator(`[data-testid="quick-log-btn-${dishId}"]`);
    await expect(quickLogBtn).toBeVisible({ timeout: 15000 });

    // Wait for query cache to settle
    await page.waitForLoadState('networkidle');

    // 2. Go offline
    await goOfflineAndNotify(context, page);

    // 3. Quick-log dish offline with 1 tap
    await quickLogBtn.click();

    // Verify row appears in Today's Meals with pending mark
    const mealRow = page.locator('[data-testid="meal-log-item"]').first();
    await expect(mealRow).toBeVisible({ timeout: 10000 });
    await expect(mealRow.locator('[data-testid="meal-log-name"]')).toHaveText('Golden Oatmeal Bowl');
    await expect(mealRow.locator('[data-testid="pending-mark"]')).toBeVisible({ timeout: 5000 });

    const connectionStatus = page.locator('[data-testid="connection-status"]');
    await expect(connectionStatus).toHaveText(/Offline · \d+ pending/);

    // 4. Replay test: flaky reconnect (toggle connection twice)
    await goOnline(context, page);
    await goOffline(context);
    await goOnline(context, page);

    // Toast appears
    const toast = page.locator('text=/Synced \\d+ changes?/').first();
    await expect(toast).toBeVisible({ timeout: 15000 });

    // Pending mark clears
    await expect(mealRow.locator('[data-testid="pending-mark"]')).not.toBeVisible();
    await expect(connectionStatus).toContainText('Online');

    // 5. Database assertions via psql:
    // Exactly ONE row inserted in nutrition_logs (idempotent upsert, no duplicates)
    const logs = getUserNutritionLogs(user.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].food_name).toBe('Golden Oatmeal Bowl');
    expect(Number(logs[0].calories)).toBe(360);

    // Custom dish use_count incremented by exactly 1
    const dishRecord = getCustomDish(dishId);
    expect(dishRecord).not.toBeNull();
    expect(dishRecord!.use_count).toBe(1);
  });

  test('f) offline: delete/edit/rescale of logged meal and custom dish save are disabled with Available when online and issue 0 network requests', async ({
    page,
    context,
  }) => {
    user = await createPwaTestUser('nutr-disabled-actions');

    // Seed prior logged meal and custom dish
    const today = new Date().toISOString().slice(0, 10);
    execPsql(`
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, logged_date)
      VALUES (gen_random_uuid(), '${user.id}', 'Pre-logged Grilled Chicken', 280, 48, 0, 8, '${today}');
    `);
    const dishId = seedCustomDish(user, 'Saved Protein Pudding', 200, 25, 10, 4);

    await signInUser(page, user);
    await waitForSwControl(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="meal-log-item"]')).toHaveCount(1);
    await page.waitForLoadState('networkidle');

    // Go offline
    await goOfflineAndNotify(context, page);

    // Track network requests
    let mutatingRequestCount = 0;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/rest/v1/') && req.method() !== 'GET') {
        mutatingRequestCount++;
      }
    });

    // 1. Open overflow menu on the logged meal row
    const mealRow = page.locator('[data-testid="meal-log-item"]').first();
    const overflowTrigger = mealRow.locator('[aria-label^="Actions for "]');
    await overflowTrigger.click();

    // Verify Edit meal has "Available when online" in label or title
    const editOption = page.locator('text=/Edit meal.*Available when online/');
    await expect(editOption).toBeVisible({ timeout: 5000 });
    await editOption.click({ force: true });
    expect(mutatingRequestCount).toBe(0);

    // Verify Delete meal has "Available when online"
    await overflowTrigger.click();
    const deleteOption = page.locator('text=/Delete meal.*Available when online/');
    await expect(deleteOption).toBeVisible({ timeout: 5000 });
    await deleteOption.click({ force: true });
    expect(mutatingRequestCount).toBe(0);

    // 2. Custom dish actions:
    // Staging the custom dish to check "Save as Custom Dish" button in StagedMealCard
    const quickLogBtn = page.locator(`[data-testid="custom-dish-card-${dishId}"]`);
    await quickLogBtn.click();

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 10000 });

    const saveCustomBtn = stagedCard.locator('[aria-label="Save as Custom Dish"]');
    await expect(saveCustomBtn).toBeVisible();
    await expect(saveCustomBtn).toHaveAttribute('disabled', '');
    await expect(saveCustomBtn).toHaveAttribute('title', 'Available when online');

    await saveCustomBtn.click({ force: true });
    expect(mutatingRequestCount).toBe(0);

    // Discard staged meal
    await stagedCard.locator('[aria-label="Discard staged meal"]').click();
  });

  test('g) second user on the same device never sees user A queued AI items or pending meals', async ({
    page,
    context,
  }) => {
    const userA = await createPwaTestUser('nutr-user-a');
    const userB = await createPwaTestUser('nutr-user-b');

    try {
      // 1. User A signs in
      await signInUser(page, userA);
      await waitForSwControl(page);

      await page.goto('/nutrition');
      await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
      await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

      // User A goes offline
      await goOfflineAndNotify(context, page);

      // User A logs a meal offline
      await page.locator('textarea').fill('User A Secret Offline Steak\nServing: 250 g\nCalories: 450\nProtein: 55 g\nCarbs: 0 g\nFat: 24 g');
      await page.locator('[data-testid="analyze-meal-button"]').click();
      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible({ timeout: 10000 });
      await page.locator('[data-testid="staged-card-actions"] button:has-text("Log Meal")').click();
      await expect(stagedCard).not.toBeVisible({ timeout: 10000 });

      // User A has a legacy queued AI text item in IndexedDB aiq
      await page.evaluate(async (uid) => {
        const req = indexedDB.open(`yourbody-offline-${uid}`);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiq', 'readwrite');
        tx.objectStore('aiq').put({
          id: 'user-a-secret-shake',
          userId: uid,
          kind: 'text',
          text: 'User A Secret Shake with blueberries and spinach',
          capturedAt: new Date().toISOString(),
          captureDate: '2026-10-02',
          status: 'queued',
          attempts: 0,
          nextAttemptAt: Date.now(),
        });
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, userA.id);
      await page.reload();

      // Verify User A sees both
      await expect(page.locator('[data-testid="meal-log-item"]')).toHaveCount(1, { timeout: 10000 });
      await expect(page.locator('[data-testid="pending-review-list"]')).toBeVisible({ timeout: 10000 });

      // 2. User A signs out
      const signOutBtn = page.locator('[data-testid="sign-out-button"]');
      await expect(signOutBtn).toBeVisible({ timeout: 10000 });
      await signOutBtn.click();

      const confirmDialog = page.locator('[data-testid="sign-out-confirm-dialog"]');
      await expect(confirmDialog).toBeVisible({ timeout: 10000 });
      const confirmSignOut = page.locator('[data-testid="sign-out-confirm-dialog-confirm"]').or(
        page.locator('button:has-text("Sign out anyway")')
      );
      await confirmSignOut.first().click();

      // Reconnect online & clear localStorage session tokens so User B can sign in
      await goOnline(context, page);
      await page.evaluate(() => {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('sb-')) {
            localStorage.removeItem(k);
          }
        }
      });

      // 3. User B signs in
      await signInUser(page, userB);
      await page.goto('/nutrition');
      await expect(page.locator("text=Today's Meals")).toBeVisible({ timeout: 15000 });
      await expect(page.locator('text=No meals logged for this date yet.')).toBeVisible({ timeout: 15000 });

      // 4. Verify User B sees clean state:
      // Zero meal log items (no User A meals)
      await expect(page.locator('[data-testid="meal-log-item"]')).toHaveCount(0);
      await expect(page.locator('text=User A Secret Offline Steak')).not.toBeVisible();

      // Zero queued AI items (no User A queued items)
      await expect(page.locator('[data-testid="pending-review-list"]')).not.toBeVisible();
      await expect(page.locator('text=User A Secret Shake')).not.toBeVisible();

      // Verify DB: User A's offline meal was NOT synced under User B
      expect(countRows('public.nutrition_logs', `user_id = '${userB.id}'`)).toBe(0);
    } finally {
      cleanupPwaTestUser(userA);
      cleanupPwaTestUser(userB);
    }
  });
});
