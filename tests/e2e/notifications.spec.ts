import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:58822/postgres';
const ATHLETE_ID = 'a0000000-0000-0000-0000-000000000002';
const P81_CUSTOM_DISH_ID = 'c8100000-0000-0000-0000-000000000001';
const P81_NUTRITION_LOG_ID = 'b8100000-0000-0000-0000-000000000001';
const P81_DISH_NAME = 'P81 Repro Custom Dish';
const P81_MEAL_NAME = 'P81 Repro Prior Meal';

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

function runSql(sql: string): string {
  try {
    const cmd = getPsqlCommand();
    return execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[p8-1-notifications.spec.ts] SQL execution failed:', err);
    throw err;
  }
}

function cleanupTestData() {
  const sql = `
    DELETE FROM public.custom_dishes WHERE id = '${P81_CUSTOM_DISH_ID}' OR name LIKE 'P81 Repro%';
    DELETE FROM public.nutrition_logs WHERE id = '${P81_NUTRITION_LOG_ID}' OR food_name LIKE 'P81 Repro%';
  `;
  try {
    runSql(sql);
  } catch (err) {
    console.error('[p8-1-notifications.spec.ts] Cleanup failed:', err);
    throw err;
  }
}

function seedTestData() {
  cleanupTestData();
  const sql = `
    INSERT INTO public.custom_dishes (id, user_id, name, calories, protein, carbs, fat, fiber, use_count, kind)
    VALUES ('${P81_CUSTOM_DISH_ID}', '${ATHLETE_ID}', '${P81_DISH_NAME}', 420, 35, 45, 10, 5, 999999, 'food');

    INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
    VALUES ('${P81_NUTRITION_LOG_ID}', '${ATHLETE_ID}', '${P81_MEAL_NAME}', 500, 40, 50, 15, 5, timezone('utc'::text, now()), CURRENT_DATE);
  `;
  try {
    runSql(sql);
  } catch (err) {
    console.error('[p8-1-notifications.spec.ts] Seed failed:', err);
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
  await page.locator('[data-testid="nav-nutrition"]').click();
  await page.waitForURL('**/nutrition');
  await expect(page.locator("text=Today's Nutrition")).toBeVisible({ timeout: 15000 });
}

test.describe('P8.1 Notification Standardization & Stray Status Repro', () => {

  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    seedTestData();
  });

  test.afterEach(async () => {
    cleanupTestData();
  });

  test.afterAll(async () => {
    cleanupTestData();
  });

  test('no stray "Meal deleted" status box appears when staging custom dish after meal deletion', async ({ page }) => {
    await loginAsAthlete(page);

    // Verify initial data rendered
    const mealRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: P81_MEAL_NAME }).first();
    await expect(mealRow).toBeVisible();

    const customDishCard = page.locator(`[data-testid="custom-dish-card-${P81_CUSTOM_DISH_ID}"]`);
    await expect(customDishCard).toBeVisible();

    // 1. Delete the meal to trigger 'Meal deleted' status
    const menuBtn = page.locator(`[data-testid="meal-actions-${P81_NUTRITION_LOG_ID}"]`);
    await menuBtn.click();
    const deleteBtn = page.locator(`[data-testid="delete-meal-${P81_NUTRITION_LOG_ID}"]`);
    await deleteBtn.click();
    await page.mouse.move(0, 0);

    // 2. Wait for UndoToast to appear, then finish (6s timer expires and commits delete)
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Deleted');
    await expect(toast).toBeHidden({ timeout: 15000 });

    // Confirm meal row is removed from timeline
    await expect(page.locator(`[data-testid="meal-actions-${P81_NUTRITION_LOG_ID}"]`)).toHaveCount(0);

    // 3. Stage meal by tapping the first custom dish in quick-log favorites
    await customDishCard.click();

    // Confirm StagedMealCard mounts
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();

    // 4. Assert NO stray status/notification box appears adjacent to staged meal card or between sections
    const strayNotifications = await page.evaluate(() => {
      const stagedCardEl = document.querySelector('[data-testid="staged-meal-card"]');
      const favoritesEl = document.querySelector('section:has([data-testid^="custom-dish-card-"])');
      const candidateElements = Array.from(
        document.querySelectorAll('[data-testid="status-message"], [role="status"], [role="alert"]')
      );

      const matches = candidateElements.filter((el) => {
        const text = (el.textContent || '').trim();
        return /Meal deleted|Saved/i.test(text);
      });

      return matches.map((el) => {
        const posToStaged = stagedCardEl ? stagedCardEl.compareDocumentPosition(el) : 0;
        const isPrecedingStaged = Boolean(posToStaged & Node.DOCUMENT_POSITION_PRECEDING);
        const isFollowingStaged = Boolean(posToStaged & Node.DOCUMENT_POSITION_FOLLOWING);

        const posToFavorites = favoritesEl ? favoritesEl.compareDocumentPosition(el) : 0;
        const isFollowingFavorites = Boolean(posToFavorites & Node.DOCUMENT_POSITION_FOLLOWING);

        return {
          text: (el.textContent || '').trim(),
          testId: el.getAttribute('data-testid'),
          role: el.getAttribute('role'),
          isBetweenFavoritesAndStagedCard: isFollowingFavorites && isPrecedingStaged,
          isPrecedingStaged,
          isFollowingStaged,
        };
      });
    });

    expect(
      strayNotifications,
      `Stray notification box appeared when staging custom dish: ${JSON.stringify(strayNotifications)}`
    ).toHaveLength(0);
    await expect(page.locator('[data-testid="status-message"]')).toHaveCount(0);
  });

  test('no stray "Saved" status box appears when staging custom dish after manual meal save', async ({ page }) => {
    await loginAsAthlete(page);

    const customDishCard = page.locator(`[data-testid="custom-dish-card-${P81_CUSTOM_DISH_ID}"]`);
    await expect(customDishCard).toBeVisible();

    // 1. Log a meal via Manual Entry to trigger 'Saved' status
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }
    const manualName = 'P81 Repro Saved Meal';
    await page.locator('[data-testid="dish-name-input"]').fill(manualName);
    await page.locator('[data-testid="calories-input"]').fill('350');
    await page.locator('button:has-text("Log Meal")').last().click();

    // Commit staged manual meal
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();
    const commitBtn = stagedCard.locator('button:has-text("Log Meal (+350 kcal)")');
    await commitBtn.click();

    // Staged card closes
    await expect(stagedCard).toBeHidden({ timeout: 10000 });

    // Wait for any transient toast to finish
    const toast = page.locator('[data-testid="quick-log-toast"]');
    if (await toast.isVisible()) {
      await expect(toast).toBeHidden({ timeout: 10000 });
    }

    // 2. Stage meal by tapping the first custom dish in quick-log favorites
    await customDishCard.click();
    await expect(stagedCard).toBeVisible();

    // 3. Assert NO stray status/notification box appears
    const strayNotifications = await page.evaluate(() => {
      const candidateElements = Array.from(
        document.querySelectorAll('[data-testid="status-message"], [role="status"], [role="alert"]')
      );
      const matches = candidateElements.filter((el) => {
        const text = (el.textContent || '').trim();
        return /Meal deleted|Saved/i.test(text);
      });
      return matches.map((el) => ({
        text: (el.textContent || '').trim(),
        testId: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
      }));
    });

    expect(
      strayNotifications,
      `Stray "Saved" notification appeared when staging custom dish: ${JSON.stringify(strayNotifications)}`
    ).toHaveLength(0);
    await expect(page.locator('[data-testid="status-message"]')).toHaveCount(0);
  });

  test('after staging, a "Saved" action shows exactly one toast (role=status) that disappears within ~4s+margin', async ({ page }) => {
    await loginAsAthlete(page);

    const customDishCard = page.locator(`[data-testid="custom-dish-card-${P81_CUSTOM_DISH_ID}"]`);
    await expect(customDishCard).toBeVisible();

    // Stage the meal via custom dish
    await customDishCard.click();
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();

    // Commit staged meal via "Log Meal" button to trigger "Saved" toast
    const commitBtn = stagedCard.locator('button:has-text("Log Meal")').first();
    await commitBtn.click();

    // Staged card closes
    await expect(stagedCard).toBeHidden({ timeout: 10000 });

    // Assert: exactly one toast appears with 'Saved'
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Saved');
    await expect(page.locator('[data-testid="quick-log-toast"]')).toHaveCount(1);

    // Verify role="status" live region exists and announces Saved
    const liveStatus = page.locator('[role="status"]').filter({ hasText: 'Saved' });
    await expect(liveStatus.first()).toBeAttached();

    // Toast auto-dismisses within ~4s (+ margin)
    await expect(toast).toBeHidden({ timeout: 7000 });
  });
});
