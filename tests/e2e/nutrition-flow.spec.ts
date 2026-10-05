import { test, expect, type Page } from '@playwright/test';

/**
 * Remove one meal row with this name through the UI and assert it is gone.
 *
 * Every test that commits a meal must call this. These specs run in five
 * projects on every invocation and used to leave every row behind: the fixture
 * account had accumulated 345 rows, and rendering that timeline was slow enough
 * to time Mobile Safari out for real. Deleting also proves the destructive
 * action works rather than merely that its label is present.
 *
 * Identified by the row's log id, not by a row count. `count()` then
 * `toHaveCount(count - 1)` races the refetch that follows the commit: if the
 * just-logged row renders *after* the count is taken, the target is one too low
 * and never arrives. That is not hypothetical — it failed in three of the five
 * projects, on a timeline that already held a dozen identically named rows.
 */
async function deleteMealRow(page: Page, name: string) {
  const row = page.locator('[data-testid="meal-log-item"]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();

  // `meal-actions-<log id>` on the trigger, `delete-meal-<log id>` on the item.
  const trigger = row.locator('button[aria-haspopup="menu"]');
  await expect(trigger).toBeVisible();
  const testId = await trigger.getAttribute('data-testid');
  const id = (testId ?? '').replace('meal-actions-', '');
  expect(id).not.toBe('');

  await trigger.click();
  const deleteItem = row.locator('[role="menuitem"]').filter({ hasText: 'Delete meal' });
  await expect(deleteItem).toBeVisible();
  await deleteItem.click();

  // That exact row, not "one fewer row than a moment ago".
  await expect(page.locator(`[data-testid="meal-actions-${id}"]`)).toHaveCount(0);
}

async function safeGoto(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch {
    await page.goto(url);
  }
}

test.describe('Nutrition Flow E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Automatically accept window.confirm dialogs (e.g. meal deletion confirmation)
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    // Intercept Supabase Edge Function to provide deterministic AI parsing without local Gemini runtime dependency
    await page.route('**/functions/v1/parse-nutrition', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
            'access-control-allow-methods': 'POST, OPTIONS',
          },
        });
        return;
      }

      const postData = route.request().postDataJSON() || {};
      const promptText = (postData.input || postData.prompt || '').toLowerCase();

      if (promptText.includes('banana')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            items: [
              { name: 'Banana', portion: '1 medium', quantity: 1, unit: 'unit', calories: 105, protein: 1.3, carbs: 27, fat: 0.3, fiber: 3.1 },
            ],
          }),
        });
        return;
      }

      if (promptText.includes('chicken rice') || promptText.includes('curry bowl')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            name: 'Chicken Rice & Eggs',
            calories: 650,
            protein: 38,
            carbs: 70,
            fat: 23,
            fiber: 1,
            explanation: '300 kcal (Steamed Rice Bowl) + 260 kcal (Grilled Chicken Breast) + 90 kcal (Fried Egg) = 650 kcal',
            items: [
              { name: 'Steamed Rice Bowl', portion: '1.5 cups (240g)', calories: 300, protein: 6, carbs: 65, fat: 1, fiber: 1 },
              { name: 'Grilled Chicken Breast', portion: '1 breast (120g)', calories: 260, protein: 26, carbs: 4, fat: 15, fiber: 0 },
              { name: 'Fried Egg', portion: '1 large', calories: 90, protein: 6, carbs: 1, fat: 7, fiber: 0 },
            ],
          }),
        });
        return;
      }

      if (promptText.includes('friday menu') || promptText.includes('chia pudding')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            name: 'High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)',
            calories: 550,
            protein: 46,
            carbs: 24,
            fat: 30,
            fiber: 8,
            serving_size: 510,
            serving_unit: 'g',
            explanation: '87 kcal (Egg White) + 80 kcal (Turkey) + 68 kcal (Salmon) + 227 kcal (Chia) + 88 kcal (Yogurt) = 550 kcal',
            items: [
              { name: 'Scrambled Egg White (with hot sauce & black pepper)', portion: '150 g', calories: 87, protein: 14, carbs: 1, fat: 3, fiber: 0 },
              { name: 'Sliced Turkey Breast', portion: '60 g', calories: 80, protein: 10, carbs: 1, fat: 4, fiber: 0 },
              { name: 'Smoked Salmon', portion: '50 g', calories: 68, protein: 8, carbs: 0, fat: 4, fiber: 0 },
              { name: 'Chocolate Coconut Chia Pudding', portion: '150 g', calories: 227, protein: 5, carbs: 18, fat: 15, fiber: 8 },
              { name: '2% Plain Greek Yogurt', portion: '100 g', calories: 88, protein: 9, carbs: 4, fat: 4, fiber: 0 },
            ],
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({
          name: 'Eggs, Toast & Butter',
          calories: 470,
          protein: 24,
          carbs: 32,
          fat: 28,
          fiber: 2,
          explanation: '210 kcal (Eggs) + 160 kcal (Toast) + 100 kcal (Butter) = 470 kcal',
          items: [
            { name: 'Eggs', portion: '3 large', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
            { name: 'Sourdough Toast', portion: '2 slices', calories: 160, protein: 5, carbs: 30, fat: 1, fiber: 2 },
            { name: 'Butter', portion: '1 tbsp', calories: 100, protein: 1, carbs: 0, fat: 12, fiber: 0 },
          ],
        }),
      });
    });

    await safeGoto(page, '/login');
    await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/workout');
    await safeGoto(page, '/nutrition');
    await page.waitForSelector('text=Today\'s Nutrition');
  });

  test('renders 5-ring/card macro dashboard and conversational analysis input', async ({ page }) => {
    // Assert macro dashboard items
    await expect(page.locator('text=Calories').first()).toBeVisible();
    await expect(page.locator('text=Protein').first()).toBeVisible();
    await expect(page.locator('text=Carbs').first()).toBeVisible();
    await expect(page.locator('text=Fat').first()).toBeVisible();
    await expect(page.locator('text=Fiber').first()).toBeVisible();

    // Assert conversational textarea
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await expect(nlTextarea).toBeVisible();

    // Assert Analyze button
    const analyzeBtn = page.locator('button:has-text("Analyze Meal")');
    await expect(analyzeBtn).toBeVisible();
  });

  test('allows manual meal entry and displays logged meal in timeline', async ({ page }) => {
    // Toggle manual form
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }

    // Fill manual entry fields
    const dishInput = page.locator('[data-testid="dish-name-input"]');
    await dishInput.fill('Playwright Test Chicken & Rice');

    const calInput = page.locator('[data-testid="calories-input"]');
    await calInput.fill('500');

    const proInput = page.locator('[data-testid="protein-input"]');
    await proInput.fill('45');

    const carbsInput = page.locator('[data-testid="carbs-input"]');
    await carbsInput.fill('60');

    const fatInput = page.locator('[data-testid="fat-input"]');
    await fatInput.fill('10');

    const fiberInput = page.locator('[data-testid="fiber-input"]');
    if (await fiberInput.isVisible()) {
      await fiberInput.fill('5');
    }

    // Submit manual form (stages meal into StagedMealCard per D22)
    const logBtn = page.locator('button:has-text("Log Meal")').last();
    await logBtn.click();

    // Commit staged meal to log (A1: keyboard activate Log button, verify focus restore)
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();
    const commitLogBtn = stagedCard.locator('button:has-text("Log Meal")');
    await commitLogBtn.focus();
    await page.keyboard.press('Enter');
    await expect(stagedCard).not.toBeVisible();

    // A1 check: after logging, focus is restored to the AI input textarea
    const aiTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await expect(aiTextarea).toBeFocused();

    // Verify meal is displayed in today's meals timeline
    await expect(page.locator('text=Playwright Test Chicken & Rice').first()).toBeVisible();

    // Edit and Delete now live behind one overflow trigger so the row fits a
    // 320 px viewport. The trigger carries the touch-target guarantee that the
    // two icon buttons used to.
    // `.first()` is load-bearing, not defensive: this test seeds a meal with a
    // fixed name on every run, and the fixture account still carries the
    // backlog of copies left behind before the test was made self-cleaning
    // (below). Without it the locator resolves to all of them and Playwright's
    // strict mode throws before asserting anything.
    const row = page
      .locator('[data-testid="meal-log-item"]')
      .filter({ hasText: 'Playwright Test Chicken & Rice' })
      .first();
    const actionsBtn = row.locator('button[aria-haspopup="menu"]');
    await expect(actionsBtn).toBeVisible();
    const box = await actionsBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);

    // The destructive action must still be reachable, not merely relabelled.
    const id = ((await actionsBtn.getAttribute('data-testid')) ?? '').replace('meal-actions-', '');
    expect(id).not.toBe('');
    await actionsBtn.click();
    const deleteItem = row.locator('[role="menuitem"]').filter({ hasText: 'Delete meal' });
    await expect(deleteItem).toBeVisible();

    // Actually delete instead of pressing Escape. This test seeds a row on every
    // run in every project and used to leave it behind forever; the backlog had
    // reached 96 copies, and rendering that timeline was slow enough to make the
    // assertions above time out intermittently on WebKit. Deleting keeps the
    // fixture net-neutral and proves the action works rather than merely that
    // its label is present.
    //
    // Asserted by id, not by "one fewer than before": a count taken while the
    // timeline is still settling after the commit makes `before - 1` a target
    // that never arrives.
    await deleteItem.click();
    await expect(page.locator(`[data-testid="meal-actions-${id}"]`)).toHaveCount(0);
  });

  test.describe('touch tap (Finding #5)', () => {
    test.use({ hasTouch: true });

    test('touch tap on Log Meal does NOT focus AI textarea (Finding #5)', async ({ page }) => {
      // Toggle manual form
      const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
      if (await manualToggleBtn.isVisible()) {
        await manualToggleBtn.click();
      }

      const dishInput = page.locator('[data-testid="dish-name-input"]');
      await dishInput.fill('Playwright Touch Tap Meal');

      const calInput = page.locator('[data-testid="calories-input"]');
      await calInput.fill('400');

      // Submit manual form (stages meal into StagedMealCard per D22)
      const logBtn = page.locator('button:has-text("Log Meal")').last();
      await logBtn.click();

      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible();

      // Finding #5 check: tap() with touch does NOT focus AI textarea
      const commitLogBtn = stagedCard.locator('button:has-text("Log Meal")');
      await commitLogBtn.tap();
      await expect(stagedCard).not.toBeVisible();

      const aiTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
      await expect(aiTextarea).not.toBeFocused();

      // Clean up logged meal
      await deleteMealRow(page, 'Playwright Touch Tap Meal');
    });
  });

  test('submits conversational meal prompt, interacts with staged card and quick log', async ({ page }) => {
    // Fill conversational prompt
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await nlTextarea.fill('3 large eggs, 2 slices sourdough toast, 1 tbsp butter');

    // Click Analyze Meal
    const analyzeBtn = page.locator('button:has-text("Analyze Meal")');
    await analyzeBtn.click();

    // Verify staged meal card appears with breakdown
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 15000 });
    // D46: below 390px the breakdown header reads "Items (n)"; from 390px up it reads "Itemized Breakdown (n)".
    const isNarrow = (page.viewportSize()?.width ?? 390) < 390;
    await expect(
      stagedCard.getByText(isNarrow ? /^Items \(\d+\)$/ : /^Itemized Breakdown \(\d+\)$/),
    ).toBeVisible();
    await expect(page.locator('text=Eggs').first()).toBeVisible();

    // D17/D32: typed [qty][unit] box with 44px hit area wrapper and 32px visible box.
    // The hit area meets the >= 40px touch target, and typing quantity + Enter saves.
    const quantityField = page.locator('[data-testid="component-quantity-field"]').first();
    await expect(quantityField).toBeVisible();
    const fieldBox = await quantityField.boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(fieldBox!.width).toBeGreaterThanOrEqual(40);
    expect(fieldBox!.height).toBeGreaterThanOrEqual(40);
    const quantityInput = page.locator('[data-testid="component-quantity-input"]').first();
    await expect(quantityInput).toBeVisible();
    await quantityInput.fill('4');
    await quantityInput.press('Enter');
    await expect(quantityInput).toHaveValue('4');

    // Verify Log Meal button is visible on staged card and commit
    const commitStagedBtn = stagedCard.locator('button:has-text("Log Meal")');
    await expect(commitStagedBtn).toBeVisible();
    await commitStagedBtn.click();

    // Staged card should clear
    await expect(stagedCard).not.toBeVisible();
    await expect(page.locator('[data-testid="meal-log-item"]').filter({ hasText: 'Eggs, Toast & Butter' }).first()).toBeVisible();

    // Net-neutral: remove the row this test just committed.
    await deleteMealRow(page, 'Eggs, Toast & Butter');
  });

  test('analyzes multi-dish conversational meal "I ate Chicken Rice & Eggs" and elaborates all component items', async ({ page }) => {
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await nlTextarea.fill('I ate Chicken Rice & Eggs');

    const analyzeBtn = page.locator('button:has-text("Analyze Meal")');
    await analyzeBtn.click();

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 15000 });

    // Assert meal name and all elaborated components
    const nameInput = stagedCard.locator('[data-testid="dish-name-input"]');
    await expect(nameInput).toHaveValue('Chicken Rice & Eggs');

    await expect(stagedCard.getByText('Steamed Rice Bowl', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('Grilled Chicken Breast', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('Fried Egg', { exact: true })).toBeVisible();

    // Verify commit button has 650 kcal
    const commitBtn = stagedCard.locator('button:has-text("Log Meal (+650 kcal)")');
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();

    // Verify meal is logged
    await expect(stagedCard).not.toBeVisible();
    await expect(page.locator('text=Chicken Rice & Eggs').first()).toBeVisible();

    // Net-neutral: remove the row this test just committed.
    await deleteMealRow(page, 'Chicken Rice & Eggs');
  });

  test('preserves exact pre-analyzed structured breakdown text verbatim with exact totals', async ({ page }) => {
    const structuredInput = `Food Item: High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)
Total Portion Size: 510 g

Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 150 g | 87 kcal | 14 g P | 1 g C | 3 g F | 0 g Fiber
* Sliced Turkey Breast: 60 g | 80 kcal | 10 g P | 1 g C | 4 g F | 0 g Fiber
* Smoked Salmon: 50 g | 68 kcal | 8 g P | 0 g C | 4 g F | 0 g Fiber
* Chocolate Coconut Chia Pudding: 150 g | 227 kcal | 5 g P | 18 g C | 15 g F | 8 g Fiber
* 2% Plain Greek Yogurt: 100 g | 88 kcal | 9 g P | 4 g C | 4 g F | 0 g Fiber

Total Calories: 550 kcal
Total Protein: 46 g
Total Carbs: 24 g
Total Fat: 30 g
Total Fiber: 8 g`;

    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await nlTextarea.fill(structuredInput);

    const analyzeBtn = page.locator('button:has-text("Analyze Meal")');
    await analyzeBtn.click();

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 15000 });

    // Assert title
    const nameInput = stagedCard.locator('[data-testid="dish-name-input"]');
    await expect(nameInput).toHaveValue('High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)');

    // Assert all 5 component items
    await expect(stagedCard.getByText('Scrambled Egg White (with hot sauce & black pepper)', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('Sliced Turkey Breast', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('Smoked Salmon', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('Chocolate Coconut Chia Pudding', { exact: true })).toBeVisible();
    await expect(stagedCard.getByText('2% Plain Greek Yogurt', { exact: true })).toBeVisible();

    // Assert all 5 component items exist and read each item's macros
    const rows = stagedCard.locator('[data-testid="component-row"]');
    await expect(rows).toHaveCount(5);

    let sumCalories = 0;
    let sumProtein = 0;
    let sumCarbs = 0;
    let sumFat = 0;
    let sumFiber = 0;

    for (let i = 0; i < 5; i++) {
      const row = rows.nth(i);
      const cal = parseFloat(await row.locator('[data-testid="component-macro-calories"] [data-testid="macro-val-calories"]').innerText());
      const pro = parseFloat(await row.locator('[data-testid="component-macro-protein"] [data-testid="macro-val-protein"]').innerText());
      const carbs = parseFloat(await row.locator('[data-testid="component-macro-carbs"] [data-testid="macro-val-carbs"]').innerText());
      const fat = parseFloat(await row.locator('[data-testid="component-macro-fat"] [data-testid="macro-val-fat"]').innerText());
      const fiber = parseFloat(await row.locator('[data-testid="component-macro-fiber"] [data-testid="macro-val-fiber"]').innerText());

      sumCalories += cal;
      sumProtein += pro;
      sumCarbs += carbs;
      sumFat += fat;
      sumFiber += fiber;
    }

    sumCalories = Math.round(sumCalories);
    sumProtein = Math.round(sumProtein * 10) / 10;
    sumCarbs = Math.round(sumCarbs * 10) / 10;
    sumFat = Math.round(sumFat * 10) / 10;
    sumFiber = Math.round(sumFiber * 10) / 10;

    // Verify individual items sum to the expected pre-analyzed totals
    expect(sumCalories).toBe(550);
    expect(sumProtein).toBe(46);
    expect(sumCarbs).toBe(24);
    expect(sumFat).toBe(30);
    expect(sumFiber).toBe(8);

    // Assert read-only staged totals (Fix D5) equal the sum of items
    await expect(stagedCard.locator('[data-testid="staged-total-calories"] [data-testid="macro-val-calories"]')).toHaveText(String(sumCalories));
    await expect(stagedCard.locator('[data-testid="staged-total-protein"] [data-testid="macro-val-protein"]')).toHaveText(String(sumProtein));
    await expect(stagedCard.locator('[data-testid="staged-total-carbs"] [data-testid="macro-val-carbs"]')).toHaveText(String(sumCarbs));
    await expect(stagedCard.locator('[data-testid="staged-total-fat"] [data-testid="macro-val-fat"]')).toHaveText(String(sumFat));
    await expect(stagedCard.locator('[data-testid="staged-total-fiber"] [data-testid="macro-val-fiber"]')).toHaveText(String(sumFiber));

    await expect(stagedCard.locator('[data-testid="staged-total-calories"]')).toContainText(`${sumCalories} kcal`);
    await expect(stagedCard.locator('[data-testid="staged-total-protein"]')).toContainText(`${sumProtein} P`);
    await expect(stagedCard.locator('[data-testid="staged-total-carbs"]')).toContainText(`${sumCarbs} C`);
    await expect(stagedCard.locator('[data-testid="staged-total-fat"]')).toContainText(`${sumFat} F`);
    await expect(stagedCard.locator('[data-testid="staged-total-fiber"]')).toContainText(`${sumFiber} Fib`);

    // Commit meal
    const commitBtn = stagedCard.locator(`button:has-text("Log Meal (+${sumCalories} kcal)")`);
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();

    await expect(stagedCard).not.toBeVisible();
    const loggedRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: 'High-Protein Breakfast Plate' }).first();
    await expect(loggedRow).toBeVisible();

    // Assert logged meal row displays exact totals matching the staged totals
    await expect(loggedRow.locator(`text=${sumCalories} kcal`)).toBeVisible();
    await expect(loggedRow.locator(`text=P ${sumProtein}`)).toBeVisible();
    await expect(loggedRow.locator(`text=C ${sumCarbs}`)).toBeVisible();
    await expect(loggedRow.locator(`text=F ${sumFat}`)).toBeVisible();
    await expect(loggedRow.locator(`text=Fib ${sumFiber}`)).toBeVisible();

    // Net-neutral: remove the row this test just committed.
    await deleteMealRow(page, 'High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)');
  });

  test('allows editing a logged meal in today timeline and history view with updated macros (D44)', async ({ page }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const originalMealName = `Meal-${uniqueSuffix}`;
    const historyMealName = `History-${uniqueSuffix}`;

    // 1. Stage a 2-item meal via manual entry + add item
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }

    const dishInput = page.locator('[data-testid="dish-name-input"]');
    await dishInput.fill(originalMealName);
    await page.locator('[data-testid="calories-input"]').fill('300');
    await page.locator('[data-testid="protein-input"]').fill('25');
    await page.locator('[data-testid="carbs-input"]').fill('35');
    await page.locator('[data-testid="fat-input"]').fill('5');

    const logBtn = page.locator('button:has-text("Log Meal")').last();
    await logBtn.click();

    // Staged card is open, add second item
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();

    const addItemBtn = stagedCard.locator('[data-testid="add-item-button"]');
    await expect(addItemBtn).toBeVisible();
    await addItemBtn.click();
    await stagedCard.locator('[data-testid="enter-manually-button"]').click();

    const addItemForm = stagedCard.locator('[data-testid="add-item-form"]');
    await expect(addItemForm).toBeVisible();
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Side Salad');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('100');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('g');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('100');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('2');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('8');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('5');
    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();
    await expect(addItemForm).not.toBeVisible();

    // Commit 2-item meal (300 + 100 = 400 kcal)
    const commitBtn = stagedCard.locator('button:has-text("Log Meal (+400 kcal)")');
    await expect(commitBtn).toBeVisible();
    await commitBtn.click();
    await expect(stagedCard).not.toBeVisible();

    // Verify 2-item meal in today timeline
    const originalRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: originalMealName });
    await expect(originalRow).toBeVisible();
    await expect(originalRow.locator('text=400 kcal')).toBeVisible();

    // 2. Open row overflow menu and pick Edit meal (D44 EditMealSheet)
    const actionsBtn = originalRow.locator('button[aria-haspopup="menu"]');
    await expect(actionsBtn).toBeVisible();

    // Verify touch target for overflow trigger >= 40px
    const editBox = await actionsBtn.boundingBox();
    expect(editBox).not.toBeNull();
    expect(editBox!.width).toBeGreaterThanOrEqual(40);
    expect(editBox!.height).toBeGreaterThanOrEqual(40);

    await actionsBtn.click();
    const editBtn = originalRow.locator('[role="menuitem"]', { hasText: 'Edit meal' });
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Verify EditMealSheet appears
    const sheet = page.locator('[data-testid="edit-meal-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('text=Edit Meal')).toBeVisible();

    // Edit component quantity: change Side Salad from 100g to 200g (300 + 200 = 500 kcal)
    const qtyInputs = sheet.locator('[data-testid="component-quantity-input"]');
    await expect(qtyInputs.nth(1)).toBeVisible();
    await qtyInputs.nth(1).fill('200');
    await qtyInputs.nth(1).press('Enter');
    await expect(qtyInputs.nth(1)).toHaveValue('200');

    // Change date to yesterday
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    const dateInput = sheet.locator('[data-testid="edit-meal-date-input"]');
    await expect(dateInput).toBeVisible();
    await dateInput.fill(yStr);

    // Save changes
    const saveBtn = sheet.locator('[data-testid="save-edit-meal-btn"]');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Sheet closes
    await expect(sheet).not.toBeVisible();

    // Row has moved out of today timeline (since date is yesterday)
    await expect(page.locator('[data-testid="meal-log-item"]').filter({ hasText: originalMealName })).toHaveCount(0);

    // Toast shows Updated variant with Undo button
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Updated");
    await expect(toast).toContainText("500 kcal");

    const undoBtn = page.locator('[data-testid="toast-undo-btn"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Toast closes and meal is restored back to today with original 400 kcal
    await expect(toast).not.toBeVisible();
    const restoredRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: originalMealName });
    await expect(restoredRow).toBeVisible();
    await expect(restoredRow.locator('text=400 kcal')).toBeVisible();

    // 3. Navigate to /history, switch to Nutrition, and verify edit works there as well
    await safeGoto(page, '/history');
    await expect(page.locator('text=Workout History')).toBeVisible();

    const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
    await nutritionTab.click();
    await expect(page.locator('text=Nutrition History')).toBeVisible();

    // Days start collapsed by default (D-YB-9). Expand day to reveal meals.
    const expandBtn = page.locator('button[data-testid^="expand-day-btn-"]').first();
    await expect(expandBtn).toBeVisible({ timeout: 10000 });
    await expandBtn.click();

    // Verify originalMealName is visible in history
    const historyRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: originalMealName });
    await expect(historyRow).toBeVisible();

    // Open row overflow menu, pick Edit meal
    await historyRow.locator('button[aria-haspopup="menu"]').click();
    const historyEditBtn = historyRow.locator('[role="menuitem"]', { hasText: 'Edit meal' });
    await expect(historyEditBtn).toBeVisible();
    await historyEditBtn.click();

    await expect(sheet).toBeVisible();
    const nameInput = sheet.locator('[data-testid="dish-name-input"]');
    await expect(nameInput).toHaveValue(originalMealName);

    // Change name in history
    await nameInput.fill(historyMealName);
    await sheet.locator('[data-testid="save-edit-meal-btn"]').click();
    await expect(sheet).not.toBeVisible();
    await expect(page.locator('text=' + historyMealName).first()).toBeVisible();

    // Net-neutral: clean up
    await deleteMealRow(page, historyMealName);
  });
test('manual form stages meal, adds item with updated totals, and logs to timeline (D22)', async ({ page }) => {
    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const manualMealName = `Manual Multi-Item ${uniqueSuffix}`;

    // 1. Toggle manual form
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }

    // 2. Fill manual entry fields
    await page.locator('[data-testid="dish-name-input"]').fill(manualMealName);
    await page.locator('[data-testid="calories-input"]').fill('300');
    await page.locator('[data-testid="protein-input"]').fill('25');
    await page.locator('[data-testid="carbs-input"]').fill('35');
    await page.locator('[data-testid="fat-input"]').fill('5');
    const fiberInput = page.locator('[data-testid="fiber-input"]');
    if (await fiberInput.isVisible()) {
      await fiberInput.fill('4');
    }

    // 3. Stage the meal
    const stageBtn = page.locator('button:has-text("Log Meal")').last();
    await stageBtn.click();

    // 4. Assert staged card is visible, but meal is NOT yet logged in timeline
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();
    await expect(page.locator('[data-testid="meal-log-item"]').filter({ hasText: manualMealName })).toHaveCount(0);

    // 5. Click "+ Add item"
    const addItemBtn = stagedCard.locator('[data-testid="add-item-button"]');
    await expect(addItemBtn).toBeVisible();
    await addItemBtn.click();
    await stagedCard.locator('[data-testid="enter-manually-button"]').click();

    // 6. Fill AddItemForm
    const addItemForm = stagedCard.locator('[data-testid="add-item-form"]');
    await expect(addItemForm).toBeVisible();
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Extra Avocado');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('50');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('g');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('80');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('1');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('4');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('7');
    await addItemForm.locator('[data-testid="add-item-fiber-input"]').fill('3');

    // Submit AddItemForm
    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();
    await expect(addItemForm).not.toBeVisible();

    // 7. Verify 2 items in staged card, and totals equal Σ (300 + 80 = 380 kcal)
    const commitBtn = stagedCard.locator('button:has-text("Log Meal (+380 kcal)")');
    await expect(commitBtn).toBeVisible();

    // 8. Commit Log Meal
    await commitBtn.click();
    await expect(stagedCard).not.toBeVisible();

    // 9. Verify logged meal row in timeline with combined totals (380 kcal)
    const loggedRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: manualMealName }).first();
    await expect(loggedRow).toBeVisible();
    await expect(loggedRow.locator('text=380 kcal')).toBeVisible();

    // 10. Delete row to remain net-neutral
    await deleteMealRow(page, manualMealName);
  });

  test('while meal is staged, Quick Log favorite appends items to staged meal and commits (D33)', async ({ page }) => {
    const favoriteDish = {
      id: 'dish-almonds-fav',
      user_id: 'test-user',
      name: 'Roasted Almonds',
      calories: 160,
      protein: 6,
      carbs: 6,
      fat: 14,
      fiber: 3,
      created_at: new Date().toISOString(),
      kind: 'food',
      use_count: 5,
      notes: null,
      items: [
        {
          id: 'item-almond-1',
          name: 'Roasted Almonds',
          displayPortion: '1 oz',
          quantity: 1,
          unit: 'oz',
          calories: 160,
          protein: 6,
          carbs: 6,
          fat: 14,
          fiber: 3,
        },
      ],
    };

    await page.route('**/rest/v1/custom_dishes*', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
          },
        });
        return;
      }
      const url = route.request().url();
      if (url.includes('id=eq.')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify([favoriteDish]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'content-range': '0-0/1',
        },
        body: JSON.stringify([favoriteDish]),
      });
    });

    await page.route('**/rest/v1/rpc/increment_dish_use_count*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({}),
      });
    });

    const evalRes = await page.evaluate(async () => {
      const openReq = indexedDB.open('yourbody-offline-a0000000-0000-0000-0000-000000000002');
      return new Promise<string>((resolve) => {
        openReq.onsuccess = () => {
          const db = openReq.result;
          if (db.objectStoreNames.contains('rq')) {
            const tx = db.transaction(['rq'], 'readwrite');
            tx.objectStore('rq').clear();
            tx.oncomplete = () => {
              db.close();
              resolve('rq-cleared');
            };
            tx.onerror = () => {
              db.close();
              resolve('tx-error: ' + String(tx.error));
            };
          } else {
            db.close();
            resolve('no-rq-store');
          }
        };
        openReq.onerror = () => resolve('open-error: ' + String(openReq.error));
        openReq.onblocked = () => resolve('open-blocked');
      });
    });
    // O2 persists ['custom_dishes', uid] in the per-user rq store; clear it so the route mock above is what loads.
    expect(evalRes).toMatch(/^(rq-cleared|no-rq-store)$/);

    await safeGoto(page, '/nutrition');
    await page.waitForSelector("text=Today's Nutrition");

    // Initially heading is "Quick Log Favorites"
    await expect(page.locator('section').filter({ hasText: 'Quick Log Favorites' })).toBeVisible();
    await expect(page.locator('[data-testid="custom-dish-card-dish-almonds-fav"]')).toBeVisible();

    // Stage a meal via Manual Entry
    const manualMealName = `D33 Greek Yogurt ${Date.now()}`;
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }
    await page.locator('[data-testid="dish-name-input"]').fill(manualMealName);
    await page.locator('[data-testid="calories-input"]').fill('150');
    await page.locator('[data-testid="protein-input"]').fill('15');
    await page.locator('[data-testid="carbs-input"]').fill('10');
    await page.locator('[data-testid="fat-input"]').fill('2');
    const fiberInput = page.locator('[data-testid="fiber-input"]');
    if (await fiberInput.isVisible()) {
      await fiberInput.fill('0');
    }
    await page.locator('button:has-text("Log Meal")').last().click();

    // Staged card is visible
    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible();

    // Heading switches to "Add to staged meal"
    await expect(page.locator('section').filter({ hasText: 'Add to staged meal' })).toBeVisible();

    // Plus button aria-label includes "Add Roasted Almonds to staged meal"
    const plusBtn = page.locator('[data-testid="quick-log-btn-dish-almonds-fav"]');
    await expect(plusBtn).toHaveAttribute('aria-label', /Add Roasted Almonds to staged meal/i);

    // Click plus button to append Roasted Almonds
    await plusBtn.click();

    // Toast with Undo is visible (D41)
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Added to meal');
    await expect(toast).toContainText('Roasted Almonds');

    // Totals updated: 150 + 160 = 310 kcal
    const commitBtn = stagedCard.locator('button:has-text("Log Meal (+310 kcal)")');
    await expect(commitBtn).toBeVisible();

    // Commit staged meal
    await commitBtn.click();
    await expect(stagedCard).not.toBeVisible();

    // Verify logged meal row in timeline with combined totals (310 kcal)
    const loggedRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: manualMealName }).first();
    await expect(loggedRow).toBeVisible();
    await expect(loggedRow.locator('text=310 kcal')).toBeVisible();

    // Net-neutral: remove the row
    await deleteMealRow(page, manualMealName);
  });

  test('direct quick log -> Undo removes created row from timeline (D42)', async ({ page }) => {
    const dishName = `Quick Dish ${Date.now()}`;
    const favoriteDish = {
      id: `dish-d42-${Date.now()}`,
      user_id: 'test-user',
      name: dishName,
      calories: 220,
      protein: 20,
      carbs: 10,
      fat: 10,
      fiber: 2,
      created_at: new Date().toISOString(),
      kind: 'dish',
      use_count: 5,
      notes: null,
    };

    await page.route('**/rest/v1/custom_dishes*', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
          'content-range': '0-0/1',
        },
        body: JSON.stringify([favoriteDish]),
      });
    });

    await page.route('**/rest/v1/rpc/increment_dish_use_count*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({}),
      });
    });

    const evalRes = await page.evaluate(async () => {
      const openReq = indexedDB.open('yourbody-offline-a0000000-0000-0000-0000-000000000002');
      return new Promise<string>((resolve) => {
        openReq.onsuccess = () => {
          const db = openReq.result;
          if (db.objectStoreNames.contains('rq')) {
            const tx = db.transaction(['rq'], 'readwrite');
            tx.objectStore('rq').clear();
            tx.oncomplete = () => {
              db.close();
              resolve('rq-cleared');
            };
            tx.onerror = () => {
              db.close();
              resolve('tx-error: ' + String(tx.error));
            };
          } else {
            db.close();
            resolve('no-rq-store');
          }
        };
        openReq.onerror = () => resolve('open-error: ' + String(openReq.error));
        openReq.onblocked = () => resolve('open-blocked');
      });
    });
    // O2 persists ['custom_dishes', uid] in the per-user rq store; clear it so the route mock above is what loads.
    expect(evalRes).toMatch(/^(rq-cleared|no-rq-store)$/);

    await safeGoto(page, '/nutrition');
    await page.waitForSelector("text=Today's Nutrition");

    // Click 1-tap quick log button
    const quickLogBtn = page.locator(`[data-testid="quick-log-btn-${favoriteDish.id}"]`);
    await expect(quickLogBtn).toBeVisible();
    await quickLogBtn.click();

    // Floating toast appears with "Logged", dish name, kcal and Undo button (D41 & D42)
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Logged');
    await expect(toast).toContainText(dishName);
    await expect(toast).toContainText('+220 kcal');

    // Entry appeared in timeline
    const loggedRow = page.locator('[data-testid="meal-log-item"]').filter({ hasText: dishName }).first();
    await expect(loggedRow).toBeVisible();

    // Click Undo on toast
    const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Toast dismissed
    await expect(toast).not.toBeVisible();

    // Entry removed from timeline (D42)
    await expect(loggedRow).not.toBeVisible();
  });
  test('D45: Stage meal -> "+ Add" -> "Enter manually" -> adds item manually and updates totals', async ({ page }) => {
    // 1. Stage a meal via conversational input
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await nlTextarea.fill('3 eggs and toast');
    await page.click('button:has-text("Analyze Meal")');

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 15000 });

    // Initial calories: 470 kcal
    const initialTotals = page.locator('[data-testid="staged-meal-totals-grid"]');
    await expect(initialTotals).toBeVisible();
    await expect(initialTotals).toContainText('470');

    // 2. Click "+ Add" to open inline composer
    const addBtn = stagedCard.locator('[data-testid="add-item-button"]');
    await expect(addBtn).toHaveText('+ Add');
    await addBtn.click();

    const composer = stagedCard.locator('[data-testid="add-items-composer"]');
    await expect(composer).toBeVisible();

    // 3. Click "Enter manually" in composer
    const enterManuallyBtn = composer.locator('[data-testid="enter-manually-button"]');
    await enterManuallyBtn.click();

    // Composer closed, AddItemForm opened
    await expect(composer).not.toBeVisible();
    const addItemForm = stagedCard.locator('[data-testid="add-item-form"]');
    await expect(addItemForm).toBeVisible();

    // 4. Fill manual item details
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Honey Crisp Apple');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('1');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('medium');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('95');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('0.5');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('25');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('0.3');
    await addItemForm.locator('[data-testid="add-item-fiber-input"]').fill('4.4');

    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();

    // 5. AddItemForm closes, Honey Crisp Apple appended to meal, totals updated (470 + 95 = 565)
    await expect(addItemForm).not.toBeVisible();
    await expect(stagedCard).toContainText('Honey Crisp Apple');
    await expect(initialTotals).toContainText('565');

    // Clean up: discard staged meal
    await stagedCard.locator('button[aria-label="Discard staged meal"]').click();
    await expect(stagedCard).not.toBeVisible();
  });

  test('D45: Stage meal -> "+ Add" -> AI analyze appends items, triggers toast with Undo', async ({ page }) => {
    // 1. Stage a meal
    const nlTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
    await nlTextarea.fill('3 eggs and toast');
    await page.click('button:has-text("Analyze Meal")');

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await expect(stagedCard).toBeVisible({ timeout: 15000 });

    const totalsGrid = page.locator('[data-testid="staged-meal-totals-grid"]');
    await expect(totalsGrid).toContainText('470');

    // 2. Open inline composer
    const addBtn = stagedCard.locator('[data-testid="add-item-button"]');
    await addBtn.click();

    const composer = stagedCard.locator('[data-testid="add-items-composer"]');
    await expect(composer).toBeVisible();

    // 3. Type into composer and click Analyze
    const composerTextarea = composer.locator('[data-testid="composer-textarea"]');
    await composerTextarea.fill('1 banana');

    const analyzeBtn = composer.locator('[data-testid="analyze-items-button"]');
    await analyzeBtn.click();

    // 4. Composer closes, Banana appended, totals updated (470 + 105 = 575)
    await expect(composer).not.toBeVisible();
    await expect(stagedCard).toContainText('Banana');
    await expect(totalsGrid).toContainText('575');

    // 5. Toast appears: "Added to meal", "Banana · +105 kcal", and Undo button
    const toast = page.locator('[data-testid="quick-log-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Added to meal');
    await expect(toast).toContainText('Banana · +105 kcal');

    // 6. Click Undo on toast -> restores pre-add meal
    const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Toast dismissed, Banana removed, totals restored to 470
    await expect(toast).not.toBeVisible();
    await expect(stagedCard).not.toContainText('Banana');
    await expect(totalsGrid).toContainText('470');

    // Clean up
    await stagedCard.locator('button[aria-label="Discard staged meal"]').click();
    await expect(stagedCard).not.toBeVisible();
  });
});
