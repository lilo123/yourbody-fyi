import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * Narrow-viewport gates for the nutrition hierarchy.
 *
 * These are the checks that would actually have caught the defect class this
 * feature fixes. The shipping component row overflowed its card by 38 px at
 * 320 px — the delete icon rendered outside the card — and no existing gate saw
 * it, for two independent reasons:
 *
 *   1. every Playwright project ran at >= 360 px, and
 *   2. the page-level `documentElement.scrollWidth` check in
 *      mobile-viewport.spec.ts cannot see it anyway: an ancestor `min-w-0` and
 *      the card's own padding contain the overflow, so a child escapes its card
 *      while the document never scrolls.
 *
 * So the assertions here are per-element, against the element's own card, and
 * the spec *stages and logs its own meal* rather than hoping one is already
 * there. Without a fixture the level-2 row is never rendered and every gate
 * below is vacuously green — which is exactly the failure mode being fixed.
 */

const NARROW = 320;

/** A deliberately long, non-ASCII name: the real data that breaks these rows. */
const UNICODE_MEAL = 'Açaí Bowl with Crème Brûlée & Jalapeño Poppers';

async function safeGoto(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch {
    await page.goto(url);
  }
}

async function login(page: Page) {
  await safeGoto(page, '/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
}

/** Deterministic three-component analysis, so no Gemini runtime is needed. */
async function stubAnalysis(page: Page) {
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        name: UNICODE_MEAL,
        calories: 452,
        protein: 25.5,
        carbs: 31.2,
        fat: 24.6,
        fiber: 3.1,
        explanation: '182 kcal + 215 kcal + 55 kcal = 452 kcal',
        items: [
          {
            name: 'Crème Brûlée',
            portion: '1 slice (150g)',
            quantity: 150,
            unit: 'g',
            calories: 182,
            protein: 12.5,
            carbs: 3.2,
            fat: 13.1,
            fiber: 1.2,
          },
          {
            name: 'Pure Vanilla Extract for Crème Brûlée',
            portion: '2 dollops (150g)',
            quantity: 150,
            unit: 'g',
            calories: 215,
            protein: 11.5,
            carbs: 21,
            fat: 11.3,
            fiber: 0,
          },
          {
            name: 'Cucumber, Tomato, and Pickled Veggies',
            portion: '1 bowl',
            quantity: 1,
            unit: 'unit',
            calories: 55,
            protein: 1.5,
            carbs: 7,
            fat: 0.2,
            fiber: 1.9,
          },
        ],
      }),
    });
  });
}

async function stageMeal(page: Page) {
  await page.fill('textarea[placeholder*="Describe what you ate"]', 'egg frittata plate');
  await page.click('button:has-text("Analyze Meal")');
  await expect(page.locator('[data-testid="staged-meal-card"]')).toBeVisible({ timeout: 15000 });
}

/**
 * The largest distance by which any descendant escapes `container`'s own box.
 *
 * Measured with `getBoundingClientRect`, not `scrollWidth`, deliberately:
 * `scrollWidth > clientWidth` is true *by design* for every `truncate` element
 * (the adopted name span is 138 px wide with a 277 px scroll width at 320 px),
 * so a naive scrollWidth sweep is 100 % false positives. A clipped element's
 * bounding rect is its clipped size, which is the thing that must stay inside
 * the card.
 */
async function worstOverflow(container: Locator): Promise<number> {
  return container.evaluate((root) => {
    const box = root.getBoundingClientRect();
    let worst = 0;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      worst = Math.max(worst, r.right - box.right, box.left - r.left);
    }
    return worst;
  });
}

test.describe('Nutrition hierarchy at 320px', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      (testInfo.project.use.viewport?.width ?? 9999) > NARROW,
      'Only meaningful at the narrowest supported viewport.'
    );
    // Automatically accept window.confirm dialogs (e.g. meal deletion confirmation)
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    await stubAnalysis(page);
    await login(page);
    await safeGoto(page, '/nutrition');
    await page.waitForSelector("text=Today's Nutrition");
  });

  test('a staged multi-component meal keeps every component inside its card', async ({ page }) => {
    await stageMeal(page);

    const card = page.locator('[data-testid="staged-meal-card"]');
    expect(await worstOverflow(card)).toBeLessThanOrEqual(1);

    const rows = card.locator('[data-testid="component-row"]');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      // 1 px of tolerance for subpixel rounding; the known bug was 38 px.
      expect(await worstOverflow(rows.nth(i))).toBeLessThanOrEqual(1);
    }
  });

  test('the component name stays legible rather than collapsing to one glyph', async ({ page }) => {
    await stageMeal(page);

    // Zero overflow is not sufficient: three rejected layouts scored a perfect
    // 0 px and rendered the dish name as `C…`. 80 px admits the adopted 138 px
    // name and rejects the 20 px and 88 px ones.
    //
    // Scoped to the *name* spans on purpose. A blanket sweep over every
    // `truncate` element would fail on the unit chip, which is deliberately
    // `max-w-[64px]` — at 320 px a wider chip starves the quantity field.
    const names = page.locator('[data-testid="component-row"] [data-testid="component-name"]');
    const count = await names.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await names.nth(i).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(80);
    }
  });

  test('every control on a component row still meets the 44px touch target', async ({ page }) => {
    await stageMeal(page);

    const controls = page.locator('[data-testid="component-row"] button');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await controls.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('a logged breakdown expands and stays inside its card, then cleans up', async ({ page }) => {
    await stageMeal(page);

    const stagedCard = page.locator('[data-testid="staged-meal-card"]');
    await stagedCard.locator('button:has-text("Log Meal")').click();
    await expect(stagedCard).not.toBeVisible();

    // `.first()`: an aborted earlier run can leave a copy behind, and a
    // two-element locator makes every assertion below a strict-mode error
    // rather than a failure that says what is wrong.
    const row = page
      .locator('[data-testid="meal-log-item"]')
      .filter({ hasText: 'Crème Brûlée' })
      .first();
    await expect(row).toBeVisible();

    // The components survived the log. That is the whole feature: before this
    // change a 3-component meal collapsed to a single row on save.
    const trigger = row.locator('[data-testid="meal-log-accordion-trigger"]');
    await expect(trigger).toBeVisible();
    await expect(row.locator('[data-testid="meal-log-count-badge"]')).toHaveText('3');

    await trigger.click();
    const panel = row.locator('[data-testid="meal-log-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-testid="component-row"]')).toHaveCount(3);

    expect(await worstOverflow(row)).toBeLessThanOrEqual(1);

    // Leave the account as we found it, or every later run accumulates rows.
    // Asserted by log id: "this row is gone", not "there are fewer rows than
    // there were", which races the refetch that follows the commit.
    const actions = row.locator('button[aria-haspopup="menu"]');
    const id = ((await actions.getAttribute('data-testid')) ?? '').replace('meal-actions-', '');
    expect(id).not.toBe('');
    await actions.click();
    await page.locator(`[data-testid="delete-meal-${id}"]`).click();
    await expect(page.locator(`[data-testid="meal-actions-${id}"]`)).toHaveCount(0);
  });

  test('the document itself never scrolls sideways on the nutrition page', async ({ page }) => {
    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowing).toBe(false);
  });

  test('interactive nutrient breakdown popup opens at 320px, meets touch targets, and never overflows', async ({ page }) => {
    // Click Calories MacroRing
    const ring = page.locator('[data-testid="macro-ring-calories"]');
    await ring.click();

    const modal = page.locator('[data-testid="nutrient-breakdown-modal"]');
    await expect(modal).toBeVisible();

    // Verify modal does not cause document horizontal overflow
    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(overflowing).toBe(false);

    // Verify worst overflow of modal card is <= 1px
    expect(await worstOverflow(modal)).toBeLessThanOrEqual(1);

    // Verify segmented pill switcher controls meet 44px touch targets
    const pills = modal.locator('[role="tab"]');
    const count = await pills.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      const box = await pills.nth(i).boundingBox();
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Switch tabs to protein
    await modal.locator('[data-testid="nutrient-pill-protein"]').click();
    await expect(modal.locator('[data-testid="nutrient-pill-protein"]')).toHaveAttribute('aria-selected', 'true');

    // Close modal via close button
    await modal.locator('[data-testid="close-breakdown-modal-btn"]').click();
    await expect(modal).not.toBeVisible();
  });
});
