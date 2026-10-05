import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

function runDb(sql: string): void {
  const cmd = `flock -w 600 /tmp/fitness_local_db.flock psql "${DB_URL}" -v ON_ERROR_STOP=1`;
  execSync(cmd, { input: sql, encoding: 'utf8' });
}

const ATHLETE_USER_ID = 'a0000000-0000-0000-0000-000000000002';
const SEED_MEAL_ID = 'b0000000-0000-0000-0000-000000000001';
const SEED_MEAL_NAME = 'YB5 Toast Test Meal';

function seedMeal(): void {
  const sql = `
    INSERT INTO public.nutrition_logs (id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, logged_at, logged_date)
    VALUES ('${SEED_MEAL_ID}', '${ATHLETE_USER_ID}', '${SEED_MEAL_NAME}', 'Lunch', 450, 35, 45, 12, 5, NOW(), CURRENT_DATE)
    ON CONFLICT (id) DO UPDATE SET logged_at = NOW(), logged_date = CURRENT_DATE, food_name = '${SEED_MEAL_NAME}';
  `;
  runDb(sql);
}

function cleanupData(): void {
  const sql = `
    DELETE FROM public.custom_dishes WHERE user_id = '${ATHLETE_USER_ID}' AND (name = '${SEED_MEAL_NAME}' OR name LIKE 'YB5 %');
  `;
  try {
    runDb(sql);
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
}

function overlaps(
  r1: { x: number; y: number; width: number; height: number },
  r2: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    r1.x + r1.width <= r2.x ||
    r2.x + r2.width <= r1.x ||
    r1.y + r1.height <= r2.y ||
    r2.y + r2.height <= r1.y
  );
}

test.describe('YB5 Toast over Modal Layering & Geometry (D-YB5-T1..T4)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    seedMeal();
  });

  test.afterEach(async () => {
    cleanupData();
  });

  test.afterAll(async () => {
    cleanupData();
  });

  test('Edit-meal star path: toast is top-most at centre point, disjoint from sheet actions, and sheet remains open', async ({
    page,
  }, testInfo) => {
    await login(page);
    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Nutrition")).toBeVisible({ timeout: 15000 });

    // Locate the seeded meal row
    const mealRow = page
      .locator('[data-testid="meal-log-item"]')
      .filter({ hasText: SEED_MEAL_NAME })
      .first();
    await expect(mealRow).toBeVisible({ timeout: 10000 });

    // Open row overflow menu
    const actionsBtn = mealRow.locator('button[aria-haspopup="menu"]');
    await expect(actionsBtn).toBeVisible();
    await actionsBtn.click();

    // Click "Edit meal"
    const editBtn = mealRow.locator('[role="menuitem"]').filter({ hasText: 'Edit meal' });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // EditMealSheet must be visible
    const sheet = page.locator('[data-testid="edit-meal-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // Star icon inside EditMealSheet to save as custom dish
    const starBtn = sheet.locator('button[aria-label="Save as Custom Dish"]');
    await expect(starBtn).toBeVisible();
    await starBtn.click();

    // Toast "Saved custom dish" appears
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('Saved custom dish');

    // Attach screenshot for visual verification
    const shotPath = testInfo.outputPath('toast-over-modal.png');
    await page.screenshot({ path: shotPath });
    await testInfo.attach('toast-over-modal', {
      path: shotPath,
      contentType: 'image/png',
    });

    // Get toast bounding box
    const toastBox = await toast.boundingBox();
    expect(toastBox).not.toBeNull();
    const cx = toastBox!.x + toastBox!.width / 2;
    const cy = toastBox!.y + toastBox!.height / 2;

    // Hit test: topmost element at toast centre point MUST be inside the toast
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const toastEl = el?.closest('[data-testid="quick-log-toast"]');
        const cls = el?.getAttribute('class') ?? '';
        return {
          insideToast: Boolean(toastEl),
          element: el
            ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
                cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''
              }`
            : 'null',
          testId: el?.getAttribute('data-testid') ?? null,
          role: el?.getAttribute('role') ?? null,
          ariaModal: el?.getAttribute('aria-modal') ?? null,
          zIndex: el ? window.getComputedStyle(el).zIndex : null,
        };
      },
      { x: cx, y: cy }
    );

    expect(
      hit.insideToast,
      `elementFromPoint at (${Math.round(cx)}, ${Math.round(
        cy
      )}) hit <${hit.element}> (data-testid="${hit.testId}", role="${hit.role}", aria-modal="${
        hit.ariaModal
      }", z-index="${hit.zIndex}") instead of toast`
    ).toBe(true);

    // Verify raw-px rect disjointness vs sheet's Close button
    const closeBtn = sheet.locator('button[aria-label*="close" i]');
    await expect(closeBtn).toBeVisible();
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox).not.toBeNull();

    expect(
      overlaps(toastBox!, closeBox!),
      `Toast rect overlaps Close button: toast=[${Math.round(toastBox!.x)},${Math.round(
        toastBox!.y
      )},${Math.round(toastBox!.width)},${Math.round(toastBox!.height)}] vs close=[${Math.round(
        closeBox!.x
      )},${Math.round(closeBox!.y)},${Math.round(closeBox!.width)},${Math.round(closeBox!.height)}]`
    ).toBe(false);

    // Hit test: topmost element at close button centre point MUST be inside the close button
    const closeCx = closeBox!.x + closeBox!.width / 2;
    const closeCy = closeBox!.y + closeBox!.height / 2;
    const closeHit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const btn = el?.closest('button[aria-label*="close" i]');
        const cls = el?.getAttribute('class') ?? '';
        return {
          insideClose: Boolean(btn),
          element: el
            ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
                cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''
              }`
            : 'null',
          testId: el?.getAttribute('data-testid') ?? null,
        };
      },
      { x: closeCx, y: closeCy }
    );
    expect(
      closeHit.insideClose,
      `elementFromPoint at close button centre (${Math.round(closeCx)}, ${Math.round(
        closeCy
      )}) hit <${closeHit.element}> (data-testid="${closeHit.testId}") instead of close button`
    ).toBe(true);

    // Verify raw-px rect disjointness vs document.activeElement (D-YB5-T2)
    const activeElBox = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (activeElBox) {
      expect(
        overlaps(toastBox!, activeElBox),
        `Toast rect overlaps focused element (document.activeElement): toast=[${Math.round(
          toastBox!.x
        )},${Math.round(toastBox!.y)},${Math.round(toastBox!.width)},${Math.round(
          toastBox!.height
        )}] vs activeEl=[${Math.round(activeElBox.x)},${Math.round(activeElBox.y)},${Math.round(
          activeElBox.width
        )},${Math.round(activeElBox.height)}]`
      ).toBe(false);
    }

    // Verify raw-px rect disjointness vs sheet's Save and Cancel buttons
    const saveBtn = sheet.locator('[data-testid="save-edit-meal-btn"]');
    const cancelBtn = sheet.locator('[data-testid="cancel-edit-meal-btn"]');
    const saveBox = await saveBtn.boundingBox();
    const cancelBox = await cancelBtn.boundingBox();

    expect(saveBox).not.toBeNull();
    expect(cancelBox).not.toBeNull();

    if (saveBox) {
      expect(
        overlaps(toastBox!, saveBox),
        `Toast rect overlaps Save changes button: toast=[${Math.round(toastBox!.x)},${Math.round(
          toastBox!.y
        )},${Math.round(toastBox!.width)},${Math.round(toastBox!.height)}] vs save=[${Math.round(
          saveBox.x
        )},${Math.round(saveBox.y)},${Math.round(saveBox.width)},${Math.round(saveBox.height)}]`
      ).toBe(false);
    }

    if (cancelBox) {
      expect(
        overlaps(toastBox!, cancelBox),
        `Toast rect overlaps Cancel button: toast=[${Math.round(toastBox!.x)},${Math.round(
          toastBox!.y
        )},${Math.round(toastBox!.width)},${Math.round(toastBox!.height)}] vs cancel=[${Math.round(
          cancelBox.x
        )},${Math.round(cancelBox.y)},${Math.round(cancelBox.width)},${Math.round(
          cancelBox.height
        )}]`
      ).toBe(false);
    }

    // Verify sheet is still open afterwards
    await expect(sheet).toBeVisible();
  });

  test('CustomDishesModal New Dish save: toast is top-most at centre point', async ({ page }) => {
    const dishName = `YB5 Dish ${Date.now()}`;
    await login(page);
    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Nutrition")).toBeVisible({ timeout: 15000 });

    // Open "New Dish" modal
    const newDishBtn = page.locator('[data-testid="create-custom-dish-btn"]');
    await expect(newDishBtn).toBeVisible({ timeout: 10000 });
    await newDishBtn.click();

    const modal = page.locator('[data-testid="custom-dish-modal"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Fill in required name and macros
    const nameInput = modal.locator('input[placeholder*="Protein Oatmeal"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(dishName);

    const macroInputs = modal.locator('[data-testid="parent-macros"] input');
    await expect(macroInputs.nth(0)).toBeVisible();
    await macroInputs.nth(0).fill('250');
    await macroInputs.nth(1).fill('20');
    await macroInputs.nth(2).fill('20');
    await macroInputs.nth(3).fill('5');

    // Save dish
    const saveBtn = modal.locator('button[type="submit"]:has-text("Save Dish")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify toast appears
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('Custom dish saved');

    // Hit test: topmost element at centre point must be inside toast
    const toastBox = await toast.boundingBox();
    expect(toastBox).not.toBeNull();
    const cx = toastBox!.x + toastBox!.width / 2;
    const cy = toastBox!.y + toastBox!.height / 2;

    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const toastEl = el?.closest('[data-testid="quick-log-toast"]');
        const cls = el?.getAttribute('class') ?? '';
        return {
          insideToast: Boolean(toastEl),
          element: el
            ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${
                cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''
              }`
            : 'null',
          testId: el?.getAttribute('data-testid') ?? null,
        };
      },
      { x: cx, y: cy }
    );

    expect(
      hit.insideToast,
      `elementFromPoint at (${Math.round(cx)}, ${Math.round(
        cy
      )}) hit <${hit.element}> (data-testid="${hit.testId}") instead of toast`
    ).toBe(true);

    // Assert raw-px disjointness vs close button if present
    const closeBtn = page.locator('[data-testid="custom-dish-modal"] button[aria-label*="close" i]');
    const hasCloseBtn = await closeBtn.count().then(async (c) => {
      if (c === 0) return false;
      return await closeBtn.isVisible().catch(() => false);
    });
    if (hasCloseBtn) {
      const closeBox = await closeBtn.boundingBox();
      if (closeBox) {
        expect(
          overlaps(toastBox!, closeBox),
          `Toast rect overlaps CustomDishesModal Close button: toast=[${Math.round(
            toastBox!.x
          )},${Math.round(toastBox!.y)},${Math.round(toastBox!.width)},${Math.round(
            toastBox!.height
          )}] vs close=[${Math.round(closeBox.x)},${Math.round(closeBox.y)},${Math.round(
            closeBox.width
          )},${Math.round(closeBox.height)}]`
        ).toBe(false);
      }
    }

    // While modal is open, assert raw-px disjointness vs focused control in modal (D-YB5-T2)
    const activeElBox = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="custom-dish-modal"]');
      const el = document.activeElement;
      if (!modal || !el || el === document.body || !modal.contains(el)) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (activeElBox) {
      expect(
        overlaps(toastBox!, activeElBox),
        `Toast rect overlaps focused element in modal (document.activeElement): toast=[${Math.round(
          toastBox!.x
        )},${Math.round(toastBox!.y)},${Math.round(toastBox!.width)},${Math.round(
          toastBox!.height
        )}] vs activeEl=[${Math.round(activeElBox.x)},${Math.round(activeElBox.y)},${Math.round(
          activeElBox.width
        )},${Math.round(activeElBox.height)}]`
      ).toBe(false);
    }
  });
});
