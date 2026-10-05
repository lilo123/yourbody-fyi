import { execSync } from 'child_process';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

const ATHLETE_USER_ID = 'a0000000-0000-0000-0000-000000000002';
const SHORT_MEAL_ID = 'b0000000-0000-0000-0000-000000000011';
const SHORT_MEAL_NAME = 'YB6 Short Meal Test';
const TALL_MEAL_ID = 'b0000000-0000-0000-0000-000000000012';
const TALL_MEAL_NAME = 'YB6 Tall Meal Test';

function runDb(sqlQuery: string): void {
  const command = `flock -w 600 /tmp/fitness_local_db.flock psql "${DB_URL}" -v ON_ERROR_STOP=1`;
  execSync(command, { input: sqlQuery, encoding: 'utf8' });
}

function cleanupData(): void {
  const sqlQuery = `
    DELETE FROM public.nutrition_logs WHERE id IN ('${SHORT_MEAL_ID}', '${TALL_MEAL_ID}') OR food_name LIKE 'YB6 %';
    DELETE FROM public.custom_dishes WHERE user_id = '${ATHLETE_USER_ID}' AND (name LIKE 'YB6 %' OR name = '${SHORT_MEAL_NAME}' OR name = '${TALL_MEAL_NAME}');
  `;
  runDb(sqlQuery);
}

function seedMeals(): void {
  // Build 12 items for tall meal so content height exceeds viewport height (>800px)
  // forcing the sticky action buttons bar into the bottom toast lane.
  // 12 * 50 kcal = 600 kcal, 12 * 5g protein = 60g, 12 * 5g carbs = 60g, 12 * 1g fat = 12g, 12 * 1g fiber = 12g
  // Parent row values match the items sum exactly to satisfy chk_nl_parent_equals_items_sum.
  const tallItems = Array.from({ length: 12 }, (_, index) => ({
    id: `yb6-tall-item-${index + 1}`,
    name: `Tall Component ${index + 1}`,
    quantity: 100,
    unit: 'g',
    displayPortion: '100 g',
    calories: 50,
    protein: 5,
    carbs: 5,
    fat: 1,
    fiber: 1,
  }));
  const tallItemsJson = JSON.stringify(tallItems).replace(/'/g, "''");

  const sqlQuery = `
    -- Short meal: 1 leaf item (items IS NULL), actions row sits mid-screen
    INSERT INTO public.nutrition_logs (id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, logged_at, logged_date, items)
    VALUES ('${SHORT_MEAL_ID}', '${ATHLETE_USER_ID}', '${SHORT_MEAL_NAME}', 'Lunch', 450, 35, 45, 12, 5, NOW(), CURRENT_DATE, NULL)
    ON CONFLICT (id) DO UPDATE SET logged_at = NOW(), logged_date = CURRENT_DATE, food_name = '${SHORT_MEAL_NAME}', calories = 450, protein = 35, carbs = 45, fat = 12, fiber = 5, items = NULL;

    -- Tall meal: 12 items in items jsonb, action buttons reach bottom lane
    INSERT INTO public.nutrition_logs (id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, logged_at, logged_date, items)
    VALUES ('${TALL_MEAL_ID}', '${ATHLETE_USER_ID}', '${TALL_MEAL_NAME}', 'Dinner', 600, 60, 60, 12, 12, NOW(), CURRENT_DATE, '${tallItemsJson}'::jsonb)
    ON CONFLICT (id) DO UPDATE SET logged_at = NOW(), logged_date = CURRENT_DATE, food_name = '${TALL_MEAL_NAME}', calories = 600, protein = 60, carbs = 60, fat = 12, fiber = 12, items = '${tallItemsJson}'::jsonb;
  `;
  runDb(sqlQuery);
}

interface BoundingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(rectA: BoundingRect, rectB: BoundingRect): boolean {
  return !(
    rectA.x + rectA.width <= rectB.x ||
    rectB.x + rectB.width <= rectA.x ||
    rectA.y + rectA.height <= rectB.y ||
    rectB.y + rectB.height <= rectA.y
  );
}

function formatRect(rect: BoundingRect): string {
  return `[x=${Math.round(rect.x)}, y=${Math.round(rect.y)}, w=${Math.round(rect.width)}, h=${Math.round(rect.height)}, right=${Math.round(rect.x + rect.width)}, bottom=${Math.round(rect.y + rect.height)}]`;
}

async function loginAsAthlete(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
}

/**
 * Configure viewport to standard project viewports:
 * - 320x568 for Narrow Chrome / Safari projects
 * - 393x852 for Mobile Chrome / Safari projects
 * - Default viewport for Desktop Chrome
 */
async function configureViewport(page: Page, testInfo: TestInfo): Promise<{ width: number; height: number }> {
  const projectName = testInfo.project.name;
  if (projectName.includes('320')) {
    const vp = { width: 320, height: 568 };
    await page.setViewportSize(vp);
    return vp;
  }
  if (projectName.includes('Mobile')) {
    const vp = { width: 393, height: 852 };
    await page.setViewportSize(vp);
    return vp;
  }
  return page.viewportSize() || { width: 1280, height: 720 };
}

/**
 * Derives normal bottom offset without modal.
 * Per ToastHost / UndoToast:
 * When <nav> is present, baseline is (window.innerHeight - navRect.top).
 * The toast sits 8px above the nav: Math.round(baseline + 8).
 * Fallback when nav is absent is 74px (66px nav height + 8px gap).
 */
async function getNormalBottomOffset(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const nav = document.querySelector('nav');
    if (nav) {
      const navRect = nav.getBoundingClientRect();
      if (navRect.height > 0) {
        return Math.round((window.innerHeight - navRect.top) + 8);
      }
    }
    return 74;
  });
}

async function openEditMealSheet(page: Page, mealName: string) {
  await page.goto('/nutrition');
  await expect(page.locator("text=Today's Nutrition")).toBeVisible({ timeout: 15000 });

  const mealRow = page
    .locator('[data-testid="meal-log-item"]')
    .filter({ hasText: mealName })
    .first();
  await expect(mealRow).toBeVisible({ timeout: 15000 });

  const actionsBtn = mealRow.locator('button[aria-haspopup="menu"]');
  await expect(actionsBtn).toBeVisible({ timeout: 10000 });
  await actionsBtn.click();

  const editBtn = page.locator('[role="menuitem"]').filter({ hasText: 'Edit meal' });
  await expect(editBtn).toBeVisible({ timeout: 10000 });
  await editBtn.click();

  const sheet = page.locator('[data-testid="edit-meal-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 10000 });
  return sheet;
}

test.describe('YB6 Toast Bottom In Modal (D-YB6-5)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    cleanupData();
    seedMeals();
  });

  test.afterEach(async () => {
    cleanupData();
  });

  test.afterAll(async () => {
    cleanupData();
  });

  test('(i) Short meal: toast bottom edge within bottom lane, above actions row, top-most, disjoint from controls, sheet stays open', async ({
    page,
  }, testInfo) => {
    const viewport = await configureViewport(page, testInfo);
    await loginAsAthlete(page);

    const sheet = await openEditMealSheet(page, SHORT_MEAL_NAME);

    // Save as Custom Dish via Star button inside EditMealSheet
    const starBtn = sheet.locator('button[aria-label="Save as Custom Dish"]');
    await expect(starBtn).toBeVisible({ timeout: 10000 });
    await starBtn.click();

    // Toast "Saved custom dish" appears
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('Saved custom dish');

    // Measure toast bounding box
    const toastBox = await toast.boundingBox();
    expect(toastBox, 'Toast bounding box must not be null').not.toBeNull();
    const toastTop = toastBox!.y;
    const toastBottom = toastBox!.y + toastBox!.height;

    // Hit test: topmost element at toast centre point MUST be inside the toast
    const centerCoordX = toastBox!.x + toastBox!.width / 2;
    const centerCoordY = toastBox!.y + toastBox!.height / 2;
    const hitResult = await page.evaluate(
      ({ posX, posY }) => {
        const targetElement = document.elementFromPoint(posX, posY);
        const toastElement = targetElement?.closest('[data-testid="quick-log-toast"]');
        return {
          insideToast: Boolean(toastElement),
          elementDesc: targetElement
            ? `${targetElement.tagName.toLowerCase()}${targetElement.id ? '#' + targetElement.id : ''}${
                targetElement.className ? '.' + targetElement.className.split(/\s+/).slice(0, 2).join('.') : ''
              }`
            : 'null',
          testId: targetElement?.getAttribute('data-testid') ?? null,
          role: targetElement?.getAttribute('role') ?? null,
          ariaModal: targetElement?.getAttribute('aria-modal') ?? null,
          zIndex: targetElement ? window.getComputedStyle(targetElement).zIndex : null,
        };
      },
      { posX: centerCoordX, posY: centerCoordY }
    );

    expect(
      hitResult.insideToast,
      `elementFromPoint at center (${Math.round(centerCoordX)}, ${Math.round(centerCoordY)}) hit <${hitResult.elementDesc}> (data-testid="${hitResult.testId}", role="${hitResult.role}", aria-modal="${hitResult.ariaModal}", z-index="${hitResult.zIndex}") instead of toast. toast=${formatRect(toastBox!)}`
    ).toBe(true);

    // Locate controls in sheet
    const closeBtn = sheet.locator('[data-testid="close-edit-meal-sheet-btn"]');
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox, 'Close button bounding box must not be null').not.toBeNull();

    const headerEl = sheet.locator('#edit-meal-sheet-title');
    await expect(headerEl).toBeVisible({ timeout: 5000 });
    const headerBox = await headerEl.boundingBox();
    expect(headerBox, 'Header bounding box must not be null').not.toBeNull();

    const actionsRow = sheet.locator('[data-testid="staged-card-actions"]');
    await expect(actionsRow).toBeVisible({ timeout: 5000 });
    const actionsBox = await actionsRow.boundingBox();
    expect(actionsBox, 'Actions row bounding box must not be null').not.toBeNull();
    const actionsBottom = actionsBox!.y + actionsBox!.height;

    const saveBtn = sheet.locator('[data-testid="save-edit-meal-btn"]');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    const saveBox = await saveBtn.boundingBox();
    expect(saveBox, 'Save button bounding box must not be null').not.toBeNull();

    const cancelBtn = sheet.locator('[data-testid="cancel-edit-meal-btn"]');
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    const cancelBox = await cancelBtn.boundingBox();
    expect(cancelBox, 'Cancel button bounding box must not be null').not.toBeNull();

    const starBox = await starBtn.boundingBox();
    expect(starBox, 'Star button bounding box must not be null').not.toBeNull();

    // Verify rect disjointness vs controls
    expect(
      rectsOverlap(toastBox!, closeBox!),
      `Toast overlaps Close button: toast=${formatRect(toastBox!)} vs close=${formatRect(closeBox!)}`
    ).toBe(false);

    expect(
      rectsOverlap(toastBox!, headerBox!),
      `Toast overlaps Header: toast=${formatRect(toastBox!)} vs header=${formatRect(headerBox!)}`
    ).toBe(false);

    expect(
      rectsOverlap(toastBox!, saveBox!),
      `Toast overlaps Save button: toast=${formatRect(toastBox!)} vs save=${formatRect(saveBox!)}`
    ).toBe(false);

    expect(
      rectsOverlap(toastBox!, starBox!),
      `Toast overlaps Star button: toast=${formatRect(toastBox!)} vs star=${formatRect(starBox!)}`
    ).toBe(false);

    expect(
      rectsOverlap(toastBox!, cancelBox!),
      `Toast overlaps Cancel button: toast=${formatRect(toastBox!)} vs cancel=${formatRect(cancelBox!)}`
    ).toBe(false);

    // D-YB6-5 Predicates for short meal
    const normalBottomOffset = await getNormalBottomOffset(page);
    const minAllowedBottom = viewport.height - (normalBottomOffset + 16);

    // 1. Bottom-lane predicate: toast.bottom >= viewportHeight - (normalBottomOffset + 16)
    expect(
      toastBottom,
      `[D-YB6-5 case (i) POSITION FAILURE] toast.bottom (${Math.round(toastBottom)}px) must be >= viewportHeight - (normalBottomOffset + 16) (${Math.round(minAllowedBottom)}px). ` +
      `toast=${formatRect(toastBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}], normalBottomOffset=${normalBottomOffset}`
    ).toBeGreaterThanOrEqual(minAllowedBottom);

    // 2. Relative to actions row: toast.top > actions-row bottom
    expect(
      toastTop,
      `[D-YB6-5 case (i) POSITION FAILURE] toast.top (${Math.round(toastTop)}px) must be > actions-row bottom (${Math.round(actionsBottom)}px) in short meal. ` +
      `toast=${formatRect(toastBox!)}, actions=${formatRect(actionsBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}]`
    ).toBeGreaterThan(actionsBottom);

    // 3. Dialog still open after toast shows
    await expect(sheet).toBeVisible();
  });

  test('(ii) Tall meal: actions row in bottom lane, toast sits above action row, top-most, disjoint from header/close, sheet stays open', async ({
    page,
  }, testInfo) => {
    const viewport = await configureViewport(page, testInfo);
    await loginAsAthlete(page);

    const sheet = await openEditMealSheet(page, TALL_MEAL_NAME);

    // Measure action buttons row and controls
    const actionsRow = sheet.locator('[data-testid="staged-card-actions"]');
    await expect(actionsRow).toBeVisible({ timeout: 5000 });
    const actionsBox = await actionsRow.boundingBox();
    expect(actionsBox, 'Actions row bounding box must not be null').not.toBeNull();
    const actionsTop = actionsBox!.y;
    const actionsBottom = actionsBox!.y + actionsBox!.height;

    const normalBottomOffset = await getNormalBottomOffset(page);

    // Compute and assert explicit PRECONDITION in px:
    // The tall meal must force the actions row to reach the bottom toast lane at this viewport
    // (actionsBottom >= viewportHeight - (normalBottomOffset + 48)) so it cannot degrade to short meal.
    const bottomLanePreconditionThreshold = viewport.height - (normalBottomOffset + 48);
    expect(
      actionsBottom,
      `[D-YB6-5 case (ii) PRECONDITION] Actions row must reach bottom toast lane in tall meal case! ` +
      `actionsBottom=${Math.round(actionsBottom)}px must be >= threshold ${Math.round(bottomLanePreconditionThreshold)}px. ` +
      `actions=${formatRect(actionsBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}], normalBottomOffset=${normalBottomOffset}`
    ).toBeGreaterThanOrEqual(bottomLanePreconditionThreshold);

    // Save as Custom Dish via Star button inside EditMealSheet
    const starBtn = sheet.locator('button[aria-label="Save as Custom Dish"]');
    await expect(starBtn).toBeVisible({ timeout: 10000 });
    await starBtn.click();

    // Toast "Saved custom dish" appears
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('Saved custom dish');

    // Measure toast bounding box
    const toastBox = await toast.boundingBox();
    expect(toastBox, 'Toast bounding box must not be null').not.toBeNull();
    const toastBottom = toastBox!.y + toastBox!.height;

    // Hit test: topmost element at toast centre point MUST be inside the toast
    const centerCoordX = toastBox!.x + toastBox!.width / 2;
    const centerCoordY = toastBox!.y + toastBox!.height / 2;
    const hitResult = await page.evaluate(
      ({ posX, posY }) => {
        const targetElement = document.elementFromPoint(posX, posY);
        const toastElement = targetElement?.closest('[data-testid="quick-log-toast"]');
        return {
          insideToast: Boolean(toastElement),
          elementDesc: targetElement
            ? `${targetElement.tagName.toLowerCase()}${targetElement.id ? '#' + targetElement.id : ''}${
                targetElement.className ? '.' + targetElement.className.split(/\s+/).slice(0, 2).join('.') : ''
              }`
            : 'null',
          testId: targetElement?.getAttribute('data-testid') ?? null,
        };
      },
      { posX: centerCoordX, posY: centerCoordY }
    );

    expect(
      hitResult.insideToast,
      `elementFromPoint at center (${Math.round(centerCoordX)}, ${Math.round(centerCoordY)}) hit <${hitResult.elementDesc}> (data-testid="${hitResult.testId}") instead of toast. toast=${formatRect(toastBox!)}`
    ).toBe(true);

    // Measure close button and header
    const closeBtn = sheet.locator('[data-testid="close-edit-meal-sheet-btn"]');
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox, 'Close button bounding box must not be null').not.toBeNull();

    const headerEl = sheet.locator('#edit-meal-sheet-title');
    await expect(headerEl).toBeVisible({ timeout: 5000 });
    const headerBox = await headerEl.boundingBox();
    expect(headerBox, 'Header bounding box must not be null').not.toBeNull();

    // D-YB6-5 Predicates for tall meal:
    // 1. Toast sits above the action row (toast.bottom <= actionsTop - 4)
    expect(
      toastBottom,
      `[D-YB6-5 case (ii) POSITION FAILURE] toast.bottom (${Math.round(toastBottom)}px) must sit above actions row (<= actionsTop - 4 (${Math.round(actionsTop - 4)}px)). ` +
      `toast=${formatRect(toastBox!)}, actions=${formatRect(actionsBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}]`
    ).toBeLessThanOrEqual(actionsTop - 4);

    // 2. Toast sits directly above the action row in the lower part of the sheet:
    // toastBottom >= actionsTop - (toastBox.height + 32)
    const minAllowedToastBottomTall = actionsTop - (toastBox!.height + 32);
    expect(
      toastBottom,
      `[D-YB6-5 case (ii) POSITION FAILURE] toast.bottom (${Math.round(toastBottom)}px) must sit directly above actions row (>= actionsTop - (toastHeight + 32) (${Math.round(minAllowedToastBottomTall)}px)). ` +
      `toast=${formatRect(toastBox!)}, actions=${formatRect(actionsBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}]`
    ).toBeGreaterThanOrEqual(minAllowedToastBottomTall);

    // Disjoint from close button and header
    expect(
      rectsOverlap(toastBox!, closeBox!),
      `Toast overlaps Close button: toast=${formatRect(toastBox!)} vs close=${formatRect(closeBox!)}`
    ).toBe(false);

    expect(
      rectsOverlap(toastBox!, headerBox!),
      `Toast overlaps Header: toast=${formatRect(toastBox!)} vs header=${formatRect(headerBox!)}`
    ).toBe(false);

    // Dialog still open after toast shows
    await expect(sheet).toBeVisible();
  });

  test('(iii) CustomDishesModal New Dish save: bottom-anchored, top-most, disjoint from controls', async ({
    page,
  }, testInfo) => {
    const viewport = await configureViewport(page, testInfo);
    await loginAsAthlete(page);

    await page.goto('/nutrition');
    await expect(page.locator("text=Today's Nutrition")).toBeVisible({ timeout: 15000 });

    // Open "New Dish" modal
    const newDishBtn = page.locator('[data-testid="create-custom-dish-btn"]');
    await expect(newDishBtn).toBeVisible({ timeout: 10000 });
    await newDishBtn.click();

    const modal = page.locator('[data-testid="custom-dish-modal"]');
    await expect(modal).toBeVisible({ timeout: 10000 });

    const dishName = `YB6 Custom Dish ${Date.now()}`;
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

    // CustomDishesModal closes synchronously on save (handleSaveCustomDishModal calls
    // handleCloseDishModal which unmounts the modal), so no modal controls remain to collide with.
    await expect(page.locator('[data-testid="custom-dish-modal"]')).toBeHidden();

    // Measure toast bounding box
    const toastBox = await toast.boundingBox();
    expect(toastBox, 'Toast bounding box must not be null').not.toBeNull();
    const toastBottom = toastBox!.y + toastBox!.height;

    // Hit test: topmost element at centre point must be inside toast
    const centerCoordX = toastBox!.x + toastBox!.width / 2;
    const centerCoordY = toastBox!.y + toastBox!.height / 2;
    const hitResult = await page.evaluate(
      ({ posX, posY }) => {
        const targetElement = document.elementFromPoint(posX, posY);
        const toastElement = targetElement?.closest('[data-testid="quick-log-toast"]');
        return {
          insideToast: Boolean(toastElement),
          elementDesc: targetElement
            ? `${targetElement.tagName.toLowerCase()}${targetElement.id ? '#' + targetElement.id : ''}${
                targetElement.className ? '.' + targetElement.className.split(/\s+/).slice(0, 2).join('.') : ''
              }`
            : 'null',
          testId: targetElement?.getAttribute('data-testid') ?? null,
        };
      },
      { posX: centerCoordX, posY: centerCoordY }
    );

    expect(
      hitResult.insideToast,
      `elementFromPoint at center (${Math.round(centerCoordX)}, ${Math.round(centerCoordY)}) hit <${hitResult.elementDesc}> (data-testid="${hitResult.testId}") instead of toast. toast=${formatRect(toastBox!)}`
    ).toBe(true);

    // Bottom-lane predicate: toast.bottom >= viewportHeight - (normalBottomOffset + 16)
    const normalBottomOffset = await getNormalBottomOffset(page);
    const minAllowedBottom = viewport.height - (normalBottomOffset + 16);

    expect(
      toastBottom,
      `[D-YB6-5 case (iii) POSITION FAILURE] toast.bottom (${Math.round(toastBottom)}px) must be >= viewportHeight - (normalBottomOffset + 16) (${Math.round(minAllowedBottom)}px). ` +
      `toast=${formatRect(toastBox!)}, viewport=[w=${viewport.width}, h=${viewport.height}], normalBottomOffset=${normalBottomOffset}`
    ).toBeGreaterThanOrEqual(minAllowedBottom);
  });
});
