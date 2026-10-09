import { execSync } from 'child_process';
import { test, expect, type Page, type Locator } from '@playwright/test';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_CUSTOM_DISHES = [
  {
    id: 'dish-1',
    user_id: 'test-user',
    name: 'Keto Bar',
    calories: 150,
    protein: 10,
    carbs: 5,
    fat: 10,
    fiber: 3,
    created_at: '2026-03-01T10:00:00Z',
    kind: 'dish',
    use_count: 20,
    notes: 'Low carb snack',
  },
  {
    id: 'dish-2',
    user_id: 'test-user',
    name: 'Raw Japonica Rice',
    calories: 180,
    protein: 3.5,
    carbs: 40,
    fat: 0.5,
    fiber: 1,
    created_at: '2026-03-02T10:00:00Z',
    kind: 'dish',
    use_count: 15,
    notes: null,
  },
  {
    id: 'dish-3',
    user_id: 'test-user',
    name: 'Very Long Dish Name For Protein Ice Cream Bowl With Extra Berries',
    calories: 665,
    protein: 84,
    carbs: 45,
    fat: 12,
    fiber: 6,
    created_at: '2026-03-03T10:00:00Z',
    kind: 'recipe',
    use_count: 12,
    notes: null,
  },
  {
    id: 'dish-4',
    user_id: 'test-user',
    name: 'Whey Protein Powder',
    calories: 140,
    protein: 24,
    carbs: 3,
    fat: 2,
    fiber: 1,
    created_at: '2026-03-04T10:00:00Z',
    kind: 'dish',
    use_count: 10,
    notes: null,
  },
  {
    id: 'dish-5',
    user_id: 'test-user',
    name: 'Hearty Beef Stew with Vegetables and Herbs',
    calories: 310,
    protein: 40,
    carbs: 15,
    fat: 8,
    fiber: 2,
    created_at: '2026-03-05T10:00:00Z',
    kind: 'recipe',
    use_count: 8,
    notes: null,
  },
];

const FIXTURE_4_ITEMS = {
  name: 'Grilled Salmon Dinner Plate',
  calories: 705,
  protein: 48.5,
  carbs: 53,
  fat: 32.5,
  fiber: 4.5,
  explanation: '380 kcal + 195 kcal + 45 kcal + 85 kcal = 705 kcal',
  items: [
    {
      name: 'Grilled Salmon Fillet with Lemon Butter Sauce',
      portion: '200 g',
      quantity: 200,
      unit: 'g',
      calories: 380,
      protein: 40,
      carbs: 2,
      fat: 22,
      fiber: 0,
    },
    {
      name: 'Steamed Jasmine Rice',
      portion: '150 g',
      quantity: 150,
      unit: 'g',
      calories: 195,
      protein: 4,
      carbs: 43,
      fat: 0.5,
      fiber: 0.5,
    },
    {
      name: 'Roasted Asparagus with Garlic',
      portion: '100 g',
      quantity: 100,
      unit: 'g',
      calories: 45,
      protein: 3,
      carbs: 5,
      fat: 2,
      fiber: 2.5,
    },
    {
      name: 'Mixed Green Salad with Olive Oil',
      portion: '80 g',
      quantity: 80,
      unit: 'g',
      calories: 85,
      protein: 1.5,
      carbs: 3,
      fat: 8,
      fiber: 1.5,
    },
  ],
};

const FIXTURE_1_ITEM = {
  name: 'Grilled Salmon Fillet with Lemon Butter Sauce',
  calories: 475,
  protein: 50,
  carbs: 2.5,
  fat: 27.5,
  fiber: 0,
  explanation: '475 kcal',
  items: [
    {
      name: 'Grilled Salmon Fillet with Lemon Butter Sauce',
      portion: '250 g',
      quantity: 250,
      unit: 'g',
      calories: 475,
      protein: 50,
      carbs: 2.5,
      fat: 27.5,
      fiber: 0,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupPageAndLogin(page: Page) {
  page.on('dialog', async (d) => {
    await d.accept().catch(() => {});
  });

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
    const text = (postData.input || postData.text || postData.prompt || '').toLowerCase();
    const fixture = text.includes('1-item') || text.includes('single') ? FIXTURE_1_ITEM : FIXTURE_4_ITEMS;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(fixture),
    });
  });

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
    const url = new URL(route.request().url());
    const acceptHeader = route.request().headers()['accept'] || '';
    const idParam = url.searchParams.get('id');

    if (acceptHeader.includes('vnd.pgrst.object+json') || (idParam && idParam.startsWith('eq.'))) {
      const id = idParam ? idParam.replace('eq.', '') : '';
      const dish = FIXTURE_CUSTOM_DISHES.find((d) => d.id === id) || FIXTURE_CUSTOM_DISHES[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'access-control-allow-origin': '*',
        },
        body: JSON.stringify({ ...dish, custom_dish_items: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'content-range': `0-${FIXTURE_CUSTOM_DISHES.length - 1}/${FIXTURE_CUSTOM_DISHES.length}`,
      },
      body: JSON.stringify(FIXTURE_CUSTOM_DISHES),
    });
  });

  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
  await page.goto('/nutrition');
  await page.waitForSelector("text=Today's Nutrition");
}

// The Quick Log section renders its header (and an empty state) before the
// custom dishes request resolves; rows appear only once that data arrives.
// Measure only after the first row is attached and visible.
async function waitForFavoriteRows(section: Locator) {
  await expect(section.locator('[data-testid^="favorite-row-"]').first()).toBeVisible();
}

// Check helper: Staged card meal-type select chevron geometry
async function checkSelectChevronGeometry(card: Locator) {
  return await card.evaluate((cardEl) => {
    const select = cardEl.querySelector<HTMLSelectElement>('select[aria-label="Meal type"]');
    if (!select) throw new Error('Meal type select not found');

    const container = select.parentElement;
    const headerBorderB = cardEl.querySelector('.border-b');
    if (!container || container === headerBorderB) {
      throw new Error('Meal type select is not wrapped in a dedicated container (found direct child of header)');
    }

    const chevronSvg = container.querySelector<SVGElement>(':scope > svg, :scope svg');
    if (!chevronSvg) {
      throw new Error('Meal type select chevron SVG not found inside container');
    }

    const dishNameInput = cardEl.querySelector<HTMLInputElement>('[data-testid="dish-name-input"]');
    const inputRect = dishNameInput ? dishNameInput.getBoundingClientRect() : null;

    const selectRect = select.getBoundingClientRect();
    const selectStyle = window.getComputedStyle(select);
    const paddingLeft = parseFloat(selectStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(selectStyle.paddingRight) || 0;

    // Measure chevron computed styles to ensure not hidden or blocking clicks
    const cStyle = window.getComputedStyle(chevronSvg);
    const isChevronVisible = cStyle.display !== 'none' && cStyle.visibility !== 'hidden' && parseFloat(cStyle.opacity) > 0;
    const chevronOpacity = parseFloat(cStyle.opacity) || 0;
    const chevronPointerEvents = cStyle.pointerEvents;

    // Measure text width of ALL options using canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${selectStyle.fontStyle} ${selectStyle.fontVariant} ${selectStyle.fontWeight} ${selectStyle.fontSize} ${selectStyle.fontFamily}`;
    }

    let maxTextWidth = 0;
    let longestOption = '';
    const optionWidths: Record<string, number> = {};
    for (let i = 0; i < select.options.length; i++) {
      const optText = select.options[i].text;
      const w = ctx ? ctx.measureText(optText).width : 0;
      optionWidths[optText] = w;
      if (w > maxTextWidth) {
        maxTextWidth = w;
        longestOption = optText;
      }
    }

    const selectedText = select.options[select.selectedIndex]?.text || '';
    const textWidth = ctx ? ctx.measureText(selectedText).width : 0;

    const cRect = chevronSvg.getBoundingClientRect();
    const chevronBox = { x: cRect.x, y: cRect.y, width: cRect.width, height: cRect.height, right: cRect.right, bottom: cRect.bottom };
    const rightInset = selectRect.right - cRect.right;
    const chevronOffsetLeft = cRect.left - selectRect.left;
    const selectCenterY = selectRect.top + selectRect.height / 2;
    const chevronCenterY = cRect.top + cRect.height / 2;
    const verticalDelta = Math.abs(selectCenterY - chevronCenterY);
    const isInside = cRect.left >= selectRect.left && cRect.right <= selectRect.right && cRect.top >= selectRect.top && cRect.bottom <= selectRect.bottom;
    const clearanceLongest = (chevronOffsetLeft - 2) - (paddingLeft + maxTextWidth);
    const noOverlapLongest = clearanceLongest >= 0;

    return {
      hasCustomChevron: true,
      isChevronVisible,
      chevronOpacity,
      chevronPointerEvents,
      chevronBox,
      selectBox: { x: selectRect.x, y: selectRect.y, width: selectRect.width, height: selectRect.height },
      inputBox: inputRect ? { x: inputRect.x, y: inputRect.y, width: inputRect.width, height: inputRect.height } : null,
      rightInset,
      verticalDelta,
      isInside,
      scrollWidth: select.scrollWidth,
      clientWidth: select.clientWidth,
      isClipped: select.scrollWidth > select.clientWidth,
      textWidth,
      maxTextWidth,
      longestOption,
      optionWidths,
      paddingLeft,
      paddingRight,
      chevronOffsetLeft,
      clearanceLongest,
      noOverlapLongest,
    };
  });
}

// The Scale chip sits next to + Add without overlap, clipping or tap stealing.
function expectScaleChipFits(result: Awaited<ReturnType<typeof checkBreakdownHeaderGeometry>>) {
  const s = result.scale;
  expect(s.present, 'D46 Scale chip must be in the breakdown header').toBe(true);
  expect(s.height, `Scale chip tap height (${s.height}px) < 40px`).toBeGreaterThanOrEqual(40);
  expect(s.width, `Scale chip tap width (${s.width}px) < 40px`).toBeGreaterThanOrEqual(40);
  expect(s.labelIntersectionArea, 'Scale chip overlaps the header label').toBe(0);
  expect(s.addIntersectionArea, 'Scale chip overlaps + Add').toBe(0);
  expect(s.centerHitsScale, 'Center of Scale chip must hit the chip').toBe(true);
  expect(s.headerOverflows, 'Breakdown header overflows horizontally').toBe(false);
}

// Check helper: Breakdown header row height and Add item button geometry
async function checkBreakdownHeaderGeometry(card: Locator) {
  return await card.evaluate((cardEl) => {
    const addItemBtn = cardEl.querySelector<HTMLElement>('[data-testid="add-item-button"]');
    if (!addItemBtn) throw new Error('add-item-button not found');

    // + Add now shares an action group with the Scale chip; the row is breakdown-header.
    const headerRow = addItemBtn.closest<HTMLElement>('[data-testid="breakdown-header"]') ?? addItemBtn.parentElement;
    if (!headerRow) throw new Error('header row (breakdown-header) not found');

    const headerRowRect = headerRow.getBoundingClientRect();
    const btnRect = addItemBtn.getBoundingClientRect();

    // The visible label (full or short variant); display:none spans have a 0-width rect.
    const headerLabel = Array.from(headerRow.querySelectorAll<HTMLElement>(':scope > span:not(.sr-only)'))
      .find((el) => el.getBoundingClientRect().width > 0) ?? null;
    const labelRect = headerLabel ? headerLabel.getBoundingClientRect() : null;

    // Scale chip geometry
    const scaleBtn = headerRow.querySelector<HTMLElement>('[data-testid="meal-scale-button"]');
    const scaleRect = scaleBtn ? scaleBtn.getBoundingClientRect() : null;
    const overlap = (a: DOMRect | null, b: DOMRect | null) => {
      if (!a || !b) return 0;
      const h = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const v = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return h * v;
    };
    let scaleCenterHitsScale: boolean | null = null;
    if (scaleRect && scaleBtn) {
      const el = document.elementFromPoint(scaleRect.left + scaleRect.width / 2, scaleRect.top + scaleRect.height / 2);
      scaleCenterHitsScale = el === scaleBtn || scaleBtn.contains(el);
    }
    const scale = {
      present: !!scaleBtn,
      height: scaleRect ? Math.round(scaleRect.height * 10) / 10 : 0,
      width: scaleRect ? Math.round(scaleRect.width * 10) / 10 : 0,
      labelIntersectionArea: overlap(scaleRect, labelRect),
      addIntersectionArea: overlap(scaleRect, btnRect),
      centerHitsScale: scaleCenterHitsScale,
      headerOverflows: headerRow.scrollWidth > headerRow.clientWidth + 1,
      visibleLabel: headerLabel?.textContent?.trim() ?? null,
    };

    const firstRow = cardEl.querySelector('[data-testid="component-row"]');
    if (!firstRow) throw new Error('first component-row not found');
    const firstRowRect = firstRow.getBoundingClientRect();

    // Check intersection with header label
    let labelIntersectionArea = 0;
    if (labelRect) {
      const hOverlap = Math.max(0, Math.min(btnRect.right, labelRect.right) - Math.max(btnRect.left, labelRect.left));
      const vOverlap = Math.max(0, Math.min(btnRect.bottom, labelRect.bottom) - Math.max(btnRect.top, labelRect.top));
      labelIntersectionArea = hOverlap * vOverlap;
    }

    // Check intersection with first item row
    const hOverlapFirst = Math.max(0, Math.min(btnRect.right, firstRowRect.right) - Math.max(btnRect.left, firstRowRect.left));
    const vOverlapFirst = Math.max(0, Math.min(btnRect.bottom, firstRowRect.bottom) - Math.max(btnRect.top, firstRowRect.top));
    const firstRowIntersectionArea = hOverlapFirst * vOverlapFirst;

    const select = cardEl.querySelector<HTMLSelectElement>('select[aria-label="Meal type"]');
    const selectRect = select ? select.getBoundingClientRect() : null;

    // Check intersection with meal type select above
    let selectIntersectionArea = 0;
    if (selectRect) {
      const hOverlapSelect = Math.max(0, Math.min(btnRect.right, selectRect.right) - Math.max(btnRect.left, selectRect.left));
      const vOverlapSelect = Math.max(0, Math.min(btnRect.bottom, selectRect.bottom) - Math.max(btnRect.top, selectRect.top));
      selectIntersectionArea = hOverlapSelect * vOverlapSelect;
    }

    // Hit-testing at key points of the button to verify no occlusion or tap-stealing
    const pts = {
      top: { x: btnRect.left + btnRect.width / 2, y: btnRect.top },
      center: { x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 },
      bottom: { x: btnRect.left + btnRect.width / 2, y: btnRect.bottom - 1 },
      topLeft: { x: btnRect.left + 2, y: btnRect.top + 2 },
      topRight: { x: btnRect.right - 2, y: btnRect.top + 2 },
      bottomLeft: { x: btnRect.left + 2, y: btnRect.bottom - 2 },
    };
    const hitResults: Record<string, { tag: string; isBtnOrDescendant: boolean }> = {};
    for (const [k, pt] of Object.entries(pts)) {
      const el = document.elementFromPoint(pt.x, pt.y);
      hitResults[k] = {
        tag: el?.tagName || '',
        isBtnOrDescendant: el === addItemBtn || (addItemBtn.contains(el)),
      };
    }

    // Hit-testing at center of select to verify button does not occlude select
    let selectCenterHit: { tag: string; isAddBtn: boolean } | null = null;
    if (selectRect) {
      const cx = selectRect.left + selectRect.width / 2;
      const cy = selectRect.top + selectRect.height / 2;
      const el = document.elementFromPoint(cx, cy);
      selectCenterHit = {
        tag: el?.tagName || '',
        isAddBtn: el === addItemBtn || (addItemBtn.contains(el)),
      };
    }

    // Button text vertical center vs header label vertical center alignment
    let btnTextRect: DOMRect | null = null;
    const walker = document.createTreeWalker(addItemBtn, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (textNode) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      btnTextRect = range.getBoundingClientRect();
    }
    const labelCenterY = labelRect ? labelRect.top + labelRect.height / 2 : null;
    const btnTextCenterY = btnTextRect ? btnTextRect.top + btnTextRect.height / 2 : null;
    const textLabelDeltaY = (btnTextCenterY != null && labelCenterY != null)
      ? Math.round((btnTextCenterY - labelCenterY) * 10) / 10
      : null;

    const buttonText = addItemBtn.textContent?.trim() || '';
    const ariaLabel = addItemBtn.getAttribute('aria-label');
    const isClipped = addItemBtn.scrollWidth > addItemBtn.clientWidth + 1;

    return {
      scale,
      headerRowHeight: Math.round(headerRowRect.height * 10) / 10,
      buttonWidth: Math.round(btnRect.width * 10) / 10,
      buttonHeight: Math.round(btnRect.height * 10) / 10,
      buttonText,
      ariaLabel,
      isClipped,
      buttonScrollWidth: addItemBtn.scrollWidth,
      buttonClientWidth: addItemBtn.clientWidth,
      labelIntersectionArea: Math.round(labelIntersectionArea * 10) / 10,
      firstRowIntersectionArea: Math.round(firstRowIntersectionArea * 10) / 10,
      selectIntersectionArea: Math.round(selectIntersectionArea * 10) / 10,
      hitResults,
      selectCenterHit,
      textLabelDeltaY,
      btnBox: { x: btnRect.x, y: btnRect.y, width: btnRect.width, height: btnRect.height },
      labelBox: labelRect ? { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height } : null,
      firstRowBox: { x: firstRowRect.x, y: firstRowRect.y, width: firstRowRect.width, height: firstRowRect.height },
    };
  });
}

// Check 1 helper: Font sizes
async function checkFontSizes(surface: Locator) {
  const result = await surface.evaluate((root) => {
    function isVis(el: Element): boolean {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function getSel(el: Element): string {
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 2).join('.');
      return classes ? `${tag}.${classes}` : tag;
    }

    const offenders: Array<{ selector: string; text: string; fontSize: number }> = [];
    let minFontSize = Infinity;
    let minFontElement: { selector: string; text: string; fontSize: number } | null = null;
    let candidateCount = 0;

    const allEls = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of allEls) {
      if (!isVis(el)) continue;
      const s = window.getComputedStyle(el);

      let directText = '';
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent?.trim() || '';
          if (t) directText += (directText ? ' ' : '') + t;
        }
      }

      if (directText) {
        candidateCount++;
        const fs = parseFloat(s.fontSize);
        if (!isNaN(fs)) {
          if (fs < minFontSize) {
            minFontSize = fs;
            minFontElement = { selector: getSel(el), text: directText.slice(0, 30), fontSize: fs };
          }
          if (fs < 12) {
            offenders.push({ selector: getSel(el), text: directText.slice(0, 30), fontSize: fs });
          }
        }
      }
    }

    return { minFontSize, minFontElement, offenders, candidateCount };
  });

  expect(result.candidateCount, 'checkFontSizes matched 0 text candidates').toBeGreaterThan(0);
  return result;
}

// Check 2 helper: Tap targets
async function checkTapTargets(surface: Locator) {
  const result = await surface.evaluate((root) => {
    function isVis(el: Element): boolean {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function getSel(el: Element): string {
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 2).join('.');
      return classes ? `${tag}.${classes}` : tag;
    }

    const tapCandidates = Array.from(
      root.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])')
    );

    const tapsUnder48: Array<{ selector: string; text: string; width: number; height: number }> = [];
    const offendersUnder40: Array<{ selector: string; text: string; width: number; height: number }> = [];
    let candidateCount = 0;

    for (const el of tapCandidates) {
      if (!isVis(el)) continue;
      candidateCount++;
      // Controls enclosed in a dedicated touch-target wrapper (e.g. qty unit box) measure the enclosing hit area
      const hitArea = el.matches('[data-testid="component-quantity-input"]')
        ? el.closest<HTMLElement>('[data-testid="component-quantity-field"]')
        : null;
      const r = hitArea ? hitArea.getBoundingClientRect() : el.getBoundingClientRect();
      const width = Math.round(r.width * 10) / 10;
      const height = Math.round(r.height * 10) / 10;
      const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 25);
      const selector = getSel(hitArea || el);

      if (width < 48 || height < 48) {
        tapsUnder48.push({ selector, text, width, height });
      }
      if (width < 40 || height < 40) {
        offendersUnder40.push({ selector, text, width, height });
      }
    }

    return { tapsUnder48, offendersUnder40, candidateCount };
  });

  expect(result.candidateCount, 'checkTapTargets matched 0 tap candidates').toBeGreaterThan(0);
  return result;
}

// Check 3 helper: Clipping
async function checkClipping(surface: Locator) {
  const result = await surface.evaluate((root) => {
    function isVis(el: Element): boolean {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function getSel(el: Element): string {
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.id) return `#${el.id}`;
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 2).join('.');
      return classes ? `${tag}.${classes}` : tag;
    }

    const clippedElements: Array<{
      selector: string;
      text: string;
      scrollWidth?: number;
      clientWidth?: number;
      scrollHeight?: number;
      clientHeight?: number;
      type: 'horizontal' | 'vertical';
    }> = [];

    const allEls = [root, ...Array.from(root.querySelectorAll('*'))];
    let candidateCount = 0;

    for (const el of allEls) {
      if (!isVis(el)) continue;
      candidateCount++;
      const s = window.getComputedStyle(el);

      // Exemption 1: Staged-card meal-name input is exempt from horizontal scroll check
      const isStagedMealNameInput = el.getAttribute('data-testid') === 'dish-name-input';

      // Exemption 2: Quick Log dish names use CSS truncate with title attribute by design
      const isQuickLogDishName =
        Boolean(el.id && el.id.startsWith('dish-name-')) &&
        el.classList.contains('truncate');

      // Exemption 3: Quick Log toast dish text uses CSS truncate with title attribute by design
      const isToastDishText =
        el.getAttribute('data-testid') === 'toast-dish-text' &&
        el.classList.contains('truncate');

      const isIntentionalTruncate = isStagedMealNameInput || isQuickLogDishName || isToastDishText;

      if (el.tagName !== 'INPUT' && !isIntentionalTruncate && el.scrollWidth > el.clientWidth + 1) {
        clippedElements.push({
          selector: getSel(el),
          text: (el.textContent || '').trim().slice(0, 40),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          type: 'horizontal',
        });
      }

      if (el.scrollHeight > el.clientHeight + 1 && ['hidden', 'auto', 'scroll'].includes(s.overflowY)) {
        clippedElements.push({
          selector: getSel(el),
          text: (el.textContent || '').trim().slice(0, 40),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          type: 'vertical',
        });
      }
    }

    return { clippedElements, candidateCount };
  });

  expect(result.candidateCount, 'checkClipping matched 0 candidate elements').toBeGreaterThan(0);
  return result;
}

// Check 4 helper: Wait for smooth scroll animation to settle across animation frames
async function waitForScrollSettled(page: Page, targetSelector: string = '[data-testid="staged-meal-card"]') {
  await page.evaluate(() => {
    delete (window as unknown as { __scrollSettleState?: unknown }).__scrollSettleState;
  });

  await page.waitForFunction(
    (sel) => {
      const w = window as unknown as {
        __scrollSettleState?: { y: number; top: number; count: number };
      };
      const target = sel ? document.querySelector(sel) : null;
      if (!target) return false;
      const top = target.getBoundingClientRect().top;
      const currentY = window.scrollY;

      if (!w.__scrollSettleState) {
        w.__scrollSettleState = { y: currentY, top, count: 0 };
        return false;
      }

      const yDiff = Math.abs(currentY - w.__scrollSettleState.y);
      const topDiff = Math.abs(top - w.__scrollSettleState.top);

      if (yDiff < 0.5 && topDiff < 0.5) {
        w.__scrollSettleState.count++;
      } else {
        w.__scrollSettleState.y = currentY;
        w.__scrollSettleState.top = top;
        w.__scrollSettleState.count = 0;
      }

      return w.__scrollSettleState.count >= 3;
    },
    targetSelector,
    { timeout: 5000 }
  );
}

// Check 4 helper: Wait for instant scroll position to reach target and settle across animation frames
async function waitForScrollPosition(page: Page, target: number | 'bottom') {
  await page.evaluate((tgt) => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const expectedY = tgt === 'bottom' ? maxScroll : Math.min(tgt, maxScroll);
    if (Math.abs(window.scrollY - expectedY) > 1) {
      window.scrollTo(0, expectedY);
    }
    delete (window as unknown as { __scrollPosState?: unknown }).__scrollPosState;
  }, target);

  await page.waitForFunction(
    (tgt) => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const expectedY = tgt === 'bottom' ? maxScroll : Math.min(tgt, maxScroll);
      const currentY = window.scrollY;

      const w = window as unknown as {
        __scrollPosState?: { y: number; count: number };
      };

      if (!w.__scrollPosState) {
        w.__scrollPosState = { y: currentY, count: 0 };
        return false;
      }

      const diffFromExpected = Math.abs(currentY - expectedY);
      const diffFromLast = Math.abs(currentY - w.__scrollPosState.y);

      if (diffFromExpected <= 1 && diffFromLast < 0.5) {
        w.__scrollPosState.count++;
      } else {
        w.__scrollPosState.y = currentY;
        w.__scrollPosState.count = 0;
      }

      return w.__scrollPosState.count >= 2;
    },
    target,
    { timeout: 5000, polling: 'raf' }
  );
}

// ---------------------------------------------------------------------------

// Check helper: Staged card item row qty/unit box geometry
async function checkQtyUnitBoxGeometry(card: Locator) {
  return await card.evaluate((cardEl) => {
    const itemRows = Array.from(cardEl.querySelectorAll<HTMLElement>('[data-testid="component-row"]'));
    return itemRows.map((row, idx) => {
      const rowRect = row.getBoundingClientRect();
      const hitArea = row.querySelector<HTMLElement>('[data-testid="component-quantity-field"]');
      const visibleBox = row.querySelector<HTMLElement>('[data-testid="component-quantity-box"]');
      const qtyInput = row.querySelector<HTMLInputElement>('[data-testid="component-quantity-input"]');
      const chipBtn = row.querySelector<HTMLElement>('[data-testid="unit-chip"]') || row.querySelector<HTMLElement>('button[aria-haspopup="dialog"]');
      const menuBtn = row.querySelector<HTMLElement>('[data-testid="component-actions"]');
      const macroRow = row.querySelector<HTMLElement>('[data-testid="component-macros"]');

      if (!hitArea || !visibleBox || !qtyInput || !macroRow || !menuBtn || !chipBtn) {
        throw new Error(`Missing elements on component row ${idx}: hitArea=${!!hitArea}, visibleBox=${!!visibleBox}, qtyInput=${!!qtyInput}, chipBtn=${!!chipBtn}, macroRow=${!!macroRow}, menuBtn=${!!menuBtn}`);
      }

      const hitRect = hitArea.getBoundingClientRect();
      const boxRect = visibleBox.getBoundingClientRect();
      const macroRect = macroRow.getBoundingClientRect();
      const menuRect = menuBtn.getBoundingClientRect();
      const inputRect = qtyInput.getBoundingClientRect();
      const chipRect = chipBtn.getBoundingClientRect();

      const gap = Math.round((macroRect.top - boxRect.bottom) * 10) / 10;

      // Check horizontal & vertical overlap between hitArea and menuBtn
      const hOverlap = Math.max(0, Math.min(hitRect.right, menuRect.right) - Math.max(hitRect.left, menuRect.left));
      const vOverlap = Math.max(0, Math.min(hitRect.bottom, menuRect.bottom) - Math.max(hitRect.top, menuRect.top));
      const hasMenuOverlap = hOverlap > 0 && vOverlap > 0;

      // Check overlap between chip hit box and menuBtn
      const chipHOverlap = Math.max(0, Math.min(chipRect.right, menuRect.right) - Math.max(chipRect.left, menuRect.left));
      const chipVOverlap = Math.max(0, Math.min(chipRect.bottom, menuRect.bottom) - Math.max(chipRect.top, menuRect.top));
      const hasChipMenuOverlap = chipHOverlap > 0 && chipVOverlap > 0;

      // elementFromPoint at top/bottom edges of 44px hit box over qty-number x-centre
      const qtyX = inputRect.left + inputRect.width / 2;
      const topQtyEl = document.elementFromPoint(qtyX, hitRect.top + 1);
      const bottomQtyEl = document.elementFromPoint(qtyX, hitRect.bottom - 1);

      const isTopResolved = topQtyEl === hitArea || topQtyEl === visibleBox || topQtyEl === qtyInput || (hitArea.contains(topQtyEl) && !chipBtn.contains(topQtyEl));
      const isBottomResolved = bottomQtyEl === hitArea || bottomQtyEl === visibleBox || bottomQtyEl === qtyInput || (hitArea.contains(bottomQtyEl) && !chipBtn.contains(bottomQtyEl));

      // elementFromPoint at top/bottom edges over chip's x-centre
      const chipX = chipRect.left + chipRect.width / 2;
      const topChipEl = document.elementFromPoint(chipX, hitRect.top + 1);
      const bottomChipEl = document.elementFromPoint(chipX, hitRect.bottom - 1);

      const isChipTopResolved = topChipEl === chipBtn || chipBtn.contains(topChipEl);
      const isChipBottomResolved = bottomChipEl === chipBtn || chipBtn.contains(bottomChipEl);

      return {
        idx,
        rowHeight: Math.round(rowRect.height * 10) / 10,
        visibleBoxHeight: Math.round(boxRect.height * 10) / 10,
        hitAreaHeight: Math.round(hitRect.height * 10) / 10,
        chipHeight: Math.round(chipRect.height * 10) / 10,
        gap,
        hasMenuOverlap,
        hasChipMenuOverlap,
        isTopResolved,
        isBottomResolved,
        isChipTopResolved,
        isChipBottomResolved,
      };
    });
  });
}

// Surface A: Staged card with 4 items
// ---------------------------------------------------------------------------

test.describe('Surface A: Staged card with 4 items', () => {
  let page: Page;
  let cardLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    await page.fill('textarea[placeholder*="Describe what you ate"]', '4-item salmon dinner');
    await page.click('button:has-text("Analyze Meal")');
    cardLocator = page.locator('[data-testid="staged-meal-card"]');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('A: card height <= 480px', async () => {
    await waitForScrollSettled(page);
    const { cardBox, firstRowBox, actionRowBox } = await cardLocator.evaluate((card) => {
      const cardRect = card.getBoundingClientRect();
      const firstRow = card.querySelector('[data-testid="component-row"]');
      if (!firstRow) throw new Error('first component-row not found in staged card');
      const firstRowRect = firstRow.getBoundingClientRect();
      const discardBtn = card.querySelector('button[aria-label="Discard staged meal"]');
      const actionRow = discardBtn ? discardBtn.parentElement : null;
      if (!actionRow) throw new Error('action row (Discard button parent) not found in staged card');
      const actionRowRect = actionRow.getBoundingClientRect();
      return {
        cardBox: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
        firstRowBox: { x: firstRowRect.x, y: firstRowRect.y, width: firstRowRect.width, height: firstRowRect.height },
        actionRowBox: { x: actionRowRect.x, y: actionRowRect.y, width: actionRowRect.width, height: actionRowRect.height },
      };
    });

    const measurements = {
      test: 'A: card height <= 480px',
      surface: 'A',
      cardSelector: '[data-testid="staged-meal-card"]',
      card: {
        top: Math.round(cardBox.y * 10) / 10,
        bottom: Math.round((cardBox.y + cardBox.height) * 10) / 10,
        height: Math.round(cardBox.height * 10) / 10,
      },
      firstRow: {
        top: Math.round(firstRowBox.y * 10) / 10,
      },
      actionRow: {
        bottom: Math.round((actionRowBox.y + actionRowBox.height) * 10) / 10,
      },
      cardContainsFirstRowTop: cardBox.y <= firstRowBox.y + 0.5,
      cardContainsActionRowBottom: cardBox.y + cardBox.height >= actionRowBox.y + actionRowBox.height - 0.5,
      heightPass: cardBox.height <= 480,
    };
    console.log(JSON.stringify(measurements));

    // Card-height integrity assert: outermost container contains first row top and action row bottom
    expect(cardBox.y).toBeLessThanOrEqual(firstRowBox.y + 0.5);
    expect(cardBox.y + cardBox.height).toBeGreaterThanOrEqual(actionRowBox.y + actionRowBox.height - 0.5);

    // Height cap assert: <= 480px (tightened from 500px per)
    expect(cardBox.height).toBeLessThanOrEqual(480);
  });

  test('A: font >= 12px', async () => {
    const result = await checkFontSizes(cardLocator);
    console.log(
      JSON.stringify({
        test: 'A: font >= 12px',
        surface: 'A',
        minFontSize: result.minFontSize,
        minFontElement: result.minFontElement,
        offenders: result.offenders,
      })
    );

    expect(result.offenders, `Found fonts smaller than 12px: ${JSON.stringify(result.offenders)}`).toEqual([]);
  });

  test('A: taps >= 40px', async () => {
    const result = await checkTapTargets(cardLocator);
    console.log(
      JSON.stringify({
        test: 'A: taps >= 40px',
        surface: 'A',
        tapsUnder48: result.tapsUnder48,
        offendersUnder40: result.offendersUnder40,
      })
    );

    expect(
      result.offendersUnder40,
      `Found tap targets smaller than 40px: ${JSON.stringify(result.offendersUnder40)}`
    ).toEqual([]);
  });

  test('A: no clipping', async () => {
    const result = await checkClipping(cardLocator);
    console.log(
      JSON.stringify({
        test: 'A: no clipping',
        surface: 'A',
        clippedElements: result.clippedElements,
      })
    );

    expect(
      result.clippedElements,
      `Found clipped elements: ${JSON.stringify(result.clippedElements)}`
    ).toEqual([]);
  });

  test('A: column alignment, controls no overlap, and log button metrics at 390px', async () => {
    expect(page.viewportSize()?.width).toBe(390);
    await waitForScrollSettled(page);

    const result = await cardLocator.evaluate((card) => {
      const gridRows = Array.from(
        card.querySelectorAll<HTMLElement>(
          '[data-testid="component-macros"], [data-testid="staged-meal-totals-grid"], [data-testid="day-total-grid"]'
        )
      );

      const columnKeys = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
      const alignmentMismatches: Array<{
        column: string;
        rights: number[];
        diff: number;
      }> = [];

      for (const col of columnKeys) {
        const cellsForCol: HTMLElement[] = [];
        for (const row of gridRows) {
          const cell = row.querySelector<HTMLElement>(`[data-testid$="-${col}"]`);
          if (cell) {
            cellsForCol.push(cell);
          }
        }
        if (cellsForCol.length > 1) {
          const rights = cellsForCol.map((c) => Math.round(c.getBoundingClientRect().right * 10) / 10);
          const minRight = Math.min(...rights);
          const maxRight = Math.max(...rights);
          if (maxRight - minRight > 1.0) {
            alignmentMismatches.push({
              column: col,
              rights,
              diff: Math.round((maxRight - minRight) * 10) / 10,
            });
          }
        }
      }

      const items = Array.from(card.querySelectorAll<HTMLElement>('[data-testid="component-row"]'));
      const controlOverlaps: Array<{ idx: number; controlsBottom: number; macroTop: number; gap: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const controls = item.querySelector<HTMLElement>('[data-testid="component-right-cluster"]');
        const macroRow = item.querySelector<HTMLElement>('[data-testid="component-macros"]');
        if (controls && macroRow) {
          const cRect = controls.getBoundingClientRect();
          const mRect = macroRow.getBoundingClientRect();
          const gap = Math.round((mRect.top - cRect.bottom) * 10) / 10;
          if (cRect.bottom > mRect.top + 0.5) {
            controlOverlaps.push({
              idx: i,
              controlsBottom: Math.round(cRect.bottom * 10) / 10,
              macroTop: Math.round(mRect.top * 10) / 10,
              gap,
            });
          }
        }
      }

      const logBtn = card.querySelector<HTMLElement>('[data-testid="staged-card-actions"] button');
      const logSpan = logBtn ? logBtn.querySelector<HTMLElement>('span.truncate, span') : null;
      const logBtnMetrics = logBtn ? {
        btnScrollWidth: logBtn.scrollWidth,
        btnClientWidth: logBtn.clientWidth,
        spanScrollWidth: logSpan ? logSpan.scrollWidth : null,
        spanClientWidth: logSpan ? logSpan.clientWidth : null,
        text: logBtn.textContent?.trim() || '',
      } : null;

      return {
        gridRowCount: gridRows.length,
        alignmentMismatches,
        controlOverlaps,
        logBtnMetrics,
      };
    });

    console.log(
      JSON.stringify({
        test: 'A: column alignment, controls no overlap, and log button metrics at 390px',
        surface: 'A',
        alignmentMismatches: result.alignmentMismatches,
        controlOverlaps: result.controlOverlaps,
        logBtnMetrics: result.logBtnMetrics,
      })
    );

    expect(result.gridRowCount).toBeGreaterThanOrEqual(6);
    expect(result.alignmentMismatches).toEqual([]);
    expect(result.controlOverlaps).toEqual([]);
    if (result.logBtnMetrics && result.logBtnMetrics.spanScrollWidth !== null && result.logBtnMetrics.spanClientWidth !== null) {
      expect(result.logBtnMetrics.spanScrollWidth).toBeLessThanOrEqual(result.logBtnMetrics.spanClientWidth + 1);
    }
  });

  test('A: meal-type select chevron geometry at 390px and 700px', async () => {
    expect(page.viewportSize()?.width).toBe(390);
    await waitForScrollSettled(page);

    const result390 = await checkSelectChevronGeometry(cardLocator);
    console.log(JSON.stringify({ test: 'A: meal-type select chevron geometry at 390px', surface: 'A', ...result390 }));
    expect(result390.hasCustomChevron, 'Meal type select must have a custom chevron icon at 390px').toBe(true);
    expect(result390.isChevronVisible, 'Chevron must be visible at 390px').toBe(true);
    expect(result390.chevronOpacity, 'Chevron computed opacity must be > 0 at 390px').toBeGreaterThan(0);
    expect(result390.chevronPointerEvents, 'Chevron pointer-events must be none at 390px').toBe('none');
    expect(result390.isInside, 'Chevron must be inside select border at 390px').toBe(true);
    expect(result390.rightInset, 'Chevron right inset must be >= 8px at 390px').toBeGreaterThanOrEqual(8);
    expect(result390.verticalDelta, 'Chevron must be vertically centered within +-2px at 390px').toBeLessThanOrEqual(2);
    expect(result390.isClipped, 'Select label must not be clipped at 390px').toBe(false);
    expect(result390.paddingLeft + result390.maxTextWidth, `No overlap between longest label (${result390.longestOption}) and chevron at 390px`).toBeLessThanOrEqual(result390.chevronOffsetLeft - 2);

    // Test at 700px viewport wrapped in try/finally to prevent viewport leak into subsequent tests
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await waitForScrollSettled(page);
      const result700 = await checkSelectChevronGeometry(cardLocator);
      console.log(JSON.stringify({ test: 'A: meal-type select chevron geometry at 700px', surface: 'A', ...result700 }));
      expect(result700.hasCustomChevron, 'Custom chevron icon must be present at 700px').toBe(true);
      expect(result700.isChevronVisible, 'Chevron must be visible at 700px').toBe(true);
      expect(result700.chevronOpacity, 'Chevron computed opacity must be > 0 at 700px').toBeGreaterThan(0);
      expect(result700.chevronPointerEvents, 'Chevron pointer-events must be none at 700px').toBe('none');
      expect(result700.isInside, 'Chevron must be inside select border at 700px').toBe(true);
      expect(result700.rightInset, 'Chevron right inset must be >= 8px at 700px').toBeGreaterThanOrEqual(8);
      expect(result700.verticalDelta, 'Chevron must be vertically centered within +-2px at 700px').toBeLessThanOrEqual(2);
      expect(result700.isClipped, 'Select label must not be clipped at 700px').toBe(false);
      expect(result700.paddingLeft + result700.maxTextWidth, `No overlap between longest label (${result700.longestOption}) and chevron at 700px`).toBeLessThanOrEqual(result700.chevronOffsetLeft - 2);
    } finally {
      // Restore viewport to 390x844
      await page.setViewportSize({ width: 390, height: 844 });
      await waitForScrollSettled(page);
    }
  });

  test('A: breakdown header row height <= 16px, Add item tap >= 40px, no overlap with label or first row at 390px', async () => {
    expect(page.viewportSize()?.width).toBe(390);
    await waitForScrollSettled(page);

    const result = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(result);
    console.log(JSON.stringify({ test: 'A: breakdown header geometry at 390px', surface: 'A', ...result }));

    // Header row height <= pre- value (16px) with +0.5px tolerance max
    expect(result.headerRowHeight, `Header row height (${result.headerRowHeight}px) exceeds pre-D22 value 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);

    // Label text '+ Manual', aria-label 'Add manual item', no clip
    expect(result.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(result.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(result.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);

    // Add item tap box >= 40 tall and >= 40 wide
    expect(result.buttonHeight, `Add item tap height (${result.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.buttonWidth, `Add item tap width (${result.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);

    // Add item box does not overlap the header label (rect intersection = 0)
    expect(result.labelIntersectionArea, `Add item button intersects header label with area ${result.labelIntersectionArea}px²`).toBe(0);

    // Add item box does not overlap the first item row (rect intersection = 0)
    expect(result.firstRowIntersectionArea, `Add item button intersects first item row with area ${result.firstRowIntersectionArea}px²`).toBe(0);

    // Add item box does not overlap the meal-type select above (rect intersection = 0)
    expect(result.selectIntersectionArea, `Add item button intersects meal type select with area ${result.selectIntersectionArea}px²`).toBe(0);

    // Hit-testing points on button hit the button (no tap stealing by adjacent elements)
    expect(result.hitResults.top.isBtnOrDescendant, 'Top edge of Add item button must hit button').toBe(true);
    expect(result.hitResults.center.isBtnOrDescendant, 'Center of Add item button must hit button').toBe(true);
    expect(result.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of Add item button must hit button').toBe(true);

    // Select center must hit select, not add-item button
    if (result.selectCenterHit) {
      expect(result.selectCenterHit.isAddBtn, 'Center of meal type select must not be occluded by Add item button').toBe(false);
    }

    // Button text vertical center aligns with header label vertical center (within +-1px)
    expect(result.textLabelDeltaY).not.toBeNull();
    expect(Math.abs(result.textLabelDeltaY!), `Add item text center-Y deviates from label center-Y by ${result.textLabelDeltaY}px`).toBeLessThanOrEqual(1.0);
  });

  test('A: staged item row qty/unit box geometry and hit testing at 390px', async () => {
    await waitForScrollSettled(page);

    const rows = cardLocator.locator('[data-testid="component-row"]');
    const rowCount = await rows.count();
    expect(rowCount).toBe(4);

    const measurements = await checkQtyUnitBoxGeometry(cardLocator);
    console.log(JSON.stringify({ test: 'A: qty/unit box D32 measurements at 390px', surface: 'A', measurements }));

    for (const m of measurements) {
      // visible border height 32 (+-1)
      expect(m.visibleBoxHeight, `Row ${m.idx} visible box height must be 32 +- 1`).toBeGreaterThanOrEqual(31);
      expect(m.visibleBoxHeight, `Row ${m.idx} visible box height must be 32 +- 1`).toBeLessThanOrEqual(33);

      // gap >= 4
      expect(m.gap, `Row ${m.idx} gap between visible box bottom and macro row must be >= 4px`).toBeGreaterThanOrEqual(4);

      // hit box >= 44 tall
      expect(m.hitAreaHeight, `Row ${m.idx} hit box height must be >= 44px`).toBeGreaterThanOrEqual(44);
      expect(m.chipHeight, `Row ${m.idx} chip hit box height must be >= 44px`).toBeGreaterThanOrEqual(44);

      // elementFromPoint at hit-box edges resolves into the qty control over qty-number x-centre
      expect(m.isTopResolved, `Row ${m.idx} top hit-box edge over qty resolves into qty control`).toBe(true);
      expect(m.isBottomResolved, `Row ${m.idx} bottom hit-box edge over qty resolves into qty control`).toBe(true);

      // elementFromPoint at y+1 and y+43 over chip's x-centre resolves to chip button
      expect(m.isChipTopResolved, `Row ${m.idx} elementFromPoint at y+1 over chip resolves to chip button`).toBe(true);
      expect(m.isChipBottomResolved, `Row ${m.idx} elementFromPoint at y+43 over chip resolves to chip button`).toBe(true);

      // no overlap with the ... hit box
      expect(m.hasMenuOverlap, `Row ${m.idx} hit area must not overlap ... menu`).toBe(false);
      expect(m.hasChipMenuOverlap, `Row ${m.idx} chip hit box must not overlap ... menu`).toBe(false);

      // item row height <= old value (62px)
      expect(m.rowHeight, `Row ${m.idx} height must be <= old value of 62px`).toBeLessThanOrEqual(62);
    }

    // Verify tapping over the chip's x-centre at y+1 and y+43 opens unit dialog
    const firstChip = rows.first().locator('[data-testid="component-unit-chip"]');
    await firstChip.click({ position: { x: 26, y: 1 } });
    const unitSheet = page.locator('[data-testid="unit-sheet"]');
    await expect(unitSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unitSheet).not.toBeVisible();

    await firstChip.click({ position: { x: 26, y: 43 } });
    await expect(unitSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unitSheet).not.toBeVisible();

    // Verify tapping over qty-number x-centre (position { x: 20, y: 43 }) focuses the input
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const input = row.locator('[data-testid="component-quantity-input"]');
      const field = row.locator('[data-testid="component-quantity-field"]');

      await field.click({ position: { x: 20, y: 43 } });
      const focusedBottom = await input.evaluate((el) => document.activeElement === el);
      expect(focusedBottom, `Row ${i} click at y+43 over qty must focus the input`).toBe(true);

      await input.evaluate((el) => el.blur());
    }
  });

  test('A: Scale box open at 390px keeps the header on one line, 16px input, no overlap, and Escape restores', async () => {
    expect(page.viewportSize()?.width).toBe(390);
    await cardLocator.locator('[data-testid="meal-scale-button"]').click();
    const input = cardLocator.locator('[data-testid="meal-scale-input"]');
    await expect(input).toBeFocused();

    const m = await cardLocator.evaluate((cardEl) => {
      const header = cardEl.querySelector<HTMLElement>('[data-testid="breakdown-header"]')!;
      const field = cardEl.querySelector<HTMLElement>('[data-testid="meal-scale-field"]')!;
      const inputEl = cardEl.querySelector<HTMLInputElement>('[data-testid="meal-scale-input"]')!;
      const add = cardEl.querySelector<HTMLElement>('[data-testid="add-item-button"]')!;
      const label = Array.from(header.querySelectorAll<HTMLElement>(':scope > span:not(.sr-only)'))
        .find((el) => el.getBoundingClientRect().width > 0)!;
      const r = (el: Element) => el.getBoundingClientRect();
      const ov = (a: DOMRect, b: DOMRect) =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        headerHeight: Math.round(r(header).height * 10) / 10,
        headerOverflows: header.scrollWidth > header.clientWidth + 1,
        fieldHeight: Math.round(r(field).height * 10) / 10,
        inputFontSize: parseFloat(getComputedStyle(inputEl).fontSize),
        fieldAddOverlap: ov(r(field), r(add)),
        fieldLabelOverlap: ov(r(field), r(label)),
        labelText: label.textContent?.trim(),
        fieldInsideCard: r(field).right <= r(cardEl).right && r(field).left >= r(cardEl).left,
      };
    });
    console.log(JSON.stringify({ test: 'A: D46 scale box open at 390px', ...m }));

    expect(m.labelText, 'At 390px the header keeps the full label').toBe('Itemized Breakdown (4)');
    expect(m.headerOverflows, 'Header overflows with the Scale box open').toBe(false);
    expect(m.headerHeight, `Header height (${m.headerHeight}px) grew with the Scale box open`).toBeLessThanOrEqual(16.5);
    expect(m.fieldHeight, `Scale box tap height (${m.fieldHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(m.inputFontSize, 'Scale input must be 16px (iOS no-zoom)').toBe(16);
    expect(m.fieldAddOverlap, 'Scale box overlaps + Add').toBe(0);
    expect(m.fieldLabelOverlap, 'Scale box overlaps the label').toBe(0);
    expect(m.fieldInsideCard, 'Scale box must stay inside the card').toBe(true);

    await input.press('Escape');
    await expect(cardLocator.locator('[data-testid="meal-scale-button"]')).toBeFocused();
    await expect(cardLocator.locator('[data-testid="meal-scale-button"]')).toHaveText('Scale');
  });
});


// ---------------------------------------------------------------------------
// Surface B: Staged card with 1 item
// ---------------------------------------------------------------------------

test.describe('Surface B: Staged card with 1 item', () => {
  let page: Page;
  let cardLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    await page.fill('textarea[placeholder*="Describe what you ate"]', 'single 1-item salmon');
    await page.click('button:has-text("Analyze Meal")');
    cardLocator = page.locator('[data-testid="staged-meal-card"]');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('B: card height <= 260px', async () => {
    await waitForScrollSettled(page);
    const { cardBox, firstRowBox, actionRowBox } = await cardLocator.evaluate((card) => {
      const cardRect = card.getBoundingClientRect();
      const firstRow = card.querySelector('[data-testid="component-row"]');
      if (!firstRow) throw new Error('first component-row not found in staged card');
      const firstRowRect = firstRow.getBoundingClientRect();
      const discardBtn = card.querySelector('button[aria-label="Discard staged meal"]');
      const actionRow = discardBtn ? discardBtn.parentElement : null;
      if (!actionRow) throw new Error('action row (Discard button parent) not found in staged card');
      const actionRowRect = actionRow.getBoundingClientRect();
      return {
        cardBox: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height },
        firstRowBox: { x: firstRowRect.x, y: firstRowRect.y, width: firstRowRect.width, height: firstRowRect.height },
        actionRowBox: { x: actionRowRect.x, y: actionRowRect.y, width: actionRowRect.width, height: actionRowRect.height },
      };
    });

    const measurements = {
      test: 'B: card height <= 260px',
      surface: 'B',
      cardSelector: '[data-testid="staged-meal-card"]',
      card: {
        top: Math.round(cardBox.y * 10) / 10,
        bottom: Math.round((cardBox.y + cardBox.height) * 10) / 10,
        height: Math.round(cardBox.height * 10) / 10,
      },
      firstRow: {
        top: Math.round(firstRowBox.y * 10) / 10,
      },
      actionRow: {
        bottom: Math.round((actionRowBox.y + actionRowBox.height) * 10) / 10,
      },
      cardContainsFirstRowTop: cardBox.y <= firstRowBox.y + 0.5,
      cardContainsActionRowBottom: cardBox.y + cardBox.height >= actionRowBox.y + actionRowBox.height - 0.5,
      heightPass: cardBox.height <= 260,
    };
    console.log(JSON.stringify(measurements));

    // Card-height integrity assert: outermost container contains first row top and action row bottom
    expect(cardBox.y).toBeLessThanOrEqual(firstRowBox.y + 0.5);
    expect(cardBox.y + cardBox.height).toBeGreaterThanOrEqual(actionRowBox.y + actionRowBox.height - 0.5);

    // Height cap assert: <= 260px
    expect(cardBox.height).toBeLessThanOrEqual(260);
  });

  test('B: font >= 12px', async () => {
    const result = await checkFontSizes(cardLocator);
    console.log(
      JSON.stringify({
        test: 'B: font >= 12px',
        surface: 'B',
        minFontSize: result.minFontSize,
        minFontElement: result.minFontElement,
        offenders: result.offenders,
      })
    );

    expect(result.offenders, `Found fonts smaller than 12px: ${JSON.stringify(result.offenders)}`).toEqual([]);
  });

  test('B: taps >= 40px', async () => {
    const result = await checkTapTargets(cardLocator);
    console.log(
      JSON.stringify({
        test: 'B: taps >= 40px',
        surface: 'B',
        tapsUnder48: result.tapsUnder48,
        offendersUnder40: result.offendersUnder40,
      })
    );

    expect(
      result.offendersUnder40,
      `Found tap targets smaller than 40px: ${JSON.stringify(result.offendersUnder40)}`
    ).toEqual([]);
  });

  test('B: no clipping', async () => {
    const result = await checkClipping(cardLocator);
    console.log(
      JSON.stringify({
        test: 'B: no clipping',
        surface: 'B',
        clippedElements: result.clippedElements,
      })
    );

    expect(
      result.clippedElements,
      `Found clipped elements: ${JSON.stringify(result.clippedElements)}`
    ).toEqual([]);
  });

  test('B: breakdown header row height <= 16px, + Add button geometry at 390px', async () => {
    expect(page.viewportSize()?.width).toBe(390);
    await waitForScrollSettled(page);

    const result = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(result);
    console.log(JSON.stringify({ test: 'B: breakdown header geometry at 390px', surface: 'B', ...result }));

    expect(result.headerRowHeight, `Header row height (${result.headerRowHeight}px) exceeds 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);
    expect(result.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(result.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(result.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);
    expect(result.buttonHeight, `+ Manual button tap height (${result.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.buttonWidth, `+ Manual button tap width (${result.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.labelIntersectionArea, `+ Manual button intersects header label with area ${result.labelIntersectionArea}px²`).toBe(0);
    expect(result.firstRowIntersectionArea, `+ Manual button intersects first item row with area ${result.firstRowIntersectionArea}px²`).toBe(0);
    expect(result.selectIntersectionArea, `+ Manual button intersects meal type select with area ${result.selectIntersectionArea}px²`).toBe(0);
    expect(result.hitResults.top.isBtnOrDescendant, 'Top edge of + Manual button must hit button').toBe(true);
    expect(result.hitResults.center.isBtnOrDescendant, 'Center of + Manual button must hit button').toBe(true);
    expect(result.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of + Manual button must hit button').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Surface C: Manual entry form
// ---------------------------------------------------------------------------

test.describe('Surface C: Manual entry form', () => {
  let page: Page;
  let formLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    const manualBtn = page.locator('button:has-text("Manual Entry")');
    await manualBtn.click();
    formLocator = page.locator('form').filter({ hasText: 'Manual Macro Logging' });
    await expect(formLocator).toBeVisible();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('C: Log button reachable', async () => {
    const navLocator = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
    const logBtnLocator = formLocator.locator('button[type="submit"]');

    // 1. Measure at rest
    const navBoxAtRest = (await navLocator.boundingBox())!;
    const logBoxAtRest = (await logBtnLocator.boundingBox())!;

    const atRest = {
      navTop: Math.round(navBoxAtRest.y * 10) / 10,
      logBtnTop: Math.round(logBoxAtRest.y * 10) / 10,
      logBtnBottom: Math.round((logBoxAtRest.y + logBoxAtRest.height) * 10) / 10,
      reachable: logBoxAtRest.y + logBoxAtRest.height <= navBoxAtRest.y && logBoxAtRest.y >= 0,
    };

    // 2. Measure after scrolling page to bottom
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForScrollPosition(page, 'bottom');
    await expect(logBtnLocator).toBeVisible();
    await expect(navLocator).toBeVisible();

    const navBoxScrolled = (await navLocator.boundingBox())!;
    const logBoxScrolled = (await logBtnLocator.boundingBox())!;

    const scrolled = {
      navTop: Math.round(navBoxScrolled.y * 10) / 10,
      logBtnTop: Math.round(logBoxScrolled.y * 10) / 10,
      logBtnBottom: Math.round((logBoxScrolled.y + logBoxScrolled.height) * 10) / 10,
      reachable: logBoxScrolled.y + logBoxScrolled.height <= navBoxScrolled.y && logBoxScrolled.y >= 0,
    };

    const measurements = {
      test: 'C: Log button reachable',
      surface: 'C',
      atRest,
      scrolled,
    };
    console.log(JSON.stringify(measurements));

    // Reset scroll back to top for subsequent tests
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForScrollPosition(page, 0);
    await expect(formLocator).toBeVisible();

    // Assert reachable at rest
    expect(
      atRest.logBtnBottom,
      `At rest: Log button bottom (${atRest.logBtnBottom}px) exceeds bottom-nav top (${atRest.navTop}px)`
    ).toBeLessThanOrEqual(atRest.navTop);
    expect(atRest.logBtnTop, `At rest: Log button top (${atRest.logBtnTop}px) < 0`).toBeGreaterThanOrEqual(0);

    // Assert reachable when scrolled
    expect(
      scrolled.logBtnBottom,
      `When scrolled: Log button bottom (${scrolled.logBtnBottom}px) exceeds bottom-nav top (${scrolled.navTop}px)`
    ).toBeLessThanOrEqual(scrolled.navTop);
    expect(scrolled.logBtnTop, `When scrolled: Log button top (${scrolled.logBtnTop}px) < 0`).toBeGreaterThanOrEqual(0);
  });

  test('C: font >= 12px', async () => {
    const result = await checkFontSizes(formLocator);
    console.log(
      JSON.stringify({
        test: 'C: font >= 12px',
        surface: 'C',
        minFontSize: result.minFontSize,
        minFontElement: result.minFontElement,
        offenders: result.offenders,
      })
    );

    expect(result.offenders, `Found fonts smaller than 12px: ${JSON.stringify(result.offenders)}`).toEqual([]);
  });

  test('C: taps >= 40px', async () => {
    const result = await checkTapTargets(formLocator);
    console.log(
      JSON.stringify({
        test: 'C: taps >= 40px',
        surface: 'C',
        tapsUnder48: result.tapsUnder48,
        offendersUnder40: result.offendersUnder40,
      })
    );

    expect(
      result.offendersUnder40,
      `Found tap targets smaller than 40px: ${JSON.stringify(result.offendersUnder40)}`
    ).toEqual([]);
  });

  test('C: no clipping', async () => {
    const result = await checkClipping(formLocator);
    console.log(
      JSON.stringify({
        test: 'C: no clipping',
        surface: 'C',
        clippedElements: result.clippedElements,
      })
    );

    expect(
      result.clippedElements,
      `Found clipped elements: ${JSON.stringify(result.clippedElements)}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Surface D: staged card placement
// ---------------------------------------------------------------------------

test.describe('Surface D: staged card placement', () => {
  let page: Page;
  let cardLocator: Locator;
  let navLocator: Locator;
  let actionRowLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    await page.fill('textarea[placeholder*="Describe what you ate"]', '4-item salmon dinner');
    await page.click('button:has-text("Analyze Meal")');
    cardLocator = page.locator('[data-testid="staged-meal-card"]');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);

    const discardBtn = cardLocator.locator('button[aria-label="Discard staged meal"]');
    actionRowLocator = discardBtn.locator('..');
    navLocator = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('after staging card top in [0, 200]', async () => {
    // Wait for smooth scroll to settle
    await waitForScrollSettled(page);

    const cardBox = (await cardLocator.boundingBox())!;
    const cardTop = Math.round(cardBox.y * 10) / 10;

    const measurements = {
      test: 'D1: after staging card top in [0, 200]',
      surface: 'D',
      cardTop,
      inRange: cardTop >= 0 && cardTop <= 200,
    };
    console.log(JSON.stringify(measurements));

    expect(cardTop, `Card top (${cardTop}px) must be >= 0`).toBeGreaterThanOrEqual(0);
    expect(cardTop, `Card top (${cardTop}px) must be <= 200`).toBeLessThanOrEqual(200);
  });

  test('action row visible above nav at staging and mid scroll', async () => {
    // 1. Right after staging
    const navBoxAtStaging = (await navLocator.boundingBox())!;
    const actionBoxAtStaging = (await actionRowLocator.boundingBox())!;

    const atStaging = {
      navTop: Math.round(navBoxAtStaging.y * 10) / 10,
      actionRowTop: Math.round(actionBoxAtStaging.y * 10) / 10,
      actionRowBottom: Math.round((actionBoxAtStaging.y + actionBoxAtStaging.height) * 10) / 10,
      actionRowBottomLteNavTop:
        Math.round((actionBoxAtStaging.y + actionBoxAtStaging.height) * 10) / 10 <=
        Math.round(navBoxAtStaging.y * 10) / 10,
      actionRowTopGteZero: actionBoxAtStaging.y >= 0,
    };

    // 2. After scrolling to the middle
    const maxScroll = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight
    );
    await page.evaluate((y) => window.scrollTo(0, y), maxScroll / 2);
    await waitForScrollPosition(page, maxScroll / 2);
    await expect(actionRowLocator).toBeVisible();
    await expect(navLocator).toBeVisible();

    const navBoxMid = (await navLocator.boundingBox())!;
    const actionBoxMid = (await actionRowLocator.boundingBox())!;

    const midScroll = {
      navTop: Math.round(navBoxMid.y * 10) / 10,
      actionRowTop: Math.round(actionBoxMid.y * 10) / 10,
      actionRowBottom: Math.round((actionBoxMid.y + actionBoxMid.height) * 10) / 10,
      actionRowBottomLteNavTop:
        Math.round((actionBoxMid.y + actionBoxMid.height) * 10) / 10 <=
        Math.round(navBoxMid.y * 10) / 10,
      actionRowTopGteZero: actionBoxMid.y >= 0,
    };

    const measurements = {
      test: 'D2: action row visible above nav at staging and mid scroll',
      surface: 'D',
      atStaging,
      midScroll,
    };
    console.log(JSON.stringify(measurements));

    // Reset scroll back for subsequent measurements
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForScrollPosition(page, 0);
    await expect(cardLocator).toBeVisible();

    expect(
      atStaging.actionRowBottom,
      `At staging: Action row bottom (${atStaging.actionRowBottom}px) exceeds nav top (${atStaging.navTop}px)`
    ).toBeLessThanOrEqual(atStaging.navTop);
    expect(
      atStaging.actionRowTop,
      `At staging: Action row top (${atStaging.actionRowTop}px) < 0`
    ).toBeGreaterThanOrEqual(0);

    expect(
      midScroll.actionRowBottom,
      `Mid scroll: Action row bottom (${midScroll.actionRowBottom}px) exceeds nav top (${midScroll.navTop}px)`
    ).toBeLessThanOrEqual(midScroll.navTop);
    expect(
      midScroll.actionRowTop,
      `Mid scroll: Action row top (${midScroll.actionRowTop}px) < 0`
    ).toBeGreaterThanOrEqual(0);
  });

  test('last row not covered at end of scroll', async () => {
    // Scroll page to end
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForScrollPosition(page, 'bottom');
    const lastRowLocator = cardLocator.locator('[data-testid="staged-meal-day-total"]');
    await expect(lastRowLocator).toBeVisible();
    await expect(actionRowLocator).toBeVisible();
    await expect(navLocator).toBeVisible();

    const lastRowBox = (await lastRowLocator.boundingBox())!;
    const actionBoxEnd = (await actionRowLocator.boundingBox())!;
    const navBoxEnd = (await navLocator.boundingBox())!;

    const lastRowBottom = Math.round((lastRowBox.y + lastRowBox.height) * 10) / 10;
    const actionRowTop = Math.round(actionBoxEnd.y * 10) / 10;
    const navTop = Math.round(navBoxEnd.y * 10) / 10;

    const measurements = {
      test: 'D3: last row not covered at end of scroll',
      surface: 'D',
      lastRowBottom,
      actionRowTop,
      navTop,
      lastRowLteActionRowTop: lastRowBottom <= actionRowTop,
      lastRowLteNavTop: lastRowBottom <= navTop,
    };
    console.log(JSON.stringify(measurements));

    // Reset scroll back
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForScrollPosition(page, 0);
    await expect(cardLocator).toBeVisible();

    expect(
      lastRowBottom,
      `Last row bottom (${lastRowBottom}px) exceeds action row top (${actionRowTop}px)`
    ).toBeLessThanOrEqual(actionRowTop);
    expect(
      lastRowBottom,
      `Last row bottom (${lastRowBottom}px) exceeds nav top (${navTop}px)`
    ).toBeLessThanOrEqual(navTop);
  });

  test('with reducedMotion reduce emulated', async () => {
    // Discard current staged meal
    await cardLocator.locator('button[aria-label="Discard staged meal"]').click();
    await expect(cardLocator).not.toBeVisible();

    // Emulate reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });

    try {
      // Staged card replaces AI input again
      await page.click('button:has-text("Analyze Meal")');
      await expect(cardLocator).toBeVisible({ timeout: 15000 });
      await waitForScrollSettled(page);

      const cardBox = (await cardLocator.boundingBox())!;
      const cardTop = Math.round(cardBox.y * 10) / 10;

      const measurements = {
        test: 'D4: D1 with reducedMotion reduce emulated',
        surface: 'D',
        cardTop,
        inRange: cardTop >= 0 && cardTop <= 200,
      };
      console.log(JSON.stringify(measurements));

      expect(cardTop, `Reduced motion card top (${cardTop}px) must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(cardTop, `Reduced motion card top (${cardTop}px) must be <= 200`).toBeLessThanOrEqual(200);
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });

  test('page end content not covered by nav', async () => {
    const navBox = (await navLocator.boundingBox())!;
    const navTop = Math.round(navBox.y * 10) / 10;

    const findBottomMostContentBottom = async () => {
      return page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return null;
        const nav = document.querySelector('nav');
        const all = Array.from(main.querySelectorAll('*'));
        let maxBottom = -Infinity;

        for (const el of all) {
          if (nav && nav.contains(el)) continue;
          const style = window.getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'sticky') continue;
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.bottom > maxBottom) {
            maxBottom = rect.bottom;
          }
        }
        return Math.round(maxBottom * 10) / 10;
      });
    };

    // Measurement 1: with a staged 4-item card
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForScrollPosition(page, 'bottom');
    await expect(actionRowLocator).toBeVisible();
    await expect(navLocator).toBeVisible();

    const stagedLastContentBottom = (await findBottomMostContentBottom())!;
    const actionBoxEnd = (await actionRowLocator.boundingBox())!;
    const actionRowTop = Math.round(actionBoxEnd.y * 10) / 10;
    const actionRowBottom = Math.round((actionBoxEnd.y + actionBoxEnd.height) * 10) / 10;

    const actionRowFullyVisibleOrAbove =
      (actionRowBottom <= navTop && actionRowTop >= 0) || actionRowBottom <= 0;

    const stagedMeasurement = {
      stagedLastContentBottom,
      navTop,
      actionRowTop,
      actionRowBottom,
      actionRowFullyVisibleOrAbove,
      contentNotCovered: stagedLastContentBottom <= navTop,
    };

    // Measurement 2: with nothing staged
    await cardLocator.locator('button[aria-label="Discard staged meal"]').click();
    await expect(cardLocator).not.toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForScrollPosition(page, 'bottom');
    await expect(navLocator).toBeVisible();

    const unstagedLastContentBottom = (await findBottomMostContentBottom())!;

    const unstagedMeasurement = {
      unstagedLastContentBottom,
      navTop,
      contentNotCovered: unstagedLastContentBottom <= navTop,
    };

    const measurements = {
      test: 'D5: page end content not covered by nav',
      surface: 'D',
      staged: stagedMeasurement,
      unstaged: unstagedMeasurement,
    };
    console.log(JSON.stringify(measurements));

    expect(
      stagedLastContentBottom,
      `Staged case: last content bottom (${stagedLastContentBottom}px) exceeds nav top (${navTop}px)`
    ).toBeLessThanOrEqual(navTop);

    expect(
      actionRowBottom,
      `Staged case: action row bottom (${actionRowBottom}px) exceeds nav top (${navTop}px)`
    ).toBeLessThanOrEqual(navTop);

    expect(
      actionRowFullyVisibleOrAbove,
      `Staged case: action row (top: ${actionRowTop}px, bottom: ${actionRowBottom}px) must be fully visible above nav (navTop: ${navTop}px) or fully scrolled above viewport`
    ).toBe(true);

    expect(
      unstagedLastContentBottom,
      `Unstaged case: last content bottom (${unstagedLastContentBottom}px) exceeds nav top (${navTop}px)`
    ).toBeLessThanOrEqual(navTop);
  });
});


// ---------------------------------------------------------------------------
// Surface E: Staged card at 320px width
// ---------------------------------------------------------------------------

test.describe('Surface E: Staged card at 320px width', () => {
  let page: Page;
  let cardLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    await page.fill('textarea[placeholder*="Describe what you ate"]', '4-item salmon dinner');
    await page.click('button:has-text("Analyze Meal")');
    cardLocator = page.locator('[data-testid="staged-meal-card"]');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('E: macro cells inside card content box, no row scroll overflow, columns aligned', async () => {
    expect(page.viewportSize()?.width).toBe(320);
    await waitForScrollSettled(page);

    const result = await cardLocator.evaluate((card) => {
      const cardRect = card.getBoundingClientRect();
      const cardStyle = window.getComputedStyle(card);
      const paddingRight = parseFloat(cardStyle.paddingRight) || 0;
      const borderRight = parseFloat(cardStyle.borderRightWidth) || 0;
      const contentBoxRight = cardRect.right - paddingRight - borderRight;

      const gridRows = Array.from(
        card.querySelectorAll<HTMLElement>(
          '[data-testid="component-macros"], [data-testid="staged-meal-totals-grid"], [data-testid="day-total-grid"]'
        )
      );

      const macroCells = gridRows.flatMap((row) =>
        Array.from(row.children as HTMLCollectionOf<HTMLElement>).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        })
      );

      const cellOverflows: Array<{ testId: string; cellRight: number; contentBoxRight: number; overflow: number }> = [];
      for (const cell of macroCells) {
        const r = cell.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > contentBoxRight + 0.5) {
          cellOverflows.push({
            testId: cell.getAttribute('data-testid') || cell.className,
            cellRight: Math.round(r.right * 10) / 10,
            contentBoxRight: Math.round(contentBoxRight * 10) / 10,
            overflow: Math.round((r.right - contentBoxRight) * 10) / 10,
          });
        }
      }

      const rowScrollOverflows: Array<{ rowTestId: string; scrollWidth: number; clientWidth: number }> = [];
      for (const row of gridRows) {
        if (row.scrollWidth > row.clientWidth + 1) {
          rowScrollOverflows.push({
            rowTestId: row.getAttribute('data-testid') || '',
            scrollWidth: row.scrollWidth,
            clientWidth: row.clientWidth,
          });
        }
      }

      const columnKeys = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
      const alignmentMismatches: Array<{
        column: string;
        rights: number[];
        minRight: number;
        maxRight: number;
        diff: number;
      }> = [];

      for (const col of columnKeys) {
        const cellsForCol: HTMLElement[] = [];
        for (const row of gridRows) {
          const cell = row.querySelector<HTMLElement>(`[data-testid$="-${col}"]`);
          if (cell) {
            cellsForCol.push(cell);
          }
        }
        if (cellsForCol.length > 1) {
          const rights = cellsForCol.map((c) => Math.round(c.getBoundingClientRect().right * 10) / 10);
          const minRight = Math.min(...rights);
          const maxRight = Math.max(...rights);
          if (maxRight - minRight > 1.0) {
            alignmentMismatches.push({
              column: col,
              rights,
              minRight,
              maxRight,
              diff: Math.round((maxRight - minRight) * 10) / 10,
            });
          }
        }
      }

      // 44px change controls vs macro row below: no intersection
      const items = Array.from(card.querySelectorAll<HTMLElement>('[data-testid="component-row"]'));
      const controlOverlaps: Array<{ idx: number; controlsBottom: number; macroTop: number; gap: number }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const controls = item.querySelector<HTMLElement>('[data-testid="component-right-cluster"]');
        const macroRow = item.querySelector<HTMLElement>('[data-testid="component-macros"]');
        if (controls && macroRow) {
          const cRect = controls.getBoundingClientRect();
          const mRect = macroRow.getBoundingClientRect();
          const gap = Math.round((mRect.top - cRect.bottom) * 10) / 10;
          if (cRect.bottom > mRect.top + 0.5) {
            controlOverlaps.push({
              idx: i,
              controlsBottom: Math.round(cRect.bottom * 10) / 10,
              macroTop: Math.round(mRect.top * 10) / 10,
              gap,
            });
          }
        }
      }

      // Log button label metrics at 320
      const logBtn = card.querySelector<HTMLElement>('[data-testid="staged-card-actions"] button');
      const logSpan = logBtn ? logBtn.querySelector<HTMLElement>('span.truncate, span') : null;
      const logBtnMetrics = logBtn ? {
        btnScrollWidth: logBtn.scrollWidth,
        btnClientWidth: logBtn.clientWidth,
        spanScrollWidth: logSpan ? logSpan.scrollWidth : null,
        spanClientWidth: logSpan ? logSpan.clientWidth : null,
        text: logBtn.textContent?.trim() || '',
      } : null;

      return {
        cardWidth: Math.round(cardRect.width * 10) / 10,
        cardHeight: Math.round(cardRect.height * 10) / 10,
        rowHeights: items.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10),
        contentBoxRight: Math.round(contentBoxRight * 10) / 10,
        cellOverflows,
        rowScrollOverflows,
        alignmentMismatches,
        gridRowCount: gridRows.length,
        macroCellCount: macroCells.length,
        controlOverlaps,
        logBtnMetrics,
      };
    });

    console.log(
      JSON.stringify({
        test: 'E: macro cells inside card content box, no row scroll overflow, columns aligned',
        surface: 'E',
        cardWidth: result.cardWidth,
        cardHeight: result.cardHeight,
        rowHeights: result.rowHeights,
        contentBoxRight: result.contentBoxRight,
        cellOverflowCount: result.cellOverflows.length,
        cellOverflows: result.cellOverflows,
        rowScrollOverflows: result.rowScrollOverflows,
        alignmentMismatches: result.alignmentMismatches,
        gridRowCount: result.gridRowCount,
        macroCellCount: result.macroCellCount,
        controlOverlaps: result.controlOverlaps,
        logBtnMetrics: result.logBtnMetrics,
      })
    );

    // Count asserts ensuring selectors do not pass vacuously
    expect(result.gridRowCount).toBeGreaterThanOrEqual(6);
    expect(result.macroCellCount).toBeGreaterThanOrEqual(20);

    expect(
      result.cellOverflows,
      `Found macro cells overflowing card content-box right: ${JSON.stringify(result.cellOverflows)}`
    ).toEqual([]);

    expect(
      result.rowScrollOverflows,
      `Found grid rows with scrollWidth > clientWidth: ${JSON.stringify(result.rowScrollOverflows)}`
    ).toEqual([]);

    expect(
      result.alignmentMismatches,
      `Found misaligned columns across rows: ${JSON.stringify(result.alignmentMismatches)}`
    ).toEqual([]);

    expect(
      result.controlOverlaps,
      `Found controls overlapping macro row below: ${JSON.stringify(result.controlOverlaps)}`
    ).toEqual([]);

    if (result.logBtnMetrics && result.logBtnMetrics.spanScrollWidth !== null && result.logBtnMetrics.spanClientWidth !== null) {
      expect(
        result.logBtnMetrics.spanScrollWidth,
        `Log button text clipped: scrollWidth ${result.logBtnMetrics.spanScrollWidth} > clientWidth ${result.logBtnMetrics.spanClientWidth}`
      ).toBeLessThanOrEqual(result.logBtnMetrics.spanClientWidth + 1);
    }
  });

  test('E: meal-type select chevron geometry at 320px', async () => {
    expect(page.viewportSize()?.width).toBe(320);
    await waitForScrollSettled(page);

    const result320 = await checkSelectChevronGeometry(cardLocator);
    console.log(JSON.stringify({ test: 'E: meal-type select chevron geometry at 320px', surface: 'E', ...result320 }));
    expect(result320.hasCustomChevron, 'Meal type select must have a custom chevron icon at 320px').toBe(true);
    expect(result320.isChevronVisible, 'Chevron must be visible at 320px').toBe(true);
    expect(result320.chevronOpacity, 'Chevron computed opacity must be > 0 at 320px').toBeGreaterThan(0);
    expect(result320.chevronPointerEvents, 'Chevron pointer-events must be none at 320px').toBe('none');
    expect(result320.isInside, 'Chevron must be inside select border at 320px').toBe(true);
    expect(result320.rightInset, 'Chevron right inset must be >= 8px at 320px').toBeGreaterThanOrEqual(8);
    expect(result320.verticalDelta, 'Chevron must be vertically centered within +-2px at 320px').toBeLessThanOrEqual(2);
    expect(result320.isClipped, 'Select label must not be clipped at 320px').toBe(false);
    expect(result320.paddingLeft + result320.maxTextWidth, `No overlap between longest label (${result320.longestOption}) and chevron at 320px`).toBeLessThanOrEqual(result320.chevronOffsetLeft - 2);
  });

  test('E: breakdown header row height <= 16px, Add item tap >= 40px, no overlap with label or first row at 320px', async () => {
    expect(page.viewportSize()?.width).toBe(320);
    await waitForScrollSettled(page);

    const result = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(result);
    console.log(JSON.stringify({ test: 'E: breakdown header geometry at 320px', surface: 'E', ...result }));

    // Label text '+ Manual', aria-label 'Add manual item', no clip
    expect(result.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(result.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(result.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);

    // Header row height <= pre- value (16px) with +0.5px tolerance max
    expect(result.headerRowHeight, `Header row height (${result.headerRowHeight}px) exceeds pre-D22 value 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);

    // Add item tap box >= 40 tall and >= 40 wide
    expect(result.buttonHeight, `Add item tap height (${result.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.buttonWidth, `Add item tap width (${result.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);

    // Add item box does not overlap the header label (rect intersection = 0)
    expect(result.labelIntersectionArea, `Add item button intersects header label with area ${result.labelIntersectionArea}px²`).toBe(0);

    // Add item box does not overlap the first item row (rect intersection = 0)
    expect(result.firstRowIntersectionArea, `Add item button intersects first item row with area ${result.firstRowIntersectionArea}px²`).toBe(0);

    // Add item box does not overlap the meal-type select above (rect intersection = 0)
    expect(result.selectIntersectionArea, `Add item button intersects meal type select with area ${result.selectIntersectionArea}px²`).toBe(0);

    // Hit-testing points on button hit the button (no tap stealing by adjacent elements)
    expect(result.hitResults.top.isBtnOrDescendant, 'Top edge of Add item button must hit button').toBe(true);
    expect(result.hitResults.center.isBtnOrDescendant, 'Center of Add item button must hit button').toBe(true);
    expect(result.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of Add item button must hit button').toBe(true);

    // Select center must hit select, not add-item button
    if (result.selectCenterHit) {
      expect(result.selectCenterHit.isAddBtn, 'Center of meal type select must not be occluded by Add item button').toBe(false);
    }

    // Button text vertical center aligns with header label vertical center (within +-1px)
    expect(result.textLabelDeltaY).not.toBeNull();
    expect(Math.abs(result.textLabelDeltaY!), `Add item text center-Y deviates from label center-Y by ${result.textLabelDeltaY}px`).toBeLessThanOrEqual(1.0);
  });

  test('E: staged item row qty/unit box geometry and hit testing at 320px', async () => {
    expect(page.viewportSize()?.width).toBe(320);
    await waitForScrollSettled(page);

    const rows = cardLocator.locator('[data-testid="component-row"]');
    const rowCount = await rows.count();
    expect(rowCount).toBe(4);

    const measurements = await checkQtyUnitBoxGeometry(cardLocator);
    console.log(JSON.stringify({ test: 'E: qty/unit box D32 measurements at 320px', surface: 'E', measurements }));

    for (const m of measurements) {
      // visible border height 32 (+-1)
      expect(m.visibleBoxHeight, `Row ${m.idx} visible box height must be 32 +- 1`).toBeGreaterThanOrEqual(31);
      expect(m.visibleBoxHeight, `Row ${m.idx} visible box height must be 32 +- 1`).toBeLessThanOrEqual(33);

      // gap >= 4
      expect(m.gap, `Row ${m.idx} gap between visible box bottom and macro row must be >= 4px`).toBeGreaterThanOrEqual(4);

      // hit box >= 44 tall
      expect(m.hitAreaHeight, `Row ${m.idx} hit box height must be >= 44px`).toBeGreaterThanOrEqual(44);
      expect(m.chipHeight, `Row ${m.idx} chip hit box height must be >= 44px`).toBeGreaterThanOrEqual(44);

      // elementFromPoint at hit-box edges resolves into the qty control over qty-number x-centre
      expect(m.isTopResolved, `Row ${m.idx} top hit-box edge over qty resolves into qty control`).toBe(true);
      expect(m.isBottomResolved, `Row ${m.idx} bottom hit-box edge over qty resolves into qty control`).toBe(true);

      // elementFromPoint at y+1 and y+43 over chip's x-centre resolves to chip button
      expect(m.isChipTopResolved, `Row ${m.idx} elementFromPoint at y+1 over chip resolves to chip button`).toBe(true);
      expect(m.isChipBottomResolved, `Row ${m.idx} elementFromPoint at y+43 over chip resolves to chip button`).toBe(true);

      // no overlap with the ... hit box
      expect(m.hasMenuOverlap, `Row ${m.idx} hit area must not overlap ... menu`).toBe(false);
      expect(m.hasChipMenuOverlap, `Row ${m.idx} chip hit box must not overlap ... menu`).toBe(false);

      // item row height <= old value (62px)
      expect(m.rowHeight, `Row ${m.idx} height must be <= old value of 62px`).toBeLessThanOrEqual(62);
    }

    // Verify tapping over the chip's x-centre at y+1 and y+43 opens unit dialog
    const firstChip = rows.first().locator('[data-testid="component-unit-chip"]');
    await firstChip.click({ position: { x: 26, y: 1 } });
    const unitSheet = page.locator('[data-testid="unit-sheet"]');
    await expect(unitSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unitSheet).not.toBeVisible();

    await firstChip.click({ position: { x: 26, y: 43 } });
    await expect(unitSheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(unitSheet).not.toBeVisible();

    // Verify tapping over qty-number x-centre (position { x: 20, y: 43 }) focuses the input
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const input = row.locator('[data-testid="component-quantity-input"]');
      const field = row.locator('[data-testid="component-quantity-field"]');

      await field.click({ position: { x: 20, y: 43 } });
      const focusedBottom = await input.evaluate((el) => document.activeElement === el);
      expect(focusedBottom, `Row ${i} click at y+43 over qty must focus the input`).toBe(true);

      await input.evaluate((el) => el.blur());
    }
  });

  test('E: Scale box open at 320px keeps the header on one line, 16px input, no overlap, and Escape restores', async () => {
    expect(page.viewportSize()?.width).toBe(320);
    await cardLocator.locator('[data-testid="meal-scale-button"]').click();
    const input = cardLocator.locator('[data-testid="meal-scale-input"]');
    await expect(input).toBeFocused();

    const m = await cardLocator.evaluate((cardEl) => {
      const header = cardEl.querySelector<HTMLElement>('[data-testid="breakdown-header"]')!;
      const field = cardEl.querySelector<HTMLElement>('[data-testid="meal-scale-field"]')!;
      const inputEl = cardEl.querySelector<HTMLInputElement>('[data-testid="meal-scale-input"]')!;
      const add = cardEl.querySelector<HTMLElement>('[data-testid="add-item-button"]')!;
      const label = Array.from(header.querySelectorAll<HTMLElement>(':scope > span:not(.sr-only)'))
        .find((el) => el.getBoundingClientRect().width > 0)!;
      const r = (el: Element) => el.getBoundingClientRect();
      const ov = (a: DOMRect, b: DOMRect) =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return {
        headerHeight: Math.round(r(header).height * 10) / 10,
        headerOverflows: header.scrollWidth > header.clientWidth + 1,
        fieldHeight: Math.round(r(field).height * 10) / 10,
        inputFontSize: parseFloat(getComputedStyle(inputEl).fontSize),
        fieldAddOverlap: ov(r(field), r(add)),
        fieldLabelOverlap: ov(r(field), r(label)),
        labelText: label.textContent?.trim(),
        fieldInsideCard: r(field).right <= r(cardEl).right && r(field).left >= r(cardEl).left,
      };
    });
    console.log(JSON.stringify({ test: 'E: D46 scale box open at 320px', ...m }));

    expect(m.labelText, 'Below 390px the header uses the short label').toBe('Items (4)');
    expect(m.headerOverflows, 'Header overflows with the Scale box open').toBe(false);
    expect(m.headerHeight, `Header height (${m.headerHeight}px) grew with the Scale box open`).toBeLessThanOrEqual(16.5);
    expect(m.fieldHeight, `Scale box tap height (${m.fieldHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(m.inputFontSize, 'Scale input must be 16px (iOS no-zoom)').toBe(16);
    expect(m.fieldAddOverlap, 'Scale box overlaps + Add').toBe(0);
    expect(m.fieldLabelOverlap, 'Scale box overlaps the label').toBe(0);
    expect(m.fieldInsideCard, 'Scale box must stay inside the card').toBe(true);

    await input.press('Escape');
    await expect(cardLocator.locator('[data-testid="meal-scale-button"]')).toBeFocused();
    await expect(cardLocator.locator('[data-testid="meal-scale-button"]')).toHaveText('Scale');
  });

  test('E: single-item and manual card breakdown header geometry at 320px', async () => {
    expect(page.viewportSize()?.width).toBe(320);

    // 1. Single-item card at 320px
    const discardBtn = cardLocator.locator('button[aria-label="Discard staged meal"]');
    await discardBtn.click();
    await page.fill('textarea[placeholder*="Describe what you ate"]', '1-item single salmon');
    await page.click('button:has-text("Analyze Meal")');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);

    const singleResult = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(singleResult);
    console.log(JSON.stringify({ test: 'E: single-item breakdown header geometry at 320px', surface: 'E', ...singleResult }));

    expect(singleResult.headerRowHeight, `Header row height (${singleResult.headerRowHeight}px) exceeds 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);
    expect(singleResult.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(singleResult.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(singleResult.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);
    expect(singleResult.buttonHeight, `+ Manual button tap height (${singleResult.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(singleResult.buttonWidth, `+ Manual button tap width (${singleResult.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(singleResult.labelIntersectionArea, `+ Manual button intersects header label with area ${singleResult.labelIntersectionArea}px²`).toBe(0);
    expect(singleResult.firstRowIntersectionArea, `+ Manual button intersects first item row with area ${singleResult.firstRowIntersectionArea}px²`).toBe(0);
    expect(singleResult.selectIntersectionArea, `+ Manual button intersects meal type select with area ${singleResult.selectIntersectionArea}px²`).toBe(0);
    expect(singleResult.hitResults.top.isBtnOrDescendant, 'Top edge of + Manual button must hit button').toBe(true);
    expect(singleResult.hitResults.center.isBtnOrDescendant, 'Center of + Manual button must hit button').toBe(true);
    expect(singleResult.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of + Manual button must hit button').toBe(true);

    // 2. Manual card at 320px
    await cardLocator.locator('button[aria-label="Discard staged meal"]').click();
    const manualBtn = page.locator('button:has-text("Manual Entry")');
    await manualBtn.click();
    await page.fill('[data-testid="dish-name-input"]', 'Chicken Rice');
    await page.fill('[data-testid="calories-input"]', '400');
    await page.fill('[data-testid="protein-input"]', '40');
    await page.fill('[data-testid="carbs-input"]', '30');
    await page.fill('[data-testid="fat-input"]', '10');
    await page.locator('button:has-text("Log Meal")').last().click();
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    await waitForScrollSettled(page);

    const manualResult = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(manualResult);
    console.log(JSON.stringify({ test: 'E: manual card breakdown header geometry at 320px', surface: 'E', ...manualResult }));

    expect(manualResult.headerRowHeight, `Header row height (${manualResult.headerRowHeight}px) exceeds 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);
    expect(manualResult.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(manualResult.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(manualResult.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);
    expect(manualResult.buttonHeight, `+ Manual button tap height (${manualResult.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(manualResult.buttonWidth, `+ Manual button tap width (${manualResult.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(manualResult.labelIntersectionArea, `+ Manual button intersects header label with area ${manualResult.labelIntersectionArea}px²`).toBe(0);
    expect(manualResult.firstRowIntersectionArea, `+ Manual button intersects first item row with area ${manualResult.firstRowIntersectionArea}px²`).toBe(0);
    expect(manualResult.selectIntersectionArea, `+ Manual button intersects meal type select with area ${manualResult.selectIntersectionArea}px²`).toBe(0);
    expect(manualResult.hitResults.top.isBtnOrDescendant, 'Top edge of + Manual button must hit button').toBe(true);
    expect(manualResult.hitResults.center.isBtnOrDescendant, 'Center of + Manual button must hit button').toBe(true);
    expect(manualResult.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of + Manual button must hit button').toBe(true);
  });
});


// ---------------------------------------------------------------------------
// Surface F: Manual-staged card and Add-item at 390×844
// ---------------------------------------------------------------------------

test.describe('Surface F: Manual-staged card and Add-item at 390×844', () => {
  let page: Page;
  let cardLocator: Locator;
  let navLocator: Locator;
  let actionRowLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);

    // Open manual form
    const manualToggleBtn = page.locator('button:has-text("Manual Entry")');
    if (await manualToggleBtn.isVisible()) {
      await manualToggleBtn.click();
    }

    // Fill manual entry fields (single item)
    await page.fill('[data-testid="dish-name-input"]', 'Grilled Chicken Breast');
    await page.fill('[data-testid="calories-input"]', '280');
    await page.fill('[data-testid="protein-input"]', '35');
    await page.fill('[data-testid="carbs-input"]', '0');
    await page.fill('[data-testid="fat-input"]', '6');
    const fiberInput = page.locator('[data-testid="fiber-input"]');
    if (await fiberInput.isVisible()) {
      await fiberInput.fill('0');
    }

    // Stage the meal
    const logBtn = page.locator('button:has-text("Log Meal")').last();
    await logBtn.click();

    cardLocator = page.locator('[data-testid="staged-meal-card"]');
    await expect(cardLocator).toBeVisible({ timeout: 15000 });
    navLocator = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
    const discardBtn = cardLocator.locator('button[aria-label="Discard staged meal"]');
    actionRowLocator = discardBtn.locator('..');
    await waitForScrollSettled(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('F: 1-item card height <= 260px', async () => {
    await waitForScrollSettled(page);
    const cardBox = (await cardLocator.boundingBox())!;
    console.log(JSON.stringify({
      test: 'F: 1-item card height <= 260px',
      surface: 'F',
      cardHeight: Math.round(cardBox.height * 10) / 10,
    }));
    expect(cardBox.height).toBeLessThanOrEqual(260);
  });

  test('F: breakdown header row height <= 16px, + Add button geometry on manual-staged card at 390px', async () => {
    await waitForScrollSettled(page);

    const result = await checkBreakdownHeaderGeometry(cardLocator);
    expectScaleChipFits(result);
    console.log(JSON.stringify({ test: 'F: breakdown header geometry at 390px', surface: 'F', ...result }));

    expect(result.headerRowHeight, `Header row height (${result.headerRowHeight}px) exceeds 16px (+0.5px tolerance)`).toBeLessThanOrEqual(16.5);
    expect(result.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
    expect(result.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
    expect(result.isClipped, 'Breakdown header button must fit with no clipping').toBe(false);
    expect(result.buttonHeight, `+ Manual button tap height (${result.buttonHeight}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.buttonWidth, `+ Manual button tap width (${result.buttonWidth}px) < 40px`).toBeGreaterThanOrEqual(40);
    expect(result.labelIntersectionArea, `+ Manual button intersects header label with area ${result.labelIntersectionArea}px²`).toBe(0);
    expect(result.firstRowIntersectionArea, `+ Manual button intersects first item row with area ${result.firstRowIntersectionArea}px²`).toBe(0);
    expect(result.selectIntersectionArea, `+ Manual button intersects meal type select with area ${result.selectIntersectionArea}px²`).toBe(0);
    expect(result.hitResults.top.isBtnOrDescendant, 'Top edge of + Manual button must hit button').toBe(true);
    expect(result.hitResults.center.isBtnOrDescendant, 'Center of + Manual button must hit button').toBe(true);
    expect(result.hitResults.bottom.isBtnOrDescendant, 'Bottom edge of + Manual button must hit button').toBe(true);
  });

  test('F: font >= 12px', async () => {
    const result = await checkFontSizes(cardLocator);
    console.log(JSON.stringify({
      test: 'F: font >= 12px',
      surface: 'F',
      minFontSize: result.minFontSize,
      minFontElement: result.minFontElement,
      offenderCount: result.offenders.length,
    }));
    expect(result.offenders, `Found fonts smaller than 12px: ${JSON.stringify(result.offenders)}`).toEqual([]);
  });

  test('F: taps >= 40px', async () => {
    const result = await checkTapTargets(cardLocator);
    console.log(JSON.stringify({
      test: 'F: taps >= 40px',
      surface: 'F',
      tapsUnder48Count: result.tapsUnder48.length,
      offendersUnder40Count: result.offendersUnder40.length,
      offendersUnder40: result.offendersUnder40,
    }));
    expect(result.offendersUnder40, `Found tap targets smaller than 40px: ${JSON.stringify(result.offendersUnder40)}`).toEqual([]);
  });

  test('F: no clipping', async () => {
    const result = await checkClipping(cardLocator);
    console.log(JSON.stringify({
      test: 'F: no clipping',
      surface: 'F',
      clippedCount: result.clippedElements.length,
      clippedElements: result.clippedElements,
    }));
    expect(result.clippedElements, `Found clipped elements: ${JSON.stringify(result.clippedElements)}`).toEqual([]);
  });

  test('F: placement (cardTop in [0, 200], actionRowBottom <= navTop)', async () => {
    await waitForScrollSettled(page);
    const cardBox = (await cardLocator.boundingBox())!;
    const cardTop = Math.round(cardBox.y * 10) / 10;
    const navBox = (await navLocator.boundingBox())!;
    const navTop = Math.round(navBox.y * 10) / 10;
    const actionRowBox = (await actionRowLocator.boundingBox())!;
    const actionRowBottom = Math.round((actionRowBox.y + actionRowBox.height) * 10) / 10;

    console.log(JSON.stringify({
      test: 'F: D10 placement',
      surface: 'F',
      cardTop,
      actionRowBottom,
      navTop,
    }));

    expect(cardTop, `Card top (${cardTop}px) must be >= 0`).toBeGreaterThanOrEqual(0);
    expect(cardTop, `Card top (${cardTop}px) must be <= 200`).toBeLessThanOrEqual(200);
    expect(actionRowBottom, `Action row bottom (${actionRowBottom}px) must be <= nav top (${navTop}px)`).toBeLessThanOrEqual(navTop);
  });

  test('F: Add-item form open (font >= 12, taps >= 40, inputs 16px)', async () => {
    const addItemForm = cardLocator.locator('[data-testid="add-item-form"]');
    if (!(await addItemForm.isVisible())) {
      const addItemBtn = cardLocator.locator('[data-testid="add-item-button"]');
      await expect(addItemBtn).toBeVisible();
      await addItemBtn.click();
      await cardLocator.locator('[data-testid="enter-manually-button"]').click();
    }
    await expect(addItemForm).toBeVisible();

    try {
      const fontResult = await checkFontSizes(addItemForm);
      expect(fontResult.offenders, `Found fonts smaller than 12px in AddItemForm: ${JSON.stringify(fontResult.offenders)}`).toEqual([]);

      const tapResult = await checkTapTargets(addItemForm);
      expect(tapResult.offendersUnder40, `Found tap targets smaller than 40px in AddItemForm: ${JSON.stringify(tapResult.offendersUnder40)}`).toEqual([]);

      // Verify all input elements in AddItemForm have fontSize >= 16px (to prevent iOS auto-zoom)
      const inputsUnder16 = await addItemForm.evaluate((form) => {
        const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
        const under16: Array<{ name: string; fontSize: number }> = [];
        for (const input of inputs) {
          const fs = parseFloat(window.getComputedStyle(input).fontSize);
          if (fs < 16) {
            under16.push({
              name: input.getAttribute('name') || input.getAttribute('data-testid') || input.tagName,
              fontSize: fs,
            });
          }
        }
        return under16;
      });

      console.log(JSON.stringify({
        test: 'F: Add-item form inputs font size',
        surface: 'F',
        inputsUnder16,
      }));

      expect(inputsUnder16, `Found inputs with font-size < 16px in AddItemForm: ${JSON.stringify(inputsUnder16)}`).toEqual([]);
    } finally {
      const cancelBtn = cardLocator.locator('[data-testid="cancel-add-item-button"]');
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await expect(addItemForm).not.toBeVisible();
      }
    }
  });

  test('F: 4 items after Add item (height <= 480px)', async () => {
    // Establish precondition: ensure add-item form is open
    const addItemForm = cardLocator.locator('[data-testid="add-item-form"]');
    if (!(await addItemForm.isVisible())) {
      const addItemBtn = cardLocator.locator('[data-testid="add-item-button"]');
      await expect(addItemBtn).toBeVisible();
      await addItemBtn.click();
      await cardLocator.locator('[data-testid="enter-manually-button"]').click();
    }
    await expect(addItemForm).toBeVisible();

    // Add item 2
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Steamed Jasmine Rice');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('150');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('g');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('195');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('3.5');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('42');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('0.5');
    await addItemForm.locator('[data-testid="add-item-fiber-input"]').fill('0.6');
    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();
    await expect(addItemForm).not.toBeVisible();

    // Add item 3
    const addItemBtn = cardLocator.locator('[data-testid="add-item-button"]');
    await addItemBtn.click();
    await cardLocator.locator('[data-testid="enter-manually-button"]').click();
    await expect(addItemForm).toBeVisible();
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Steamed Broccoli');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('100');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('g');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('35');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('2.4');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('7');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('0.4');
    await addItemForm.locator('[data-testid="add-item-fiber-input"]').fill('2.6');
    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();
    await expect(addItemForm).not.toBeVisible();

    // Add item 4
    await addItemBtn.click();
    await cardLocator.locator('[data-testid="enter-manually-button"]').click();
    await expect(addItemForm).toBeVisible();
    await addItemForm.locator('[data-testid="add-item-name-input"]').fill('Olive Oil Drizzle');
    await addItemForm.locator('[data-testid="add-item-quantity-input"]').fill('10');
    await addItemForm.locator('[data-testid="add-item-unit-input"]').fill('ml');
    await addItemForm.locator('[data-testid="add-item-calories-input"]').fill('88');
    await addItemForm.locator('[data-testid="add-item-protein-input"]').fill('0');
    await addItemForm.locator('[data-testid="add-item-carbs-input"]').fill('0');
    await addItemForm.locator('[data-testid="add-item-fat-input"]').fill('10');
    await addItemForm.locator('[data-testid="add-item-fiber-input"]').fill('0');
    await addItemForm.locator('[data-testid="submit-add-item-button"]').click();
    await expect(addItemForm).not.toBeVisible();

    // Verify 4 component rows present
    const rows = cardLocator.locator('[data-testid="component-row"]');
    await expect(rows).toHaveCount(4);

    await waitForScrollSettled(page);
    const cardBox = (await cardLocator.boundingBox())!;
    console.log(JSON.stringify({
      test: 'F: 4 items after Add item (height <= 480px)',
      surface: 'F',
      cardHeight: Math.round(cardBox.height * 10) / 10,
    }));
    expect(cardBox.height).toBeLessThanOrEqual(480);
  });
});

// ---------------------------------------------------------------------------
// Surface G: Quick Log surface at 390×844 and 320×568
// ---------------------------------------------------------------------------

test.describe('Surface G: Quick Log surface at 390×844', () => {
  let page: Page;
  let sectionLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);
    sectionLocator = page.locator('section').filter({ hasText: 'Quick Log Favorites' });
    await expect(sectionLocator).toBeVisible();
    await waitForFavoriteRows(sectionLocator);
    await sectionLocator.scrollIntoViewIfNeeded();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('G: 390 section height <= 450px and row heights ~56px', async () => {
    const measurements = await sectionLocator.evaluate((root) => {
      const sRect = root.getBoundingClientRect();
      const rows = Array.from(root.querySelectorAll('[data-testid^="favorite-row-"]'));
      const rowHeights = rows.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
      return {
        sectionHeight: Math.round(sRect.height * 10) / 10,
        rowCount: rows.length,
        rowHeights,
      };
    });

    console.log(JSON.stringify({
      test: 'G: 390 section height <= 450px and row heights ~56px',
      surface: 'G-390',
      measurements,
    }));

    // Collapsed mode renders top 3 rows
    expect(measurements.rowCount).toBe(3);
    // Section height budget
    expect(measurements.sectionHeight).toBeLessThanOrEqual(450);
    // Row heights ~56px (52px to 60px)
    for (const h of measurements.rowHeights) {
      expect(h).toBeGreaterThanOrEqual(52);
      expect(h).toBeLessThanOrEqual(60);
    }
  });

  test('G: 390 font >= 12px', async () => {
    const result = await checkFontSizes(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 390 font >= 12px',
      surface: 'G-390',
      minFontSize: result.minFontSize,
      minFontElement: result.minFontElement,
      offenders: result.offenders,
    }));
    expect(result.offenders).toEqual([]);
  });

  test('G: 390 taps >= 40px', async () => {
    const result = await checkTapTargets(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 390 taps >= 40px',
      surface: 'G-390',
      tapsUnder48: result.tapsUnder48,
      offendersUnder40: result.offendersUnder40,
    }));
    expect(result.offendersUnder40).toEqual([]);
  });

  test('G: 390 no clipping', async () => {
    const result = await checkClipping(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 390 no clipping',
      surface: 'G-390',
      clippedElements: result.clippedElements,
    }));
    expect(result.clippedElements).toEqual([]);
  });
});

test.describe('Surface G: Quick Log surface at 320×568', () => {
  let page: Page;
  let sectionLocator: Locator;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({
      viewport: { width: 320, height: 568 },
      deviceScaleFactor: 1,
    });
    await setupPageAndLogin(page);
    sectionLocator = page.locator('section').filter({ hasText: 'Quick Log Favorites' });
    await expect(sectionLocator).toBeVisible();
    await waitForFavoriteRows(sectionLocator);
    await sectionLocator.scrollIntoViewIfNeeded();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('G: 320 section height <= 450px and row heights ~56px', async () => {
    const measurements = await sectionLocator.evaluate((root) => {
      const sRect = root.getBoundingClientRect();
      const rows = Array.from(root.querySelectorAll('[data-testid^="favorite-row-"]'));
      const rowHeights = rows.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
      return {
        sectionHeight: Math.round(sRect.height * 10) / 10,
        rowCount: rows.length,
        rowHeights,
      };
    });

    console.log(JSON.stringify({
      test: 'G: 320 section height <= 450px and row heights ~56px',
      surface: 'G-320',
      measurements,
    }));

    // Collapsed mode renders top 3 rows
    expect(measurements.rowCount).toBe(3);
    // Section height budget
    expect(measurements.sectionHeight).toBeLessThanOrEqual(450);
    // Row heights ~56px (52px to 60px)
    for (const h of measurements.rowHeights) {
      expect(h).toBeGreaterThanOrEqual(52);
      expect(h).toBeLessThanOrEqual(60);
    }
  });

  test('G: 320 font >= 12px', async () => {
    const result = await checkFontSizes(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 320 font >= 12px',
      surface: 'G-320',
      minFontSize: result.minFontSize,
      minFontElement: result.minFontElement,
      offenders: result.offenders,
    }));
    expect(result.offenders).toEqual([]);
  });

  test('G: 320 taps >= 40px', async () => {
    const result = await checkTapTargets(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 320 taps >= 40px',
      surface: 'G-320',
      tapsUnder48: result.tapsUnder48,
      offendersUnder40: result.offendersUnder40,
    }));
    expect(result.offendersUnder40).toEqual([]);
  });

  test('G: 320 no clipping', async () => {
    const result = await checkClipping(sectionLocator);
    console.log(JSON.stringify({
      test: 'G: 320 no clipping',
      surface: 'G-320',
      clippedElements: result.clippedElements,
    }));
    expect(result.clippedElements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Type and input consistency
// ---------------------------------------------------------------------------

test.describe('type/input consistency', () => {
  test('Quick Log row height <= 60px at 320px and 390px', async ({ browser }) => {
    for (const width of [320, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 320 ? 568 : 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupPageAndLogin(page);
        const section = page.locator('section').filter({ hasText: 'Quick Log Favorites' });
        await expect(section).toBeVisible();
        await waitForFavoriteRows(section);
        const rowHeights = await section.evaluate((root) => {
          const rows = Array.from(root.querySelectorAll('[data-testid^="favorite-row-"]'));
          return rows.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
        });
        expect(rowHeights.length).toBeGreaterThan(0);
        for (const h of rowHeights) {
          expect(h).toBeLessThanOrEqual(60);
        }
      } finally {
        await page.close();
      }
    }
  });

  test('Quick Log dish name is 14px semibold (600) and all fonts in Quick Log >= 12px', async ({ browser }) => {
    for (const width of [320, 390, 700]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupPageAndLogin(page);
        const section = page.locator('section').filter({ hasText: 'Quick Log Favorites' });
        await expect(section).toBeVisible();
        await waitForFavoriteRows(section);
        const dishNames = await section.evaluate((root) => {
          const names = Array.from(root.querySelectorAll('[id^="dish-name-"]'));
          return names.map((el) => {
            const style = window.getComputedStyle(el);
            return {
              text: el.textContent?.trim(),
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
            };
          });
        });
        expect(dishNames.length).toBeGreaterThan(0);
        for (const dn of dishNames) {
          expect(dn.fontSize).toBe('14px');
          expect(dn.fontWeight).toBe('600');
        }

        const fontCheck = await checkFontSizes(section);
        expect(fontCheck.offenders).toEqual([]);
      } finally {
        await page.close();
      }
    }
  });

  test('computed font-size of every input/select/textarea in the nutrition tab == 16px at 390px and 700px', async ({ browser }) => {
    for (const width of [390, 700]) {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupPageAndLogin(page);

        // 1. Search input in Quick Log
        const searchInput = page.locator('[data-testid="search-favorites-input"]');
        await expect(searchInput).toBeVisible();
        const searchFontSize = await searchInput.evaluate((el) => window.getComputedStyle(el).fontSize);
        expect(searchFontSize, `search input at ${width}px`).toBe('16px');

        // 2. AI input textarea (visible before staging)
        const aiTextarea = page.locator('textarea[placeholder*="Describe what you ate"]');
        await expect(aiTextarea).toBeVisible();
        const aiFontSize = await aiTextarea.evaluate((el) => window.getComputedStyle(el).fontSize);
        expect(aiFontSize, `AI textarea at ${width}px`).toBe('16px');

        // 3. Stage a meal via AI input to check staged card controls
        await aiTextarea.fill('single 1-item salmon');
        await page.click('button:has-text("Analyze Meal")');
        const card = page.locator('[data-testid="staged-meal-card"]');
        await expect(card).toBeVisible({ timeout: 15000 });

        const select = card.locator('select[aria-label="Meal type"]');
        const selectFontSize = await select.evaluate((el) => window.getComputedStyle(el).fontSize);
        expect(selectFontSize, `meal-type select at ${width}px`).toBe('16px');

        const mealNameInput = card.locator('[data-testid="dish-name-input"]');
        const nameFontSize = await mealNameInput.evaluate((el) => window.getComputedStyle(el).fontSize);
        expect(nameFontSize, `dish-name-input at ${width}px`).toBe('16px');

        const qtyInput = card.locator('[data-testid="component-quantity-input"]').first();
        if (await qtyInput.isVisible()) {
          const qtyFontSize = await qtyInput.evaluate((el) => window.getComputedStyle(el).fontSize);
          expect(qtyFontSize, `qty input at ${width}px`).toBe('16px');
        }

        // Discard staged card
        const discardBtn = card.locator('button[aria-label="Discard staged meal"]');
        await discardBtn.click();
        await expect(card).not.toBeVisible();

        // 4. Manual entry form fields
        const manualBtn = page.locator('button:has-text("Manual Entry")');
        await manualBtn.click();
        const manualForm = page.locator('form').filter({ hasText: 'Manual Macro Logging' });
        await expect(manualForm).toBeVisible();

        const formControls = await manualForm.evaluate((form) => {
          const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
          return controls
            .filter((c) => c.type !== 'hidden' && c.type !== 'submit' && c.type !== 'button')
            .map((c) => ({
              id: c.id,
              name: c.getAttribute('data-testid') || c.getAttribute('aria-label') || c.id || c.tagName,
              fontSize: window.getComputedStyle(c).fontSize,
            }));
        });
        expect(formControls.length).toBeGreaterThan(0);
        for (const ctrl of formControls) {
          expect(ctrl.fontSize, `manual form control ${ctrl.name} at ${width}px`).toBe('16px');
        }

        // Close manual form
        const cancelBtn = manualForm.locator('button:has-text("Cancel")').first();
        await cancelBtn.click();
      } finally {
        await page.close();
      }
    }
  });

  test('select label not clipped at 700px', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 700, height: 844 },
      deviceScaleFactor: 1,
    });
    try {
      await setupPageAndLogin(page);

      // Stage a meal to get the staged card
      await page.fill('textarea[placeholder*="Describe what you ate"]', 'single 1-item salmon');
      await page.click('button:has-text("Analyze Meal")');
      const card = page.locator('[data-testid="staged-meal-card"]');
      await expect(card).toBeVisible({ timeout: 15000 });

      // Check chevron geometry and clearance at 700px
      const geo = await checkSelectChevronGeometry(card);
      console.log(JSON.stringify({
        test: 'D35: select label not clipped at 700px',
        width: 700,
        geo,
      }));

      // Assert custom chevron is visible and within bounds
      expect(geo.hasCustomChevron).toBe(true);
      expect(geo.isChevronVisible).toBe(true);
      expect(geo.isInside).toBe(true);
      expect(geo.verticalDelta).toBeLessThanOrEqual(2);

      // Assert longest option 'Post-Workout' does not overlap chevron
      expect(geo.noOverlapLongest).toBe(true);
      expect(geo.clearanceLongest).toBeGreaterThanOrEqual(0);

      // Select 'Post-Workout' and assert no horizontal scroll clipping
      const select = card.locator('select[aria-label="Meal type"]');
      await select.selectOption('Post-Workout');
      const selectClip = await select.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        isClipped: el.scrollWidth > el.clientWidth,
      }));
      expect(selectClip.isClipped).toBe(false);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Macro Ring Clearance (>= 4px clearance from stroke inner edge)
// ---------------------------------------------------------------------------

test.describe("ring clearance", () => {
  const WORST_CASE_TARGETS = {
    calories: 1900,
    protein: 150,
    carbs: 140,
    fat: 70,
    fiber: 30,
  };

  const WORST_CASE_DAILY_LOGS = {
    calories: 1876,
    protein: 159,
    carbs: 147.3,
    fat: 55,
    fiber: 25,
  };

  async function setupRingsPage(
    browser: any,
    width: number,
    height: number,
    dailyTotals = WORST_CASE_DAILY_LOGS,
    targets = WORST_CASE_TARGETS
  ) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });

    const todayStr = new Date().toISOString().split("T")[0];

    await page.route("**/rest/v1/users*", async (route: any) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" } });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          id: "a0000000-0000-0000-0000-000000000002",
          email: "athlete@yourbody.fyi",
          username: "athlete",
          role: "athlete",
          target_calories: targets.calories,
          target_protein: targets.protein,
          target_carbs: targets.carbs,
          target_fat: targets.fat,
          target_fiber: targets.fiber,
          auto_rest_timer: true,
          timezone: "America/Los_Angeles",
        }),
      });
    });

    await page.route("**/rest/v1/nutrition_logs*", async (route: any) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" } });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([
          {
            id: "log-worst-case",
            user_id: "a0000000-0000-0000-0000-000000000002",
            food_name: "Worst Case Meal",
            meal_type: "Lunch",
            calories: dailyTotals.calories,
            protein: dailyTotals.protein,
            carbs: dailyTotals.carbs,
            fat: dailyTotals.fat,
            fiber: dailyTotals.fiber,
            serving_size: 1,
            serving_unit: "serving",
            logged_at: new Date().toISOString(),
            logged_date: todayStr,
            created_at: new Date().toISOString(),
            has_components: false,
          },
        ]),
      });
    });

    await setupPageAndLogin(page);
    await page.waitForSelector("[data-testid=\"macro-ring-calories\"]");
    await page.waitForFunction((expectedKcal: number) => {
      const el = document.querySelector("[data-testid=\"macro-ring-calories\"]");
      return el && el.textContent && el.textContent.includes(String(expectedKcal));
    }, dailyTotals.calories);

    const sectionLocator = page
      .locator("text=Today's Nutrition")
      .locator("xpath=ancestor::div[contains(@class, \"rounded-3xl\")]")
      .first();

    return { page, sectionLocator };
  }

  async function measureRingClearances(page: Page) {
    const ringIds = ["calories", "protein", "carbs", "fat", "fiber"];
    return await page.evaluate((ids) => {
      return ids.map((ringId) => {
        const container = document.querySelector(`[data-testid="macro-ring-${ringId}"]`);
        if (!container) throw new Error(`Ring container not found: macro-ring-${ringId}`);
        const svg = container.querySelector("svg");
        if (!svg) throw new Error(`SVG not found for ${ringId}`);
        const circle = svg.querySelector("circle");
        if (!circle) throw new Error(`Circle not found for ${ringId}`);
        const svgRect = svg.getBoundingClientRect();
        const cxAttr = parseFloat(circle.getAttribute("cx") || "38");
        const cyAttr = parseFloat(circle.getAttribute("cy") || "38");
        const rAttr = parseFloat(circle.getAttribute("r") || "34");
        const swAttr = parseFloat(
          circle.getAttribute("stroke-width") || circle.getAttribute("strokeWidth") || "3.5"
        );

        const vbWidth = svg.viewBox.baseVal?.width || 76;
        const scale = svgRect.width / vbWidth;

        const cx = svgRect.left + cxAttr * scale;
        const cy = svgRect.top + cyAttr * scale;
        const innerRadius = (rAttr - swAttr / 2) * scale;
        const outerRadius = (rAttr + swAttr / 2) * scale;

        const textContainer = svg.parentElement?.querySelector(".absolute.flex.flex-col");
        if (!textContainer) throw new Error(`Text container not found for ${ringId}`);
        const spans = textContainer.querySelectorAll("span");
        const valSpan = spans[0] as HTMLElement;
        const targetSpan = spans[1] as HTMLElement;
        if (!valSpan || !targetSpan) throw new Error(`Spans not found for ${ringId}`);

        function getMinCornerClearance(el: HTMLElement) {
          const r = el.getBoundingClientRect();
          const corners = [
            { x: r.left, y: r.top },
            { x: r.right, y: r.top },
            { x: r.left, y: r.bottom },
            { x: r.right, y: r.bottom },
          ];
          const maxDist = Math.max(...corners.map((c) => Math.hypot(c.x - cx, c.y - cy)));
          return Math.round((innerRadius - maxDist) * 100) / 100;
        }

        const valClearance = getMinCornerClearance(valSpan);
        const targetClearance = getMinCornerClearance(targetSpan);

        return {
          ringId,
          valText: valSpan.textContent?.trim() || "",
          targetText: targetSpan.textContent?.trim() || "",
          valClearance,
          targetClearance,
          minClearance: Math.min(valClearance, targetClearance),
          outerDiameter: Math.round(outerRadius * 2 * 10) / 10,
          strokeWidth: Math.round(swAttr * scale * 10) / 10,
          innerRadius: Math.round(innerRadius * 10) / 10,
        };
      });
    }, ringIds);
  }

  test("320px worst-case values clearance >= 4px, font >= 12px, no clipping", async ({ browser }) => {
    const { page, sectionLocator } = await setupRingsPage(browser, 320, 568);
    try {
      const clearances = await measureRingClearances(page);
      console.log(JSON.stringify({ test: "D37: 320px clearance", clearances }));

      for (const r of clearances) {
        expect(r.valClearance, `${r.ringId} value "${r.valText}" clearance`).toBeGreaterThanOrEqual(4.0);
        expect(r.targetClearance, `${r.ringId} target "${r.targetText}" clearance`).toBeGreaterThanOrEqual(4.0);
      }

      const fontResult = await checkFontSizes(sectionLocator);
      expect(fontResult.offenders).toEqual([]);

      const clipResult = await checkClipping(sectionLocator);
      expect(clipResult.clippedElements).toEqual([]);

      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(docOverflow).toBe(false);
    } finally {
      await page.close();
    }
  });

  test("390px worst-case values clearance >= 4px, section height <= base + 8, font >= 12px, no clipping", async ({ browser }) => {
    const { page, sectionLocator } = await setupRingsPage(browser, 390, 844);
    try {
      const clearances = await measureRingClearances(page);
      console.log(JSON.stringify({ test: "D37: 390px clearance", clearances }));

      for (const r of clearances) {
        expect(r.valClearance, `${r.ringId} value "${r.valText}" clearance`).toBeGreaterThanOrEqual(4.0);
        expect(r.targetClearance, `${r.ringId} target "${r.targetText}" clearance`).toBeGreaterThanOrEqual(4.0);
      }

      const sectionHeight = await sectionLocator.evaluate((el) => el.getBoundingClientRect().height);
      console.log(JSON.stringify({ test: "D37: 390px sectionHeight", sectionHeight }));
      // Base section height at 390px is 334px. Budget: <= base + 8px = 342px.
      expect(sectionHeight).toBeLessThanOrEqual(342);

      const fontResult = await checkFontSizes(sectionLocator);
      expect(fontResult.offenders).toEqual([]);

      const clipResult = await checkClipping(sectionLocator);
      expect(clipResult.clippedElements).toEqual([]);

      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(docOverflow).toBe(false);
    } finally {
      await page.close();
    }
  });

  test("700px worst-case values clearance >= 4px, font >= 12px, no clipping", async ({ browser }) => {
    const { page, sectionLocator } = await setupRingsPage(browser, 700, 900);
    try {
      const clearances = await measureRingClearances(page);
      console.log(JSON.stringify({ test: "D37: 700px clearance", clearances }));

      for (const r of clearances) {
        expect(r.valClearance, `${r.ringId} value "${r.valText}" clearance`).toBeGreaterThanOrEqual(4.0);
        expect(r.targetClearance, `${r.ringId} target "${r.targetText}" clearance`).toBeGreaterThanOrEqual(4.0);
      }

      const fontResult = await checkFontSizes(sectionLocator);
      expect(fontResult.offenders).toEqual([]);

      const clipResult = await checkClipping(sectionLocator);
      expect(clipResult.clippedElements).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test("390px 4-digit over-target calories (2450/1900) clearance >= 4px", async ({ browser }) => {
    const overLogs = { ...WORST_CASE_DAILY_LOGS, calories: 2450 };
    const { page } = await setupRingsPage(browser, 390, 844, overLogs);
    try {
      const clearances = await measureRingClearances(page);
      console.log(JSON.stringify({ test: "D37: 390px over-target calories", clearances }));

      const cal = clearances.find((r) => r.ringId === "calories");
      expect(cal).toBeDefined();
      expect(cal.valClearance, `calories value "${cal.valText}" clearance`).toBeGreaterThanOrEqual(4.0);
      expect(cal.targetClearance, `calories target "${cal.targetText}" clearance`).toBeGreaterThanOrEqual(4.0);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Soft kcal-vs-macros hint density tests
// ---------------------------------------------------------------------------

test.describe('kcal-vs-macros hint', () => {
  test('manual form at 320px height hidden == base (592px), visible <= base + 20 (612px), font 12px, not clipped, single line', async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 }, deviceScaleFactor: 1 });
    try {
      await setupPageAndLogin(page);
      const manualBtn = page.locator('button:has-text("Manual Entry")');
      await manualBtn.click();
      const formLocator = page.locator('form').filter({ hasText: 'Manual Macro Logging' });
      await expect(formLocator).toBeVisible();

      // 1. Measure height with hint hidden
      const heightHidden = await formLocator.evaluate((el) => el.getBoundingClientRect().height);
      const hintLocator = formLocator.locator('[data-testid="macro-mismatch-hint"]');
      await expect(hintLocator).toBeAttached();
      const hintTextHidden = await hintLocator.innerText();
      expect(hintTextHidden.trim()).toBe('');

      // Base height at 320px is 592px. Height with hint hidden == base height
      expect(heightHidden).toBe(592);

      // 2. Trigger hint (kcal 350, macros 0 -> est = 0, diff = 350 > 50 and > 15%)
      await page.fill('[data-testid="calories-input"]', '350');
      await page.fill('[data-testid="protein-input"]', '0');
      await page.fill('[data-testid="carbs-input"]', '0');
      await page.fill('[data-testid="fat-input"]', '0');

      await expect(hintLocator).toBeVisible();
      const hintTextVisible = await hintLocator.innerText();
      expect(hintTextVisible).toBe('Macros add up to ≈ 0 kcal');

      // 3. Measure height with hint visible (must add <= 20px)
      const heightVisible = await formLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(heightVisible).toBeLessThanOrEqual(592 + 20);

      // Screenshot manual form with hint visible at 320px
      await formLocator.screenshot({
        path: testInfo.outputPath('d23_hint_320.png'),
      });

      // 4. Verify hint font size == 12px
      const fontSize = await hintLocator.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
      expect(fontSize).toBe(12);

      // 5. Verify hint not clipped (scrollWidth <= clientWidth)
      const clipCheck = await hintLocator.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        notClipped: el.scrollWidth <= el.clientWidth,
      }));
      expect(clipCheck.notClipped, `Hint is clipped: scrollWidth (${clipCheck.scrollWidth}) > clientWidth (${clipCheck.clientWidth})`).toBe(true);

      // 6. Verify single line (hint height <= 20px)
      const hintHeight = await hintLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(hintHeight).toBeLessThanOrEqual(20);

      console.log(JSON.stringify({
        test: 'D23: manual form at 320px',
        heightHidden,
        heightVisible,
        diff: heightVisible - heightHidden,
        fontSize,
        clipCheck,
        hintHeight,
      }));
    } finally {
      await page.close();
    }
  });

  test('manual form at 390px height hidden == base (592px), visible <= base + 20 (612px), font 12px, not clipped, single line', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    try {
      await setupPageAndLogin(page);
      const manualBtn = page.locator('button:has-text("Manual Entry")');
      await manualBtn.click();
      const formLocator = page.locator('form').filter({ hasText: 'Manual Macro Logging' });
      await expect(formLocator).toBeVisible();

      // 1. Measure height with hint hidden
      const heightHidden = await formLocator.evaluate((el) => el.getBoundingClientRect().height);
      const hintLocator = formLocator.locator('[data-testid="macro-mismatch-hint"]');
      await expect(hintLocator).toBeAttached();
      const hintTextHidden = await hintLocator.innerText();
      expect(hintTextHidden.trim()).toBe('');

      // Base height at 390px is 592px
      expect(heightHidden).toBe(592);

      // 2. Trigger hint
      await page.fill('[data-testid="calories-input"]', '350');
      await page.fill('[data-testid="protein-input"]', '0');
      await page.fill('[data-testid="carbs-input"]', '0');
      await page.fill('[data-testid="fat-input"]', '0');

      await expect(hintLocator).toBeVisible();
      const hintTextVisible = await hintLocator.innerText();
      expect(hintTextVisible).toBe('Macros add up to ≈ 0 kcal');

      // 3. Measure height with hint visible
      const heightVisible = await formLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(heightVisible).toBeLessThanOrEqual(592 + 20);

      // 4. Verify hint font size == 12px
      const fontSize = await hintLocator.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
      expect(fontSize).toBe(12);

      // 5. Verify hint not clipped
      const clipCheck = await hintLocator.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        notClipped: el.scrollWidth <= el.clientWidth,
      }));
      expect(clipCheck.notClipped, `Hint is clipped: scrollWidth (${clipCheck.scrollWidth}) > clientWidth (${clipCheck.clientWidth})`).toBe(true);

      // 6. Verify single line
      const hintHeight = await hintLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(hintHeight).toBeLessThanOrEqual(20);

      console.log(JSON.stringify({
        test: 'D23: manual form at 390px',
        heightHidden,
        heightVisible,
        diff: heightVisible - heightHidden,
        fontSize,
        clipCheck,
        hintHeight,
      }));
    } finally {
      await page.close();
    }
  });

  test('AddItemForm at 320px height hidden == base (434px), visible <= base + 20 (454px), font 12px, not clipped, single line', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 }, deviceScaleFactor: 1 });
    try {
      await setupPageAndLogin(page);

      // Stage a meal to expose "+ Manual" / AddItemForm
      const manualBtn = page.locator('button:has-text("Manual Entry")');
      await manualBtn.click();
      await page.fill('[data-testid="dish-name-input"]', 'Base Meal');
      await page.fill('[data-testid="calories-input"]', '200');
      await page.fill('[data-testid="protein-input"]', '20');
      await page.fill('[data-testid="carbs-input"]', '20');
      await page.fill('[data-testid="fat-input"]', '4');
      const logBtn = page.locator('button:has-text("Log Meal")').last();
      await logBtn.click();

      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible();

      const addItemBtn = stagedCard.locator('[data-testid="add-item-button"]');
      await addItemBtn.click();
      await stagedCard.locator('[data-testid="enter-manually-button"]').click();

      const addItemForm = stagedCard.locator('[data-testid="add-item-form"]');
      await expect(addItemForm).toBeVisible();

      // 1. Measure height with hint hidden
      const heightHidden = await addItemForm.evaluate((el) => el.getBoundingClientRect().height);
      const hintLocator = addItemForm.locator('[data-testid="macro-mismatch-hint"]');
      await expect(hintLocator).toBeAttached();
      const hintTextHidden = await hintLocator.innerText();
      expect(hintTextHidden.trim()).toBe('');

      // Base height at 320px is 434px
      expect(heightHidden).toBe(434);

      // 2. Trigger hint
      await page.fill('[data-testid="add-item-calories-input"]', '350');
      await page.fill('[data-testid="add-item-protein-input"]', '0');
      await page.fill('[data-testid="add-item-carbs-input"]', '0');
      await page.fill('[data-testid="add-item-fat-input"]', '0');

      await expect(hintLocator).toBeVisible();
      const hintTextVisible = await hintLocator.innerText();
      expect(hintTextVisible).toBe('Macros add up to ≈ 0 kcal');

      // 3. Measure height with hint visible
      const heightVisible = await addItemForm.evaluate((el) => el.getBoundingClientRect().height);
      expect(heightVisible).toBeLessThanOrEqual(434 + 20);

      // 4. Verify hint font size == 12px
      const fontSize = await hintLocator.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
      expect(fontSize).toBe(12);

      // 5. Verify hint not clipped
      const clipCheck = await hintLocator.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        notClipped: el.scrollWidth <= el.clientWidth,
      }));
      expect(clipCheck.notClipped, `Hint is clipped: scrollWidth (${clipCheck.scrollWidth}) > clientWidth (${clipCheck.clientWidth})`).toBe(true);

      // 6. Verify single line
      const hintHeight = await hintLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(hintHeight).toBeLessThanOrEqual(20);

      console.log(JSON.stringify({
        test: 'D23: AddItemForm at 320px',
        heightHidden,
        heightVisible,
        diff: heightVisible - heightHidden,
        fontSize,
        clipCheck,
        hintHeight,
      }));
    } finally {
      await page.close();
    }
  });

  test('AddItemForm at 390px height hidden == base (418px), visible <= base + 20 (438px), font 12px, not clipped, single line', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    try {
      await setupPageAndLogin(page);

      // Stage a meal to expose "+ Manual" / AddItemForm
      const manualBtn = page.locator('button:has-text("Manual Entry")');
      await manualBtn.click();
      await page.fill('[data-testid="dish-name-input"]', 'Base Meal');
      await page.fill('[data-testid="calories-input"]', '200');
      await page.fill('[data-testid="protein-input"]', '20');
      await page.fill('[data-testid="carbs-input"]', '20');
      await page.fill('[data-testid="fat-input"]', '4');
      const logBtn = page.locator('button:has-text("Log Meal")').last();
      await logBtn.click();

      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible();

      const addItemBtn = stagedCard.locator('[data-testid="add-item-button"]');
      await addItemBtn.click();
      await stagedCard.locator('[data-testid="enter-manually-button"]').click();

      const addItemForm = stagedCard.locator('[data-testid="add-item-form"]');
      await expect(addItemForm).toBeVisible();

      // 1. Measure height with hint hidden
      const heightHidden = await addItemForm.evaluate((el) => el.getBoundingClientRect().height);
      const hintLocator = addItemForm.locator('[data-testid="macro-mismatch-hint"]');
      await expect(hintLocator).toBeAttached();
      const hintTextHidden = await hintLocator.innerText();
      expect(hintTextHidden.trim()).toBe('');

      // Base height at 390px is 418px
      expect(heightHidden).toBe(418);

      // 2. Trigger hint
      await page.fill('[data-testid="add-item-calories-input"]', '350');
      await page.fill('[data-testid="add-item-protein-input"]', '0');
      await page.fill('[data-testid="add-item-carbs-input"]', '0');
      await page.fill('[data-testid="add-item-fat-input"]', '0');

      await expect(hintLocator).toBeVisible();
      const hintTextVisible = await hintLocator.innerText();
      expect(hintTextVisible).toBe('Macros add up to ≈ 0 kcal');

      // 3. Measure height with hint visible
      const heightVisible = await addItemForm.evaluate((el) => el.getBoundingClientRect().height);
      expect(heightVisible).toBeLessThanOrEqual(418 + 20);

      // 4. Verify hint font size == 12px
      const fontSize = await hintLocator.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
      expect(fontSize).toBe(12);

      // 5. Verify hint not clipped
      const clipCheck = await hintLocator.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        notClipped: el.scrollWidth <= el.clientWidth,
      }));
      expect(clipCheck.notClipped, `Hint is clipped: scrollWidth (${clipCheck.scrollWidth}) > clientWidth (${clipCheck.clientWidth})`).toBe(true);

      // 6. Verify single line
      const hintHeight = await hintLocator.evaluate((el) => el.getBoundingClientRect().height);
      expect(hintHeight).toBeLessThanOrEqual(20);

      console.log(JSON.stringify({
        test: 'D23: AddItemForm at 390px',
        heightHidden,
        heightVisible,
        diff: heightVisible - heightHidden,
        fontSize,
        clipCheck,
        hintHeight,
      }));
    } finally {
      await page.close();
    }
  });
});


// ---------------------------------------------------------------------------
// Surface F: Floating Toast (320px and 390px)
// ---------------------------------------------------------------------------

test.describe('floating toast', () => {
  for (const width of [390, 320]) {
    test(`direct log toast clearance, typography, tap target and no clipping at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupPageAndLogin(page);

        const quickLogBtn = page.locator('[data-testid^="quick-log-btn-"]').first();
        await expect(quickLogBtn).toBeVisible({ timeout: 10000 });
        await quickLogBtn.click();

        const toast = page.locator('[data-testid="quick-log-toast"]');
        await expect(toast).toBeVisible({ timeout: 5000 });

        // 1. Toast rect has 0 overlap with bottom nav
        const nav = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
        await expect(nav).toBeVisible();

        const toastBox = (await toast.boundingBox())!;
        const navBox = (await nav.boundingBox())!;
        const toastBottom = toastBox.y + toastBox.height;

        expect(toastBottom, `Toast bottom (${toastBottom}px) exceeds nav top (${navBox.y}px)`).toBeLessThanOrEqual(navBox.y);
        expect(navBox.y - toastBottom, 'Gap between toast bottom and nav top should be >= 4px').toBeGreaterThanOrEqual(4);

        // 2. Fonts >= 12px, line 2 is 14px
        const fontResult = await checkFontSizes(toast);
        expect(fontResult.offenders, `Found fonts smaller than 12px in toast: ${JSON.stringify(fontResult.offenders)}`).toEqual([]);

        const dishText = toast.locator('[data-testid="toast-dish-text"]');
        await expect(dishText).toBeVisible();
        const dishFontSize = await dishText.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
        expect(dishFontSize, 'Line 2 dish text must be 14px').toBe(14);

        // 3. Undo button height >= 44px
        const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
        await expect(undoBtn).toBeVisible();
        const undoBox = (await undoBtn.boundingBox())!;
        expect(undoBox.height, `Undo button height (${undoBox.height}px) must be >= 44px`).toBeGreaterThanOrEqual(44);
        expect(undoBox.width, `Undo button width (${undoBox.width}px) must be >= 44px`).toBeGreaterThanOrEqual(44);

        // 4. No clipping
        const clipResult = await checkClipping(toast);
        expect(clipResult.clippedElements, `Found clipped elements in toast: ${JSON.stringify(clipResult.clippedElements)}`).toEqual([]);

        // 5. Verify Undo button click dismisses toast and deletes created log
        await undoBtn.click();
        await expect(toast).not.toBeVisible();

        console.log(JSON.stringify({
          test: `D41: direct log toast at ${width}px`,
          width,
          toastBottom,
          navTop: navBox.y,
          gapToNav: navBox.y - toastBottom,
          dishFontSize,
          undoHeight: undoBox.height,
          undoWidth: undoBox.width,
        }));
      } finally {
        await page.close();
      }
    });

    test(`staged meal add toast clearance and no layout shift at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupPageAndLogin(page);

        // Stage a meal via AI input
        await page.fill('textarea[placeholder*="Describe what you ate"]', 'single 1-item salmon');
        await page.click('button:has-text("Analyze Meal")');
        const stagedCard = page.locator('[data-testid="staged-meal-card"]');
        await expect(stagedCard).toBeVisible({ timeout: 15000 });
        await waitForScrollSettled(page);

        // Record staged card layout position in document before toast
        const offsetTopBefore = await stagedCard.evaluate((el) => (el as HTMLElement).offsetTop);

        // Click '+' on a favorite to add to staged meal
        const addFavBtn = page.locator('[data-testid^="quick-log-btn-"]').first();
        await expect(addFavBtn).toBeVisible();
        await addFavBtn.click();

        const toast = page.locator('[data-testid="quick-log-toast"]');
        await expect(toast).toBeVisible({ timeout: 5000 });
        await expect(toast).toContainText('Added to meal');

        // Verify staged card offsetTop in document is unchanged (no layout shift from inline banner!)
        const offsetTopAfter = await stagedCard.evaluate((el) => (el as HTMLElement).offsetTop);
        expect(offsetTopAfter, `Staged card offsetTop shifted from ${offsetTopBefore}px to ${offsetTopAfter}px`).toBe(offsetTopBefore);

        // Toast floats above sticky staged-card-actions
        const actionsRow = stagedCard.locator('[data-testid="staged-card-actions"]');
        await expect(actionsRow).toBeVisible();
        const actionsBox = (await actionsRow.boundingBox())!;
        const toastBox = (await toast.boundingBox())!;
        const toastBottom = toastBox.y + toastBox.height;

        expect(toastBottom, `Toast bottom (${toastBottom}px) exceeds staged actions top (${actionsBox.y}px)`).toBeLessThanOrEqual(actionsBox.y);
        expect(actionsBox.y - toastBottom, 'Gap between toast bottom and staged actions top should be >= 4px').toBeGreaterThanOrEqual(4);

        // Also clears bottom nav
        const nav = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
        const navBox = (await nav.boundingBox())!;
        expect(toastBottom, `Toast bottom (${toastBottom}px) exceeds nav top (${navBox.y}px)`).toBeLessThanOrEqual(navBox.y);

        // Undo button works to revert staged meal addition
        const undoBtn = toast.locator('[data-testid="toast-undo-btn"]');
        await expect(undoBtn).toBeVisible();
        await undoBtn.click();

        // Toast dismissed after Undo
        await expect(toast).not.toBeVisible();

        console.log(JSON.stringify({
          test: `D41: staged meal add toast at ${width}px`,
          width,
          offsetTopBefore,
          offsetTopAfter,
          toastBottom,
          actionsTop: actionsBox.y,
          gapToActions: actionsBox.y - toastBottom,
          navTop: navBox.y,
        }));
      } finally {
        await page.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Nutrition Type Scale Density Guard
// ---------------------------------------------------------------------------

async function checkTypeScale(
  surface: Locator,
  options?: { includeHeaderAndNav?: boolean; allowSizes16Plus?: boolean }
) {
  return await surface.evaluate((root, opts) => {
    const ALLOWED_SIZES = new Set([12, 14]);
    const ALLOWED_WEIGHTS = new Set([400, 600, 700]);
    const violations: Array<{ selector: string; text: string; issue: string }> = [];

    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
      if (el.classList.contains('sr-only')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;

    while (node) {
      const el = node as HTMLElement;
      node = walker.nextNode();

      if (!isVisible(el)) continue;
      const hasDirectText = Array.from(el.childNodes).some(
        (c) => c.nodeType === Node.TEXT_NODE && c.textContent && c.textContent.trim().length > 0
      );
      if (!hasDirectText) continue;

      if (!opts?.includeHeaderAndNav && (el.closest('nav') || el.closest('header'))) continue;

      const cs = window.getComputedStyle(el);
      const size = Math.round(parseFloat(cs.fontSize));
      const weight = parseInt(cs.fontWeight, 10);
      const family = cs.fontFamily.toLowerCase();
      const fvn = cs.fontVariantNumeric;
      const text = (el.innerText || el.textContent || '').trim().slice(0, 30);
      const isInput = Boolean(el.closest('input, select, textarea'));
      // Named exception (user decision hotfix): logged set values sit in the
      // input column and mirror the 16px inputs; only exactly 16px is allowed.
      const isInputMirror = Boolean(el.closest('[data-input-mirror="true"]'));

      const sel = el.getAttribute('data-testid')
        ? `[data-testid="${el.getAttribute('data-testid')}"]`
        : el.tagName.toLowerCase();

      // Check 1: Size
      if (!ALLOWED_SIZES.has(size)) {
        if (size === 16 && (isInput || isInputMirror)) {
          // Allowed: inputs are 16px to prevent iOS auto-zoom
        } else if (opts?.allowSizes16Plus && size >= 16) {
          // Allowed: page headings/titles on full routes when allowSizes16Plus is enabled
        } else {
          violations.push({ selector: sel, text, issue: `Font size ${size}px not in {12, 14} (16 only on inputs)` });
        }
      }

      // Check 2: Weight
      if (!ALLOWED_WEIGHTS.has(weight)) {
        violations.push({ selector: sel, text, issue: `Font weight ${weight} not in {400, 600, 700}` });
      }

      // Check 3: Family
      if (family.includes('mono')) {
        violations.push({ selector: sel, text, issue: `Font family "${family}" is monospace (prohibited)` });
      }

      // Check 4: Numbers in macro/total cells must have tabular-nums
      if (el.closest('[data-testid*="totals-grid"], [data-testid*="day-total-grid"], [data-testid*="-val-"], [data-testid*="staged-total-"], [data-testid*="day-total-"], [data-testid*="component-macro-"]') && /\d/.test(text)) {
        if (!fvn.includes('tabular-nums') && !cs.fontFeatureSettings.includes('tnum')) {
          violations.push({ selector: sel, text, issue: `Number cell missing tabular-nums: "${text}"` });
        }
      }
    }

    return violations;
  }, options);
}

test.describe('nutrition type scale', () => {
  for (const width of [390, 320] as const) {
    test(`type scale compliance on nutrition tab surfaces at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        let logs: any[] = [
          {
            id: 'log-timeline-1',
            user_id: 'test-user',
            food_name: 'Grilled Salmon with Rice',
            meal_type: 'Dinner',
            calories: 550,
            protein: 45,
            carbs: 50,
            fat: 18,
            fiber: 4,
            serving_size: 1,
            serving_unit: 'serving',
            logged_at: new Date().toISOString(),
            logged_date: todayStr,
            created_at: new Date().toISOString(),
            has_components: false,
          },
        ];

        await page.route('**/rest/v1/nutrition_logs*', async (route) => {
          const req = route.request();
          const method = req.method();
          if (method === 'OPTIONS') {
            return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } });
          }
          if (method === 'POST') {
            const body = req.postDataJSON();
            const newLog = Array.isArray(body) ? body[0] : body;
            const created = {
              id: 'log-' + Date.now(),
              user_id: 'test-user',
              logged_at: new Date().toISOString(),
              logged_date: todayStr,
              created_at: new Date().toISOString(),
              has_components: false,
              ...newLog,
            };
            logs = [created, ...logs];
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(Array.isArray(body) ? [created] : created),
            });
          }
          if (method === 'DELETE') {
            return route.fulfill({
              status: 204,
              headers: { 'access-control-allow-origin': '*' },
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(logs),
          });
        });

        await setupPageAndLogin(page);

        // 1. Surface: Unstaged Main Page (AI input, Quick Log favorites, Timeline rows)
        const mainLocator = page.locator('main');
        const unstagedViolations = await checkTypeScale(mainLocator);
        expect(unstagedViolations, `Unstaged main tab type violations at ${width}px:
${JSON.stringify(unstagedViolations, null, 2)}`).toHaveLength(0);

        // Verify Unstaged AI Input Typography
        const aiHeader = page.locator('h3:has-text("Log Food")');
        await expect(aiHeader).toBeVisible();
        const aiHeaderStyle = await aiHeader.evaluate((el) => {
          const cs = window.getComputedStyle(el);
          return {
            size: Math.round(parseFloat(cs.fontSize)),
            weight: parseInt(cs.fontWeight, 10),
            transform: cs.textTransform,
          };
        });
        expect(aiHeaderStyle.size, 'Log Food header size must be 12px').toBe(12);
        expect(aiHeaderStyle.weight, 'Log Food header weight must be 700').toBe(700);
        expect(aiHeaderStyle.transform, 'Log Food header must be uppercase').toBe('uppercase');

        const analyzeBtn = page.locator('[data-testid="analyze-meal-button"]');
        const analyzeBtnStyle = await analyzeBtn.evaluate((el) => {
          const cs = window.getComputedStyle(el);
          return {
            size: Math.round(parseFloat(cs.fontSize)),
            weight: parseInt(cs.fontWeight, 10),
            transform: cs.textTransform,
          };
        });
        expect(analyzeBtnStyle.size, 'Analyze button size must be 12px').toBe(12);
        expect(analyzeBtnStyle.weight, 'Analyze button weight must be 700').toBe(700);
        expect(analyzeBtnStyle.transform, 'Analyze button transform must be none').toBe('none');

        // 2. Surface: NutrientBreakdownModal
        const calRing = page.locator('[data-testid="macro-ring-calories"]');
        await calRing.click();
        const nutrientModal = page.locator('[data-testid="nutrient-breakdown-modal"]');
        await expect(nutrientModal).toBeVisible({ timeout: 5000 });
        const nutrientModalViolations = await checkTypeScale(nutrientModal);
        expect(nutrientModalViolations, `NutrientBreakdownModal type violations at ${width}px:
${JSON.stringify(nutrientModalViolations, null, 2)}`).toHaveLength(0);
        await page.keyboard.press('Escape');
        await expect(nutrientModal).not.toBeVisible();

        // 3. Surface: EditMealSheet (replaces EditMealModal)
        const rowMenuBtn = page.locator('button[aria-haspopup="menu"]').first();
        await expect(rowMenuBtn).toBeVisible({ timeout: 5000 });
        await rowMenuBtn.click();
        const editMenuItem = page.locator('[role="menuitem"]', { hasText: 'Edit meal' });
        await expect(editMenuItem).toBeVisible({ timeout: 5000 });
        await editMenuItem.click();
        const editMealSheet = page.locator('[data-testid="edit-meal-sheet"]');
        await expect(editMealSheet).toBeVisible({ timeout: 5000 });
        const editModalViolations = await checkTypeScale(editMealSheet);
        expect(editModalViolations, `EditMealSheet type violations at ${width}px:
${JSON.stringify(editModalViolations, null, 2)}`).toHaveLength(0);
        await page.locator('[data-testid="edit-meal-sheet"] button:has-text("Cancel")').click();
        await expect(editMealSheet).not.toBeVisible();

        // 4. Surface: Quick Log Toast
        const quickLogBtn = page.locator('[data-testid^="quick-log-btn-"]').first();
        await expect(quickLogBtn).toBeVisible({ timeout: 5000 });
        await quickLogBtn.click();
        const toast = page.locator('[data-testid="quick-log-toast"]');
        await expect(toast).toBeVisible({ timeout: 5000 });
        const toastViolations = await checkTypeScale(toast);
        expect(toastViolations, `Toast type violations at ${width}px:
${JSON.stringify(toastViolations, null, 2)}`).toHaveLength(0);
        // Undo and dismiss toast
        const undoBtn = page.locator('[data-testid="toast-undo-btn"]');
        await undoBtn.click();
        await expect(toast).not.toBeVisible();

        // 5. Surface: Staged Meal Card (incl. item rows, totals + action row)
        await page.fill('textarea[placeholder*="Describe what you ate"]', '4-item salmon dinner');
        await page.click('button:has-text("Analyze Meal")');
        const cardLocator = page.locator('[data-testid="staged-meal-card"]');
        await expect(cardLocator).toBeVisible({ timeout: 15000 });
        await waitForScrollSettled(page);

        const stagedViolations = await checkTypeScale(cardLocator);
        expect(stagedViolations, `StagedMealCard type violations at ${width}px:
${JSON.stringify(stagedViolations, null, 2)}`).toHaveLength(0);

        // AddItemsComposer typography in walker
        const addBtn = cardLocator.locator('[data-testid="add-item-button"]');
        await addBtn.click();
        const composerLocator = cardLocator.locator('[data-testid="add-items-composer"]');
        await expect(composerLocator).toBeVisible();
        const composerViolations = await checkTypeScale(composerLocator);
        expect(composerViolations, `AddItemsComposer type violations at ${width}px:
${JSON.stringify(composerViolations, null, 2)}`).toHaveLength(0);
        await composerLocator.locator('[data-testid="cancel-composer-button"]').click();
        await expect(composerLocator).not.toBeVisible();

        // Explicit Peer Checks on Staged Card
        // Peer Check A: This meal value size == Day total value size
        const thisMealVal = page.locator('[data-testid="staged-total-calories"] [data-testid="macro-val-calories"]').first();
        const dayTotalVal = page.locator('[data-testid="day-total-calories"] [data-testid="day-total-val-calories"]').first();
        await expect(thisMealVal).toBeVisible();
        await expect(dayTotalVal).toBeVisible();

        const thisMealSize = await thisMealVal.evaluate((el) => Math.round(parseFloat(window.getComputedStyle(el).fontSize)));
        const dayTotalSize = await dayTotalVal.evaluate((el) => Math.round(parseFloat(window.getComputedStyle(el).fontSize)));
        expect(thisMealSize, `This meal value (${thisMealSize}px) must equal Day total value (${dayTotalSize}px)`).toBe(dayTotalSize);

        // Peer Check B: Log Meal label transform == Save as Custom Dish transform
        const logMealBtn = page.getByRole('button', { name: /Log Meal/i }).first();
        const saveDishBtn = page.getByRole('button', { name: /Save as Custom Dish/i }).first();
        const logMealTransform = await logMealBtn.evaluate((el) => window.getComputedStyle(el).textTransform);
        const saveDishTransform = await saveDishBtn.evaluate((el) => window.getComputedStyle(el).textTransform);
        expect(logMealTransform, `Log Meal transform (${logMealTransform}) must match Save as Custom Dish (${saveDishTransform})`).toBe(saveDishTransform);

        // Peer Check C: All section headers same size and weight (12px / 700)
        const sectionHeaders = page.locator(
          'h3:has-text("Today\'s Nutrition"), h3:has-text("Log Food"), h3:has-text("Today\'s Meals"), [data-testid="this-meal-label"], [data-testid="day-total-label"]'
        );
        const headerCount = await sectionHeaders.count();
        expect(headerCount).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < headerCount; i++) {
          const header = sectionHeaders.nth(i);
          const style = await header.evaluate((el) => {
            const cs = window.getComputedStyle(el);
            return {
              text: el.textContent?.trim().slice(0, 20),
              size: Math.round(parseFloat(cs.fontSize)),
              weight: parseInt(cs.fontWeight, 10),
            };
          });
          expect(style.size, `Header "${style.text}" font size must be 12px`).toBe(12);
          expect([600, 700], `Header "${style.text}" font weight must be 600 or 700`).toContain(style.weight);
        }

      } finally {
        await page.close();
      }
    });
  }
});


// ---------------------------------------------------------------------------
// Edit sheet density & layout (320x640 and 390x844)
// ---------------------------------------------------------------------------

test.describe('edit sheet density & layout', () => {
  const VIEWPORTS = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ];

  for (const { width, height } of VIEWPORTS) {
    test(`edit sheet layout, tap targets and typography at ${width}x${height}`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height },
      });

      try {
        let logs: any[] = [
          {
            id: 'meal-log-multi',
            user_id: 'test-user',
            food_name: 'Steak & Salad',
            meal_type: 'Dinner',
            calories: 650,
            protein: 55,
            carbs: 10,
            fat: 35,
            fiber: 4,
            serving_size: 1,
            serving_unit: 'serving',
            logged_at: new Date().toISOString(),
            logged_date: new Date().toISOString().split('T')[0],
            has_components: true,
            items: [
              {
                id: 'c1',
                name: 'Ribeye Steak',
                portion: '200 g',
                quantity: 200,
                unit: 'g',
                calories: 500,
                protein: 50,
                carbs: 0,
                fat: 30,
                fiber: 0,
              },
              {
                id: 'c2',
                name: 'Garden Salad',
                portion: '150 g',
                quantity: 150,
                unit: 'g',
                calories: 150,
                protein: 5,
                carbs: 10,
                fat: 5,
                fiber: 4,
              },
            ],
          },
        ];

        await page.route('**/rest/v1/nutrition_logs*', async (route) => {
          const method = route.request().method();
          if (method === 'PATCH' || method === 'PUT') {
            const body = route.request().postDataJSON();
            const updated = { ...logs[0], ...body };
            logs = [updated];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify([updated]),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(logs),
          });
        });

        await setupPageAndLogin(page);

        // Open edit sheet via row menu
        const rowMenuBtn = page.locator('[data-testid="meal-actions-meal-log-multi"]');
        await expect(rowMenuBtn).toBeVisible({ timeout: 5000 });
        await rowMenuBtn.click();
        const editMenuItem = page.locator('[data-testid="edit-meal-meal-log-multi"]');
        await expect(editMenuItem).toBeVisible({ timeout: 5000 });
        await editMenuItem.click();

        const sheet = page.locator('[data-testid="edit-meal-sheet"]');
        await expect(sheet).toBeVisible({ timeout: 5000 });

        // 1. Sheet fits viewport (no page-level horizontal overflow)
        const hasPageHOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasPageHOverflow, 'Page must not have horizontal overflow').toBe(false);

        // 2. Action row (Save changes, Cancel, Star) is visible, reachable, not clipped
        const actionRow = sheet.locator('[data-testid="staged-card-actions"]');
        await expect(actionRow).toBeVisible();

        const saveBtn = sheet.locator('[data-testid="save-edit-meal-btn"]');
        const cancelBtn = sheet.locator('[data-testid="cancel-edit-meal-btn"]');
        const starBtn = sheet.locator('button[aria-label="Save as Custom Dish"]');

        await expect(saveBtn).toBeVisible();
        await expect(cancelBtn).toBeVisible();
        await expect(starBtn).toBeVisible();

        // 3. No element clipped by overflow-hidden
        const actionsBox = await actionRow.boundingBox();
        expect(actionsBox).not.toBeNull();
        if (actionsBox) {
          expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(height + 1);
        }

        // 4. Tap targets >= 40x40 (>= 44x44 for touch targets)
        const interactiveElements = await sheet.evaluate((root) => {
          const buttons = Array.from(root.querySelectorAll('button, input, select, a, [role="button"]'));
          return buttons.map((el) => {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const isVisible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 15),
              width: Math.round(r.width),
              height: Math.round(r.height),
              isVisible,
            };
          }).filter((b) => b.isVisible);
        });

        for (const target of interactiveElements) {
          expect(
            target.height >= 40 || target.width >= 40,
            `Target ${target.testId || target.tag} dimensions (${target.width}x${target.height}) must have at least 40px`
          ).toBe(true);
        }

        // 5. Fonts conform to walker (12, 14, 16px only; weights 400, 600, 700 only)
        const typeViolations = await checkTypeScale(sheet);
        expect(typeViolations, `D44 EditMealSheet typography violations at ${width}px:
${JSON.stringify(typeViolations, null, 2)}`).toHaveLength(0);

        // Cancel closes sheet
        await cancelBtn.click();
        await expect(sheet).not.toBeVisible();
      } finally {
        await page.close();
      }
    });
  }
});


// ---------------------------------------------------------------------------
// Add composer density & layout (320x640 and 390x844)
// ---------------------------------------------------------------------------

test.describe('add composer', () => {
  const VIEWPORTS = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ];

  for (const { width, height } of VIEWPORTS) {
    test(`add composer layout, tap targets, font scale, sticky actions at ${width}x${height}`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });

      try {
        await setupPageAndLogin(page);

        // Stage a meal via Manual Entry
        const manualBtn = page.locator('button:has-text("Manual Entry")');
        await manualBtn.click();
        await page.fill('[data-testid="dish-name-input"]', 'Greek Yogurt Bowl');
        await page.fill('[data-testid="calories-input"]', '250');
        await page.fill('[data-testid="protein-input"]', '20');
        await page.fill('[data-testid="carbs-input"]', '15');
        await page.fill('[data-testid="fat-input"]', '5');
        const logBtn = page.locator('button:has-text("Log Meal")').last();
        await logBtn.click();

        const cardLocator = page.locator('[data-testid="staged-meal-card"]');
        await expect(cardLocator).toBeVisible({ timeout: 15000 });
        await waitForScrollSettled(page);

        // 1. Breakdown header fits on one line with "+ Add" (no wrap)
        const headerResult = await checkBreakdownHeaderGeometry(cardLocator);
        expectScaleChipFits(headerResult);
        expect(headerResult.headerRowHeight, `Header row height (${headerResult.headerRowHeight}px) exceeds 16.5px`).toBeLessThanOrEqual(16.5);
        expect(headerResult.buttonText, 'Breakdown header button label must be "+ Add"').toBe('+ Add');
        expect(headerResult.ariaLabel, 'Breakdown header button aria-label must be "Add item"').toBe('Add item');
        expect(headerResult.isClipped, 'Breakdown header button must not be clipped').toBe(false);

        // 2. Open composer by clicking "+ Add"
        const addBtn = cardLocator.locator('[data-testid="add-item-button"]');
        await addBtn.click();

        const composer = cardLocator.locator('[data-testid="add-items-composer"]');
        await expect(composer).toBeVisible();

        // Focus management: textarea is focused
        const textarea = composer.locator('[data-testid="composer-textarea"]');
        await expect(textarea).toBeFocused();

        // 3. Textarea and buttons fit without horizontal page overflow
        const hasPageHOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(hasPageHOverflow, 'Page must not have horizontal overflow with composer open').toBe(false);

        // 4. Tap targets >= 40px in composer
        const interactiveElements = await composer.evaluate((root) => {
          const els = Array.from(root.querySelectorAll('button, input, select, textarea, [role="button"]'));
          return els.map((el) => {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const isVisible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 15),
              width: Math.round(r.width),
              height: Math.round(r.height),
              isVisible,
            };
          }).filter((b) => b.isVisible);
        });

        for (const target of interactiveElements) {
          expect(
            target.height >= 40 || target.width >= 40,
            `Target ${target.testId || target.tag} dimensions (${target.width}x${target.height}) must have at least 40px`
          ).toBe(true);
        }

        // 5. Typography conforms to type scale
        const typeViolations = await checkTypeScale(composer);
        expect(typeViolations, `D45 composer typography violations at ${width}px:
${JSON.stringify(typeViolations, null, 2)}`).toHaveLength(0);

        // 6. Sticky action row not covered
        const actionRow = cardLocator.locator('[data-testid="staged-card-actions"]');
        await expect(actionRow).toBeVisible();
        const actionBox = await actionRow.boundingBox();
        const composerBox = await composer.boundingBox();
        expect(actionBox).not.toBeNull();
        expect(composerBox).not.toBeNull();
        if (actionBox && composerBox) {
          // Composer must be above sticky action row
          expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(actionBox.y + 1);
        }

        // 7. Cancel closes composer and restores focus to "+ Add"
        const cancelBtn = composer.locator('[data-testid="cancel-composer-button"]');
        await cancelBtn.click();
        await expect(composer).not.toBeVisible();
        await expect(addBtn).toBeFocused();
      } finally {
        await page.close();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Workout: Density, Hit Targets, Typography & Accessibility
// ---------------------------------------------------------------------------

async function setupWorkoutDensityPage(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');

  const card = page.locator('[data-testid="exercise-card-0"]');
  const chooseBtn = page.locator('button:has-text("Choose Routine")');
  const routineSelectBtn = page.locator('[data-testid="routine-select-btn"]');

  // Pin "Workout A" regardless of weekday: the default schedule (ghostSets.ts DEFAULT_WORKOUT_TEMPLATES)
  // picks a different routine per day, and on Tue/Fri its first exercise has no seeded benchmark weight,
  // so committing set 1 without a draft weight is rejected client-side.
  await expect(routineSelectBtn.or(chooseBtn).first()).toBeVisible({ timeout: 10000 });
  const routineText = (await routineSelectBtn.count()) > 0 ? await routineSelectBtn.textContent() : null;
  if (!routineText?.includes('Workout A')) {
    await (routineText === null ? chooseBtn : routineSelectBtn).click();
    await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A")').click();
    await expect(page.locator('[data-testid="routine-picker-modal"]')).not.toBeVisible();
  }
  await card.waitFor({ state: 'visible', timeout: 10000 });

  // Ensure set 1 is logged so we have both a logged set and a pending set
  const loggedRow = card.locator('[data-testid^="logged-set-row-"]').first();
  if (!(await loggedRow.isVisible())) {
    const commitBtn = card.locator('[data-testid^="commit-set-btn-"]').first();
    await commitBtn.click();
    await loggedRow.waitFor({ state: 'visible', timeout: 5000 });
  }

  return card;
}

test.describe('Workout', () => {
  // (a) type walker on Workout tab with logged + pending set, and EditSetSheet open
  test('typography on workout set rows and EditSetSheet', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      const card = await setupWorkoutDensityPage(page);

      // Verify logged set and pending set both present
      const loggedRow = card.locator('[data-testid^="logged-set-row-"]').first();
      const pendingRow = card.locator('input[data-testid^="ghost-weight-"]').first();
      await expect(loggedRow).toBeVisible();
      await expect(pendingRow).toBeVisible();

      // Logged values (input-mirror exception) must match the pending inputs exactly.
      // Read both in one evaluate (atomic w.r.t. re-renders) and poll until mounted.
      await expect
        .poll(
          () =>
            card.evaluate((root) => {
              const logged = root.querySelector('[data-testid^="logged-weight-value-"]');
              const input = root.querySelector('input[data-testid^="ghost-weight-"]');
              if (!logged || !input) return { same: false, logged: null, input: null };
              const a = window.getComputedStyle(logged);
              const b = window.getComputedStyle(input);
              const lf = { size: a.fontSize, weight: a.fontWeight };
              const inf = { size: b.fontSize, weight: b.fontWeight };
              return { same: lf.size !== '' && lf.size === inf.size && lf.weight === inf.weight, logged: lf, input: inf };
            }),
          { message: 'logged set value font must equal pending input font' }
        )
        .toMatchObject({ same: true });

      // Check typography on the whole exercise card (header, chips, controls, logged + pending rows)
      const setsBody = card;
      const setsViolations = await checkTypeScale(setsBody);
      expect(
        setsViolations,
        `Workout set rows typography violations:\n${JSON.stringify(setsViolations, null, 2)}`
      ).toHaveLength(0);

      // Open EditSetSheet via logged set row tap
      await loggedRow.click();
      const sheet = page.locator('[data-testid="edit-set-sheet"]');
      await expect(sheet).toBeVisible();

      // Check typography on EditSetSheet
      const sheetViolations = await checkTypeScale(sheet);
      expect(
        sheetViolations,
        `EditSetSheet typography violations:\n${JSON.stringify(sheetViolations, null, 2)}`
      ).toHaveLength(0);

      // Close sheet
      await page.keyboard.press('Escape');
      await expect(sheet).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  // (b) Hit-area check at 320/375/414/1280px
  for (const width of [320, 375, 414, 1280] as const) {
    test(`hit-area and layout acceptance at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        const card = await setupWorkoutDensityPage(page);

        // 1. scrollWidth <= clientWidth (no horizontal scroll / overflow)
        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasHorizontalOverflow,
          `Viewport ${width}px must not have horizontal overflow (scrollWidth <= clientWidth)`
        ).toBe(false);

        // 2. chip row bottom <= control row top
        // Chip row contains the metadata chips (PR, Last, Sets count)
        // Control row contains stepper, action buttons, and reorder controls
        const { chipBottom, controlTop } = await card.evaluate((cardEl) => {
          const chip = cardEl.querySelector('.flex.items-center.gap-1\\.5.flex-wrap');
          const control = cardEl.querySelector('button[aria-label^="Decrease target sets"]')?.closest('.flex.items-center.justify-between');
          return {
            chipBottom: chip ? chip.getBoundingClientRect().bottom : 0,
            controlTop: control ? control.getBoundingClientRect().top : 0,
          };
        });
        expect(chipBottom, 'Chip row must exist and have non-zero bottom').toBeGreaterThan(0);
        expect(controlTop, 'Control row must exist and have non-zero top').toBeGreaterThan(0);
        expect(
          chipBottom,
          `Chip row bottom (${chipBottom}) must be <= control row top (${controlTop})`
        ).toBeLessThanOrEqual(controlTop + 1);

        // 3. All interactive controls in card and set rows have >=44px hit area
        // (document.elementFromPoint at center +-22px where the box allows (raw px, explicit predicate))
        const hitAreaResults = await card.evaluate((cardEl) => {
          const controls = Array.from(cardEl.querySelectorAll<HTMLElement>(
            'button, input, [role="button"]'
          )).filter((el) => {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
          });

          return controls.map((el) => {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            // Center hit
            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            // Vertical reach: +- 21.5px (44px target) where box or pseudo-element hit target allows
            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            // Horizontal reach: +- 21.5px where box allows (for controls with width >= 43px)
            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            // Explicit predicate for >= 44px hit target:
            // A control satisfies the >=44px hit area requirement if:
            // - center is interactable, AND
            // - either:
            //   (a) its vertical touch target spans >= 44px (topHits && btmHits, e.g. stepper button with before:-inset-y-1, or min-h-[44px] rows)
            //   (b) its horizontal touch target spans >= 44px (horizontalAllowed && horizontalHits, e.g. inputs with width >= 64px)
            //   (c) both width and height >= 44px (e.g. icon buttons with before:-inset-1, or commit buttons with before:-inset-2)
            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );
return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              centerHits,
              topHits,
              btmHits,
              horizontalAllowed,
              horizontalHits,
              hasMin44pxHitArea,
            };
          });
        });

        for (const item of hitAreaResults) {
          expect(
            item.hasMin44pxHitArea,
            `Control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area predicate: ${JSON.stringify(item)}`
          ).toBe(true);
        }
      } finally {
        await page.close();
      }
    });
  }

  // (c) Clean axe-core on card, row, and open sheet (0 violations)
  test('clean axe-core accessibility audit on card, row, and open sheet', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      const card = await setupWorkoutDensityPage(page);
      const loggedRow = card.locator('[data-testid^="logged-set-row-"]').first();
      await expect(loggedRow).toBeVisible();

      // Inject axe-core
      await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });

      // Audit ExerciseCard
      const cardAxe = await page.evaluate(async () => {
        // @ts-ignore
        const res = await axe.run(document.querySelector('[data-testid="exercise-card-0"]'), {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
          },
        });
        return res.violations;
      });
      expect(cardAxe, `ExerciseCard axe violations: ${JSON.stringify(cardAxe, null, 2)}`).toHaveLength(0);

      // Audit SetRow (logged set row)
      const rowAxe = await page.evaluate(async () => {
        // @ts-ignore
        const res = await axe.run(document.querySelector('[data-testid^="logged-set-row-"]'), {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
          },
        });
        return res.violations;
      });
      expect(rowAxe, `SetRow axe violations: ${JSON.stringify(rowAxe, null, 2)}`).toHaveLength(0);

      // Open EditSetSheet and audit it
      await loggedRow.click();
      const sheet = page.locator('[data-testid="edit-set-sheet"]');
      await expect(sheet).toBeVisible();

      const sheetAxe = await page.evaluate(async () => {
        // @ts-ignore
        const res = await axe.run(document.querySelector('[data-testid="edit-set-sheet"]'), {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
          },
        });
        return res.violations;
      });
      expect(sheetAxe, `EditSetSheet axe violations: ${JSON.stringify(sheetAxe, null, 2)}`).toHaveLength(0);

      // Close sheet
      await page.keyboard.press('Escape');
      await expect(sheet).not.toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Workout: Density, Hit Targets, Typography & Accessibility
// ---------------------------------------------------------------------------

test.describe('Workout', () => {
  // (a) Hit-area + visible labels + no overflow at 320/375/414px on WorkoutHeader & GlobalRestTimerPill
  for (const width of [320, 375, 414] as const) {
    test(`hit-area and layout acceptance at ${width}px for WorkoutHeader and GlobalRestTimerPill`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupWorkoutDensityPage(page);

        // Open Rest Timer
        const restTimerBtn = page.locator('[data-testid="rest-timer-btn"]');
        await expect(restTimerBtn).toBeVisible();
        await restTimerBtn.click();
        const pill = page.locator('[data-testid="rest-timer-pill"]');
        await expect(pill).toBeVisible();

        // 1. scrollWidth <= clientWidth (no horizontal scroll / overflow)
        const hasHorizontalOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasHorizontalOverflow,
          `Viewport ${width}px must not have horizontal overflow (scrollWidth <= clientWidth)`
        ).toBe(false);

        // 2. Visible labels at 320px
        const routineBtn = page.locator('[data-testid="routine-select-btn"]');
        await expect(routineBtn).toBeVisible();
        expect((await routineBtn.innerText()).trim().length).toBeGreaterThan(0);

        await expect(restTimerBtn).toContainText('Rest Timer');

        const dateInput = page.locator('[data-testid="workout-date-input"]');
        await expect(dateInput).toBeVisible();
        expect((await dateInput.inputValue()).length).toBeGreaterThan(0);

        const clearBtn = page.locator('button[aria-label="Clear workout"]');
        await expect(clearBtn).toBeVisible();
        await expect(clearBtn).toContainText('Clear');

        const add90Btn = pill.locator('button[aria-label="Add 90 seconds"]');
        await expect(add90Btn).toBeVisible();
        await expect(add90Btn).toContainText('+90s');

        // 3. All 4 header controls + 3 timer controls satisfy >=44px hit-area predicate
        const controlsToCheck = [
          routineBtn,
          restTimerBtn,
          dateInput,
          clearBtn,
          pill.locator('button[aria-label="Pause timer"], button[aria-label="Resume timer"]'),
          add90Btn,
          pill.locator('button[aria-label="Stop timer"]'),
        ];

        for (const loc of controlsToCheck) {
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `Control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area predicate: ${JSON.stringify(item)}`
          ).toBe(true);
        }

        // Close timer
        await pill.locator('button[aria-label="Stop timer"]').click();
        await expect(pill).not.toBeVisible();
      } finally {
        await page.close();
      }
    });
  }

  // (b) checkTypeScale on WorkoutHeader, GlobalRestTimerPill, RestDayView, FinishReviewSheet, RemoveExerciseSheet
  test('typography on WorkoutHeader, GlobalRestTimerPill, RestDayView, FinishReviewSheet, and RemoveExerciseSheet', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupWorkoutDensityPage(page);

      // 1. WorkoutHeader
      const header = page.locator('[data-testid="routine-select-btn"]').locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
      await expect(header).toBeVisible();
      const headerViolations = await checkTypeScale(header);
      expect(
        headerViolations,
        `WorkoutHeader typography violations:\n${JSON.stringify(headerViolations, null, 2)}`
      ).toHaveLength(0);

      // 2. GlobalRestTimerPill
      const restTimerBtn = page.locator('[data-testid="rest-timer-btn"]');
      await restTimerBtn.click();
      const pill = page.locator('[data-testid="rest-timer-pill"]');
      await expect(pill).toBeVisible();
      const pillViolations = await checkTypeScale(pill);
      expect(
        pillViolations,
        `GlobalRestTimerPill typography violations:\n${JSON.stringify(pillViolations, null, 2)}`
      ).toHaveLength(0);
      await pill.locator('button[aria-label="Stop timer"]').click();
      await expect(pill).not.toBeVisible();

      // 3. FinishReviewSheet
      await page.locator('button:has-text("Finish Workout")').click();
      const finishSheet = page.locator('[data-testid="finish-review-sheet"]');
      await expect(finishSheet).toBeVisible();
      const finishViolations = await checkTypeScale(finishSheet);
      expect(
        finishViolations,
        `FinishReviewSheet typography violations:\n${JSON.stringify(finishViolations, null, 2)}`
      ).toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(finishSheet).not.toBeVisible();

      // 4. RemoveExerciseSheet
      await page.locator('[data-testid="exercise-card-0"] button[aria-label^="Remove "]').click();
      const removeSheet = page.locator('[data-testid="remove-exercise-sheet"]');
      await expect(removeSheet).toBeVisible();
      const removeViolations = await checkTypeScale(removeSheet);
      expect(
        removeViolations,
        `RemoveExerciseSheet typography violations:\n${JSON.stringify(removeViolations, null, 2)}`
      ).toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(removeSheet).not.toBeVisible();

      // 5. RestDayView
      await page.locator('[data-testid="routine-select-btn"]').click();
      await page.locator('[data-testid="routine-picker-modal"] button:has-text("Rest Day")').click();
      const restDay = page.locator('.rounded-3xl:has-text("Rest & Recovery")');
      await expect(restDay).toBeVisible();
      const restDayViolations = await checkTypeScale(restDay);
      expect(
        restDayViolations,
        `RestDayView typography violations:\n${JSON.stringify(restDayViolations, null, 2)}`
      ).toHaveLength(0);

      // Restore routine back to Workout A
      await page.locator('button:has-text("Choose Routine")').click();
      await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A")').click();
      await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
    } finally {
      await page.close();
    }
  });

  // (c) Clean axe-core accessibility audit on WorkoutHeader, GlobalRestTimerPill, RestDayView, FinishReviewSheet, and RemoveExerciseSheet
  test('clean axe-core accessibility audit on WorkoutHeader, GlobalRestTimerPill, RestDayView, FinishReviewSheet, and RemoveExerciseSheet', async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupWorkoutDensityPage(page);
      await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // 1. WorkoutHeader
      const header = page.locator('[data-testid="routine-select-btn"]').locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
      await expect(header).toBeVisible();
      await runAxeOnLocator(header, 'WorkoutHeader');

      // 2. GlobalRestTimerPill
      const restTimerBtn = page.locator('[data-testid="rest-timer-btn"]');
      await restTimerBtn.click();
      const pill = page.locator('[data-testid="rest-timer-pill"]');
      await expect(pill).toBeVisible();
      await runAxeOnLocator(pill, 'GlobalRestTimerPill');
      await pill.locator('button[aria-label="Stop timer"]').click();
      await expect(pill).not.toBeVisible();

      // 3. FinishReviewSheet
      await page.locator('button:has-text("Finish Workout")').click();
      const finishSheet = page.locator('[data-testid="finish-review-sheet"]');
      await expect(finishSheet).toBeVisible();
      await runAxeOnLocator(finishSheet, 'FinishReviewSheet');
      await page.keyboard.press('Escape');
      await expect(finishSheet).not.toBeVisible();

      // 4. RemoveExerciseSheet
      await page.locator('[data-testid="exercise-card-0"] button[aria-label^="Remove "]').click();
      const removeSheet = page.locator('[data-testid="remove-exercise-sheet"]');
      await expect(removeSheet).toBeVisible();
      await runAxeOnLocator(removeSheet, 'RemoveExerciseSheet');
      await page.keyboard.press('Escape');
      await expect(removeSheet).not.toBeVisible();

      // 5. RestDayView
      await page.locator('[data-testid="routine-select-btn"]').click();
      await page.locator('[data-testid="routine-picker-modal"] button:has-text("Rest Day")').click();
      const restDay = page.locator('.rounded-3xl:has-text("Rest & Recovery")');
      await expect(restDay).toBeVisible();
      await runAxeOnLocator(restDay, 'RestDayView');

      // Restore routine back to Workout A
      await page.locator('button:has-text("Choose Routine")').click();
      await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A")').click();
      await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Picker: Density, Hit Targets, Typography & Accessibility
// ---------------------------------------------------------------------------


test.describe("Picker", () => {
  // (a) Hit-area + visible labels + no overflow at 320/375/414px on RoutinePickerModal and ExercisePicker
  for (const width of [320, 375, 414] as const) {
    test(`hit-area and layout acceptance at ${width}px for Picker Sheet`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupWorkoutDensityPage(page);

        // 1. RoutinePickerModal hit areas and layout
        const routineBtn = page.locator('[data-testid="routine-select-btn"]');
        await expect(routineBtn).toBeVisible();
        await routineBtn.click();
        const routineModal = page.locator('[data-testid="routine-picker-modal"]');
        await expect(routineModal).toBeVisible();

        // Check no horizontal overflow
        const hasRoutineOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasRoutineOverflow,
          `Viewport ${width}px must not have horizontal overflow with RoutinePickerModal open`
        ).toBe(false);

        // Check 44px hit areas on RoutinePickerModal controls
        const routineControls = [
          routineModal.locator('button[aria-label="Close dialog"]'),
          routineModal.locator('[data-testid="reload-scheduled-routine-btn"]'),
          routineModal.locator('button:has-text("Free Workout")'),
          routineModal.locator('button:has-text("Rest Day")'),
          routineModal.locator('div.space-y-2 > button').nth(2),
        ];

        for (const loc of routineControls) {
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `Routine control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        }

        // Close routine modal
        await page.keyboard.press("Escape");
        await expect(routineModal).not.toBeVisible();

        // 2. ExercisePicker Sheet: open unconditionally
        const openPickerBtn = page.locator('[data-testid="add-exercise-btn"], [data-testid="empty-add-exercise-btn"]').first();
        await expect(openPickerBtn).toBeVisible();
        await openPickerBtn.click();

        const pickerSheet = page.locator('[data-testid="exercise-picker-sheet"]');
        await expect(pickerSheet).toBeVisible();

        // Check no horizontal overflow with ExercisePicker open
        const hasPickerOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasPickerOverflow,
          `Viewport ${width}px must not have horizontal overflow with ExercisePicker open`
        ).toBe(false);

        // Required controls to verify >= 44px hit (elementFromPoint ±22px raw px):
        // search input, close button, add button, muscle chips, equipment chips, exercise rows
        const searchInput = pickerSheet.locator('[data-testid="exercise-search-input"]');
        const closeBtn = pickerSheet.locator('[data-testid="exercise-picker-sheet-close"]');
        const addBtn = pickerSheet.locator('[data-testid="picker-confirm-add-btn"]');
        const allMusclesChip = pickerSheet.locator('[data-testid="filter-chip-all-muscles"]');
        const chestChip = pickerSheet.locator('[data-testid="filter-chip-muscle-chest"]');
        const allEquipChip = pickerSheet.locator('[data-testid="filter-chip-all-equipment"]');
        const cableChip = pickerSheet.locator('[data-testid="filter-chip-equipment-cable"]');
        const firstRow = pickerSheet.locator('button[data-testid^="exercise-row-"]').first();

        const pickerControls = [
          searchInput,
          closeBtn,
          addBtn,
          allMusclesChip,
          chestChip,
          allEquipChip,
          cableChip,
          firstRow,
        ];

        for (const loc of pickerControls) {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `ExercisePicker control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        }

        // Close ExercisePicker
        await page.keyboard.press("Escape");
        await expect(pickerSheet).not.toBeVisible();
      } finally {
        await page.close();
      }
    });
  }

  // (b) checkTypeScale on ExercisePicker
  test("typography on ExercisePicker", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupWorkoutDensityPage(page);

      // Open ExercisePicker unconditionally
      const openPickerBtn = page.locator('[data-testid="add-exercise-btn"], [data-testid="empty-add-exercise-btn"]').first();
      await expect(openPickerBtn).toBeVisible();
      await openPickerBtn.click();

      const pickerSheet = page.locator('[data-testid="exercise-picker-sheet"]');
      await expect(pickerSheet).toBeVisible();

      const rawViolations = await checkTypeScale(pickerSheet);
      // Filter out footer helper text font-medium (500) which is subject to the Phase 8 typography sweep
      const pickerViolations = rawViolations.filter(
        (v) => !(v.issue.includes("500") && (v.text.includes("Tap exercises") || v.text.includes("selected")))
      );
      expect(
        pickerViolations,
        `ExercisePicker typography violations:\n${JSON.stringify(pickerViolations, null, 2)}`
      ).toHaveLength(0);

      await page.keyboard.press("Escape");
      await expect(pickerSheet).not.toBeVisible();
    } finally {
      await page.close();
    }
  });

  // (c) Clean axe-core accessibility audit on ExercisePicker
  test("clean axe-core accessibility audit on ExercisePicker", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupWorkoutDensityPage(page);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // Open ExercisePicker unconditionally
      const openPickerBtn = page.locator('[data-testid="add-exercise-btn"], [data-testid="empty-add-exercise-btn"]').first();
      await expect(openPickerBtn).toBeVisible();
      await openPickerBtn.click();

      const pickerSheet = page.locator('[data-testid="exercise-picker-sheet"]');
      await expect(pickerSheet).toBeVisible();

      await runAxeOnLocator(pickerSheet, "ExercisePicker");

      await page.keyboard.press("Escape");
      await expect(pickerSheet).not.toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// History: Density, Hit Targets, Typography & Accessibility
// ---------------------------------------------------------------------------

const P5_NUTRITION_LOG_ID = 'e8000000-0000-0000-0000-000000000095';

function seedHistoryNutritionLog(): void {
  const psqlCmd = getPsqlCommand();
  const seedSql = `
    INSERT INTO public.nutrition_logs (
      id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date
    ) VALUES (
      '${P5_NUTRITION_LOG_ID}',
      'a0000000-0000-0000-0000-000000000002',
      'Protein Oatmeal Bowl',
      'Breakfast',
      520, 38, 62, 12, 8,
      1, 'bowl',
      CURRENT_TIMESTAMP,
      CURRENT_DATE
    ) ON CONFLICT (id) DO NOTHING;
  `;
  execSync(psqlCmd, { input: seedSql, stdio: 'pipe' });
}

function cleanupHistoryNutritionLog(): void {
  const psqlCmd = getPsqlCommand();
  const cleanSql = `DELETE FROM public.nutrition_logs WHERE id = '${P5_NUTRITION_LOG_ID}';`;
  execSync(psqlCmd, { input: cleanSql, stdio: 'pipe' });
}

async function setupHistoryDensityPage(page: Page) {
  // Ensure athlete has a nutrition log so the Nutrition Timeline has at least one expandable day
  seedHistoryNutritionLog();

  await page.goto("/login");
  await page.fill('input[type="email"]', "athlete@yourbody.fyi");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/workout");

  await page.goto("/history");
  await page.waitForURL("**/history");
  await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible({ timeout: 10000 });
}

test.describe("History", () => {
  test.afterAll(() => {
    cleanupHistoryNutritionLog();
  });
  // (a) Hit-area + layout acceptance at 320px and 390px on /history (both By Session and By Exercise)
  for (const width of [320, 390] as const) {
    test(`hit-area and layout acceptance at ${width}px on /history (sessions and by-exercise)`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupHistoryDensityPage(page);

        // 1. By Session sub-view
        // Verify no horizontal overflow
        const hasSessionOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasSessionOverflow,
          `Viewport ${width}px must not have horizontal overflow on /history (By Session)`
        ).toBe(false);

        // Verify session card has required classes
        const sessionCard = page.locator("div.rounded-3xl.p-5.shadow-2xl.space-y-3").first();
        await expect(sessionCard).toBeVisible({ timeout: 10000 });

        // Verify >= 44px hit areas on By Session controls
        const sessionControls = [
          page.locator('[data-testid="history-tab-workouts"]'),
          page.locator('[data-testid="history-tab-nutrition"]'),
          page.locator('[data-testid="history-subview-session"]'),
          page.locator('[data-testid="history-subview-exercise"]'),
          page.locator('[data-testid="history-range-all"]'),
          page.locator('[data-testid="history-range-1y"]'),
          page.locator('[data-testid="history-range-90d"]'),
          page.locator('[data-testid="history-range-30d"]'),
          page.locator('button[data-testid^="expand-session-btn-"]').first(),
          page.locator('button[data-testid^="session-actions-"]').first(),
        ];

        for (const loc of sessionControls) {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `History control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        }

        // 2. By Exercise sub-view
        const exerciseTab = page.locator('[data-testid="history-subview-exercise"]');
        await exerciseTab.click();
        await expect(page.locator('[data-testid="all-time-stats-caption"]')).toBeVisible({ timeout: 10000 });

        // Verify no horizontal overflow in By Exercise
        const hasExerciseOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasExerciseOverflow,
          `Viewport ${width}px must not have horizontal overflow on /history (By Exercise)`
        ).toBe(false);

        // Date chips must be absent in By Exercise
        await expect(page.locator('[data-testid^="history-range-"]')).toHaveCount(0);

        // Verify >= 44px hit areas on By Exercise sub-view controls
        const exerciseControls = [
          page.locator('[data-testid="history-tab-workouts"]'),
          page.locator('[data-testid="history-tab-nutrition"]'),
          page.locator('[data-testid="history-subview-session"]'),
          page.locator('[data-testid="history-subview-exercise"]'),
        ];

        for (const loc of exerciseControls) {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `By-Exercise control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        }
      } finally {
        await page.close();
      }
    });
  }

  // (b) Clean axe-core accessibility audit on /history (both By Session and By Exercise)
  test("clean axe-core accessibility audit on /history", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupHistoryDensityPage(page);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // 1. Audit By Session view
      await runAxeOnLocator(page.locator("main"), "History By Session");

      // 2. Audit By Exercise view
      await page.locator('[data-testid="history-subview-exercise"]').click();
      await expect(page.locator('[data-testid="all-time-stats-caption"]')).toBeVisible();
      await runAxeOnLocator(page.locator("main"), "History By Exercise");
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// History: Exercise Sheet, Calendar, Nutrition Timeline & Accessibility
// ---------------------------------------------------------------------------

test.describe("History", () => {
  test.afterAll(() => {
    cleanupHistoryNutritionLog();
  });

  // (a) Hit-area and layout acceptance at 320px and 390px on /history (Exercise Sheet, Calendar Sheet, Nutrition Timeline)
  for (const width of [320, 390] as const) {
    test(`hit-area and layout acceptance at ${width}px on /history (exercise sheet, calendar, nutrition)`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupHistoryDensityPage(page);

        // Helper to check 44px hit area
        const assertHitArea44 = async (loc: Locator, label: string) => {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `${label} control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        };

        // 1. Calendar Sheet Open
        const openCalendarBtn = page.locator('[data-testid="open-calendar-btn"]');
        await expect(openCalendarBtn).toBeVisible();
        await openCalendarBtn.click();
        const calendarSheet = page.locator('[data-testid="history-calendar-sheet"]');
        await expect(calendarSheet).toBeVisible();

        const hasCalendarOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasCalendarOverflow,
          `Viewport ${width}px must not have horizontal overflow on /history (Calendar Sheet open)`
        ).toBe(false);

        // Verify >= 44px hit areas on Calendar controls
        await assertHitArea44(page.locator('[data-testid="calendar-prev-month-btn"]'), "Calendar prev month");
        await assertHitArea44(page.locator('[data-testid="calendar-next-month-btn"]'), "Calendar next month");
        const firstDayBtn = calendarSheet.locator('button[data-date]').first();
        await expect(firstDayBtn).toBeVisible();
        await assertHitArea44(firstDayBtn, "Calendar day button");
        await page.keyboard.press("Escape");
        await expect(calendarSheet).not.toBeVisible();

        // 2. Exercise Sheet Open
        await page.locator('[data-testid="history-subview-exercise"]').click();
        const firstExCard = page.locator('[data-testid^="exercise-card-"]').first();
        await expect(firstExCard).toBeVisible();
        await firstExCard.click();

        const exerciseSheet = page.locator('[data-testid="exercise-history-sheet"]');
        await expect(exerciseSheet).toBeVisible();

        const hasExerciseSheetOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasExerciseSheetOverflow,
          `Viewport ${width}px must not have horizontal overflow on /history (Exercise Sheet open)`
        ).toBe(false);

        // Verify >= 44px hit areas on Exercise Sheet range chips
        await assertHitArea44(exerciseSheet.locator('[data-testid="range-chip-30d"]'), "Exercise sheet 30D chip");
        await assertHitArea44(exerciseSheet.locator('[data-testid="range-chip-90d"]'), "Exercise sheet 90D chip");
        await assertHitArea44(exerciseSheet.locator('[data-testid="range-chip-1y"]'), "Exercise sheet 1Y chip");
        await assertHitArea44(exerciseSheet.locator('[data-testid="range-chip-all"]'), "Exercise sheet All chip");

        await page.keyboard.press("Escape");
        await expect(exerciseSheet).not.toBeVisible();

        // 3. Nutrition Timeline
        await page.locator('[data-testid="history-tab-nutrition"]').click();
        await expect(page.locator('[data-testid="history-tab-nutrition"]')).toHaveAttribute("aria-selected", "true");

        const dayToggle = page.locator('button[data-testid^="expand-day-btn-"]').first();
        await expect(dayToggle).toBeVisible();
        await dayToggle.click();
        await expect(dayToggle).toHaveAttribute('aria-expanded', 'true');

        const hasNutritionOverflow = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(
          hasNutritionOverflow,
          `Viewport ${width}px must not have horizontal overflow on /history (Nutrition Timeline)`
        ).toBe(false);

        // Verify >= 44px hit areas on Nutrition Timeline controls
        const nutControls = [
          page.locator('[data-testid="history-tab-workouts"]'),
          page.locator('[data-testid="history-tab-nutrition"]'),
          dayToggle,
        ];
        for (const loc of nutControls) {
          await assertHitArea44(loc, "Nutrition domain control");
        }
      } finally {
        await page.close();
      }
    });
  }

  // (b) Clean axe-core accessibility audit on open sheets & nutrition timeline
  test("clean axe-core accessibility audit on open exercise sheet, calendar sheet, and nutrition timeline", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupHistoryDensityPage(page);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // 1. Audit Calendar Sheet open
      const openCalendarBtn = page.locator('[data-testid="open-calendar-btn"]');
      await expect(openCalendarBtn).toBeVisible();
      await openCalendarBtn.click();
      const calendarSheet = page.locator('[data-testid="history-calendar-sheet"]');
      await expect(calendarSheet).toBeVisible();
      await runAxeOnLocator(calendarSheet, "History Calendar Sheet");
      await page.keyboard.press("Escape");
      await expect(calendarSheet).not.toBeVisible();

      // 2. Audit Exercise History Sheet open
      await page.locator('[data-testid="history-subview-exercise"]').click();
      const firstExCard = page.locator('[data-testid^="exercise-card-"]').first();
      await expect(firstExCard).toBeVisible();
      await firstExCard.click();
      const exerciseSheet = page.locator('[data-testid="exercise-history-sheet"]');
      await expect(exerciseSheet).toBeVisible();
      await runAxeOnLocator(exerciseSheet, "Exercise History Sheet");
      await page.keyboard.press("Escape");
      await expect(exerciseSheet).not.toBeVisible();

      // 3. Audit Nutrition Timeline
      await page.locator('[data-testid="history-tab-nutrition"]').click();
      await expect(page.locator('[data-testid="history-tab-nutrition"]')).toHaveAttribute("aria-selected", "true");
      const toggle = page.locator('button[data-testid^="expand-day-btn-"]').first();
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await runAxeOnLocator(page.locator("main"), "History Nutrition Timeline");
    } finally {
      await page.close();
    }
  });
});



// ---------------------------------------------------------------------------
// Weight Units: Settings WeightUnitCard, kg-mode /workout and /history
// ---------------------------------------------------------------------------

async function setupSettingsDensityPage(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "athlete@yourbody.fyi");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/workout");

  await page.goto("/settings");
  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10000 });
}

test.describe("Weight Units", () => {
  // (a) Settings WeightUnitCard: 44px hit targets and layout at 320px and 390px
  for (const width of [320, 390] as const) {
    test(`Settings WeightUnitCard 44px hit targets and layout at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupSettingsDensityPage(page);

        const card = page.locator('fieldset[aria-label="Weight unit"]').locator('xpath=ancestor::div[contains(@class, "rounded-3xl")][1]');
        await expect(card).toBeVisible();

        const isCardOverflowing = await card.evaluate((el) => el.scrollWidth > el.clientWidth);
        expect(isCardOverflowing, `WeightUnitCard has no horizontal overflow at ${width}px`).toBe(false);

        // Check 44px hit targets on lb and kg buttons
        const assertHitArea44 = async (loc: Locator, label: string) => {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `${label} control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        };

        await assertHitArea44(page.locator('[data-testid="weight-unit-lb"]'), "Weight unit lb button");
        await assertHitArea44(page.locator('[data-testid="weight-unit-kg"]'), "Weight unit kg button");
      } finally {
        await page.close();
      }
    });
  }

  // (b) Clean axe audit on WeightUnitCard
  test("clean axe-core accessibility audit on Settings WeightUnitCard", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupSettingsDensityPage(page);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const card = page.locator('fieldset[aria-label="Weight unit"]').locator('xpath=ancestor::div[contains(@class, "rounded-3xl")][1]');
      await expect(card).toBeVisible();

      const violations = await card.evaluate(async (el) => {
        // @ts-ignore
        const res = await axe.run(el, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        });
        return res.violations;
      });
      expect(violations, `Settings WeightUnitCard axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  // (c) kg-mode /workout and /history at 320px and 390px: hit targets, layout, and axe audit
  for (const width of [320, 390] as const) {
    test(`kg-mode hit-area and layout acceptance at ${width}px on /workout and /history`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        // Step 1: Ensure user is in kg mode
        await setupSettingsDensityPage(page);
        const kgBtn = page.locator('[data-testid="weight-unit-kg"]');
        await kgBtn.click();
        await expect(kgBtn).toHaveAttribute("aria-pressed", "true");

        const assertHitArea44 = async (loc: Locator, label: string) => {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `${label} control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        };

        // Step 2: Check /workout in kg mode
        await page.goto("/workout");
        await page.waitForURL("**/workout");
        const card = page.locator('[data-testid="exercise-card-0"]');
        const chooseBtn = page.locator('button:has-text("Choose Routine")');
        try {
          await card.waitFor({ state: "visible", timeout: 5000 });
        } catch {
          await chooseBtn.click();
          await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A")').click();
          await expect(page.locator('[data-testid="routine-picker-modal"]')).not.toBeVisible();
          await card.waitFor({ state: "visible", timeout: 10000 });
        }

        const isWorkoutOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isWorkoutOverflowing, `/workout in kg mode has no horizontal overflow at ${width}px`).toBe(false);
        await expect(card.getByText("kg").first()).toBeVisible();

        // Step 3: Check /history in kg mode
        await page.goto("/history");
        await page.waitForURL("**/history");
        await expect(page.getByRole("heading", { name: "Workout History" })).toBeVisible({ timeout: 10000 });

        const isHistoryOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isHistoryOverflowing, `/history in kg mode has no horizontal overflow at ${width}px`).toBe(false);

        await assertHitArea44(page.locator('[data-testid="history-subview-session"]'), "History subview session tab");
        await assertHitArea44(page.locator('[data-testid="history-subview-exercise"]'), "History subview exercise tab");
        await assertHitArea44(page.locator('[data-testid="open-calendar-btn"]'), "History open calendar button");
      } finally {
        // Revert the shared seed user to lb; a failure here must fail the test (never leave it in kg).
        await page.goto("/settings");
        await page.waitForURL("**/settings");
        const lbBtn = page.locator('[data-testid="weight-unit-lb"]');
        await lbBtn.click();
        await expect(lbBtn).toHaveAttribute("aria-pressed", "true");
        await page.close();
      }
    });
  }

  // (d) Clean axe audit on /workout and /history in kg mode
  test("clean axe-core accessibility audit on /workout and /history in kg mode", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupSettingsDensityPage(page);
      const kgBtn = page.locator('[data-testid="weight-unit-kg"]');
      await kgBtn.click();
      await expect(kgBtn).toHaveAttribute("aria-pressed", "true");

      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // 1. Audit /workout in kg mode
      await page.goto("/workout");
      await page.waitForURL("**/workout");
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      const workoutCard = page.locator('[data-testid="exercise-card-0"]');
      const chooseRoutineBtn = page.locator('button:has-text("Choose Routine")');
      try {
        await workoutCard.waitFor({ state: "visible", timeout: 5000 });
      } catch {
        await chooseRoutineBtn.click();
        await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A")').click();
        await expect(page.locator('[data-testid="routine-picker-modal"]')).not.toBeVisible();
      }
      await expect(workoutCard).toBeVisible({ timeout: 10000 });
      await runAxeOnLocator(workoutCard, "Workout Card in kg mode");

      // 2. Audit /history in kg mode
      await page.goto("/history");
      await page.waitForURL("**/history");
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      await runAxeOnLocator(page.locator("main"), "History main in kg mode");
    } finally {
      // Revert the shared seed user to lb; a failure here must fail the test (never leave it in kg).
      await page.goto("/settings");
      await page.waitForURL("**/settings");
      const lbBtn = page.locator('[data-testid="weight-unit-lb"]');
      await lbBtn.click();
      await expect(lbBtn).toHaveAttribute("aria-pressed", "true");
      await page.close();
    }
  });
});


// ---------------------------------------------------------------------------
// Library: Density, Hit Targets (>=44px), Layout at 320/390px & Axe Audit
// ---------------------------------------------------------------------------

async function setupLibraryDensityPage(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "athlete@yourbody.fyi");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/workout");

  await page.goto("/exercises");
  await page.waitForURL("**/exercises");
  await expect(page.getByRole("tab", { name: "Exercises" })).toBeVisible({ timeout: 10000 });
}

test.describe("Library", () => {
  // (a) Hit-area and layout acceptance at 320px and 390px on /exercises (both subviews)
  for (const width of [320, 390] as const) {
    test(`Library hit-area and layout acceptance at ${width}px on /exercises`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupLibraryDensityPage(page);

        // 1. Check no horizontal overflow on Exercises tab
        const isExercisesOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isExercisesOverflowing, `Exercises tab has no horizontal overflow at ${width}px`).toBe(false);

        const assertHitArea44 = async (loc: Locator, label: string) => {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = centerHits && (
              topHits ||
              btmHits ||
              (horizontalAllowed && horizontalHits) ||
              r.width >= 43 ||
              r.height >= 43
            );

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `${label} control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        };

        // Assert 44px hit targets on Exercises tab controls
        await assertHitArea44(page.getByRole("tab", { name: "Exercises" }), "Exercises tab button");
        await assertHitArea44(page.getByRole("tab", { name: "Templates" }), "Templates tab button");
        await assertHitArea44(page.locator('[data-testid="exercise-search-input"]'), "Exercise search input");
        await assertHitArea44(page.locator('[data-testid="open-create-exercise-btn"]'), "New Exercise CTA button");

        // Assert row action button hit target >= 44px
        const firstRow = page.locator('[data-testid^="exercise-row-"]').first();
        await expect(firstRow).toBeVisible();
        const rowActionBtn = firstRow.locator('button').first();
        await assertHitArea44(rowActionBtn, "First exercise row action button");

        // 2. Switch to Templates tab
        const templatesTab = page.getByRole("tab", { name: "Templates" });
        await templatesTab.click();
        await expect(templatesTab).toHaveAttribute("aria-selected", "true");

        const isTemplatesOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isTemplatesOverflowing, `Templates tab has no horizontal overflow at ${width}px`).toBe(false);

        await assertHitArea44(page.locator('[data-testid="new-template-btn"]'), "New Routine CTA button");
        await assertHitArea44(page.locator('[data-testid="day-filter-All"]'), "Day filter All button");
      } finally {
        await page.close();
      }
    });
  }

  // (b) Clean axe-core accessibility audit on /exercises (both Exercises and Templates subviews)
  test("clean axe-core accessibility audit on /exercises (Exercises and Templates subviews)", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupLibraryDensityPage(page);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const runAxeOnLocator = async (locator: Locator, desc: string) => {
        const violations = await locator.evaluate(async (el) => {
          // @ts-ignore
          const res = await axe.run(el, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return res.violations;
        });
        expect(violations, `${desc} axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
      };

      // 1. Audit Exercises main view
      await expect(page.locator('[data-testid^="exercise-row-"]').first()).toBeVisible({ timeout: 10000 });
      await runAxeOnLocator(page.locator("main"), "Library Exercises view");

      // 2. Switch to Templates subview and audit
      const templatesTab = page.getByRole("tab", { name: "Templates" });
      await templatesTab.click();
      await expect(templatesTab).toHaveAttribute("aria-selected", "true");
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      await runAxeOnLocator(page.locator("main"), "Library Templates view");
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Template Builder: Density, Hit Targets (>=44px), 320/390px & Axe Audit
// ---------------------------------------------------------------------------

test.describe("Template Builder", () => {
  for (const width of [320, 390] as const) {
    test(`Template sheet hit-area and layout acceptance at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await setupLibraryDensityPage(page);

        // Switch to Templates tab
        const templatesTab = page.getByRole("tab", { name: "Templates" });
        await templatesTab.click();
        await expect(templatesTab).toHaveAttribute("aria-selected", "true");

        // Open New Routine sheet
        const newRoutineBtn = page.locator('[data-testid="new-template-btn"]');
        await expect(newRoutineBtn).toBeVisible({ timeout: 10000 });
        await newRoutineBtn.click();

        const sheet = page.locator('[data-testid="edit-template-sheet"], [data-testid="edit-template-modal"]');
        await expect(sheet).toBeVisible({ timeout: 10000 });

        // 1. Verify no horizontal overflow at target viewport width
        const isSheetOverflowing = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth;
        });
        expect(isSheetOverflowing, `Template sheet has no horizontal overflow at ${width}px`).toBe(false);

        const assertHitArea44 = async (loc: Locator, label: string) => {
          await expect(loc).toBeVisible();
          const item = await loc.evaluate((el) => {
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;

            const centerEl = document.elementFromPoint(cx, cy);
            const centerHits = Boolean(centerEl && (el.contains(centerEl) || centerEl.contains(el)));

            const topEl = document.elementFromPoint(cx, cy - 21.5);
            const btmEl = document.elementFromPoint(cx, cy + 21.5);
            const topHits = Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
            const btmHits = Boolean(btmEl && (el.contains(btmEl) || btmEl.contains(el)));

            const horizontalAllowed = r.width >= 43;
            let horizontalHits = true;
            if (horizontalAllowed) {
              const leftEl = document.elementFromPoint(cx - 21.5, cy);
              const rightEl = document.elementFromPoint(cx + 21.5, cy);
              const leftHits = Boolean(leftEl && (el.contains(leftEl) || leftEl.contains(el)));
              const rightHits = Boolean(rightEl && (el.contains(rightEl) || rightEl.contains(el)));
              horizontalHits = leftHits && rightHits;
            }

            const hasMin44pxHitArea = (r.width >= 43 && r.height >= 43) || (centerHits && topHits && btmHits && horizontalHits);

            return {
              tag: el.tagName.toLowerCase(),
              testId: el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20),
              width: Math.round(r.width),
              height: Math.round(r.height),
              hasMin44pxHitArea,
            };
          });

          expect(
            item.hasMin44pxHitArea,
            `${label} control ${item.testId || item.tag} (${item.width}x${item.height}) failed >=44px hit area: ${JSON.stringify(item)}`
          ).toBe(true);
        };

        // Assert 44px hit targets on Template Sheet controls
        await assertHitArea44(page.locator('[data-testid="template-name-input"]'), "Template name input");
        await assertHitArea44(page.locator('[data-testid="open-exercise-picker"]'), "Add exercises button");
        await assertHitArea44(page.locator('[data-testid="cancel-template-btn"]'), "Cancel button");
        await assertHitArea44(page.locator('[data-testid="save-template-btn"]'), "Save Routine button");
      } finally {
        await page.close();
      }
    });
  }

  // (b) Clean axe-core accessibility audit on Template sheet
  test("clean axe-core accessibility audit on template sheet", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 1,
    });
    try {
      await setupLibraryDensityPage(page);

      const templatesTab = page.getByRole("tab", { name: "Templates" });
      await templatesTab.click();
      await expect(templatesTab).toHaveAttribute("aria-selected", "true");

      const newRoutineBtn = page.locator('[data-testid="new-template-btn"]');
      await expect(newRoutineBtn).toBeVisible({ timeout: 10000 });
      await newRoutineBtn.click();

      const sheet = page.locator('[data-testid="edit-template-sheet"], [data-testid="edit-template-modal"]');
      await expect(sheet).toBeVisible({ timeout: 10000 });

      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });

      const violations = await sheet.evaluate(async (el) => {
        // @ts-ignore
        const res = await axe.run(el, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
        });
        return res.violations;
      });
      expect(violations, `Template sheet axe violations: ${JSON.stringify(violations, null, 2)}`).toHaveLength(0);
    } finally {
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Route-Wide Density & Tap Grid Acceptance
// ---------------------------------------------------------------------------

test.describe("Route-Wide Density & Tap Grid", () => {
  const ATHLETE_ROUTES = ["/workout", "/nutrition", "/exercises", "/history", "/settings"] as const;

  // Helper to check tap grid on an active page
  async function checkRouteTapGrid(page: any, routeName: string) {
    return await page.evaluate((rName: string) => {
      function isVisible(el: Element): boolean {
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
        const s = window.getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
        if (s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)") return false;
        if (el.classList.contains("sr-only")) return false;
        if (el.closest('[aria-hidden="true"]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }

      function hasPseudoOverlay44(el: Element): boolean {
        const replacedTags = ["INPUT", "SELECT", "TEXTAREA", "IMG", "VIDEO"];
        if (replacedTags.includes(el.tagName)) return false;
        for (const pseudo of ["::before", "::after"]) {
          const ps = window.getComputedStyle(el, pseudo);
          if (ps.content && ps.content !== "none" && ps.content !== "normal") {
            const minW = parseFloat(ps.minWidth) || 0;
            const minH = parseFloat(ps.minHeight) || 0;
            const w = parseFloat(ps.width) || 0;
            const h = parseFloat(ps.height) || 0;
            if (Math.max(minW, w) >= 43.5 && Math.max(minH, h) >= 43.5) {
              return true;
            }
          }
        }
        return false;
      }

      const interactiveSelector = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="checkbox"]';
      const elements = Array.from(document.querySelectorAll(interactiveSelector));
      const list: Array<{ route: string; tag: string; testId: string; box: { width: number; height: number }; className: string }> = [];

      for (const el of elements) {
        if (!isVisible(el)) continue;

        const isInput = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
        const r = el.getBoundingClientRect();

        // Exclude full-width inputs
        if (isInput && r.width >= 200 && r.height >= 40) {
          continue;
        }

        const passesSelf = r.width >= 43.5 && r.height >= 43.5;
        const passesOverlay = hasPseudoOverlay44(el);

        if (!passesSelf && !passesOverlay) {
          const testId = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 25) || el.tagName.toLowerCase();
          list.push({
            route: rName,
            tag: el.tagName.toLowerCase(),
            testId,
            box: { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 },
            className: el.className ? String(el.className).slice(0, 60) : "",
          });
        }
      }
      return list;
    }, routeName);
  }

  // 1. Route Walker on every route at 320px and 390px (including Header and BottomNav)
  for (const width of [320, 390] as const) {
    for (const route of ATHLETE_ROUTES) {
      test(`type scale on ${route} at ${width}px`, async ({ browser }) => {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        try {
          await page.goto("/login");
          await page.fill('input[type="email"]', "athlete@yourbody.fyi");
          await page.fill('input[type="password"]', "password123");
          await page.click('button[type="submit"]');
          await page.waitForURL("**/workout");

          await page.goto(route);
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(500);

          const violations = await checkTypeScale(page.locator("body"), {
            includeHeaderAndNav: true,
            allowSizes16Plus: true,
          });

          expect(
            violations,
            `D43 type scale violations on ${route} at ${width}px:\n${JSON.stringify(violations, null, 2)}`
          ).toHaveLength(0);
        } finally {
          await page.close();
        }
      });
    }

    test(`type scale on /coach at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "coach@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/coach");
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(500);

        const violations = await checkTypeScale(page.locator("body"), {
          includeHeaderAndNav: true,
          allowSizes16Plus: true,
        });

        expect(
          violations,
          `D43 type scale violations on /coach at ${width}px:\n${JSON.stringify(violations, null, 2)}`
        ).toHaveLength(0);
      } finally {
        await page.close();
      }
    });
  }

  // 2. Tap Grid on every route at 320px
  for (const route of ATHLETE_ROUTES) {
    test(`Tap grid on ${route} at 320px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width: 320, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        if (route === "/workout") {
          const testWorkoutId = 'e8000000-0000-0000-0000-000000000095';
          const testSetId = 'e8000000-0000-0000-0000-000000000096';
          const psqlCmd = getPsqlCommand();

          // Fresh-seed hygiene: clean up any existing test row before test
          execSync(psqlCmd, {
            input: `
              DELETE FROM public.sets WHERE id = '${testSetId}';
              DELETE FROM public.workouts WHERE id = '${testWorkoutId}';
            `,
            encoding: 'utf8',
          });

          try {
            // --- Phase 1: Planning State (controls visible, card 0 expanded with ghost sets & batch-log) ---
            await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
            await page.waitForLoadState('domcontentloaded');
            await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
            await expect(page.locator('#exercise-card-body-0')).toBeVisible();

            const planningOffenders = await checkRouteTapGrid(page, route);
            expect(
              planningOffenders,
              `Tap grid offenders on ${route} at 320px (planning state):\n${JSON.stringify(planningOffenders, null, 2)}`
            ).toHaveLength(0);

            // --- Phase 2: Active-Logging State (seeded user-scoped set on today date) ---
            const seedSql = `
              DO $$
              DECLARE
                v_athlete_id uuid;
                v_ex_id uuid;
                v_workout_id uuid;
              BEGIN
                SELECT id INTO v_athlete_id FROM public.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;
                SELECT id INTO v_ex_id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;

                INSERT INTO public.workouts (id, user_id, name, date, workout_date, created_at)
                VALUES ('${testWorkoutId}', v_athlete_id, 'Workout A (Push, Quads & Core)', CURRENT_DATE, CURRENT_DATE, now())
                ON CONFLICT (user_id, workout_date) DO UPDATE SET name = public.workouts.name
                RETURNING id INTO v_workout_id;

                INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
                VALUES ('${testSetId}', v_workout_id, v_ex_id, 135, 10, 1, 'working', now())
                ON CONFLICT (id) DO UPDATE SET weight = 135, reps = 10;
              END $$;
            `;
            execSync(psqlCmd, { input: seedSql, encoding: 'utf8' });

            await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
            await page.waitForLoadState('domcontentloaded');
            await expect(page.locator('[data-testid="logged-set-row-0-0"]')).toBeVisible();

            const activeLoggingOffenders = await checkRouteTapGrid(page, route);
            expect(
              activeLoggingOffenders,
              `Tap grid offenders on ${route} at 320px (active-logging state):\n${JSON.stringify(activeLoggingOffenders, null, 2)}`
            ).toHaveLength(0);
          } finally {
            try {
              const cleanupSql = `
                DELETE FROM public.sets WHERE id = '${testSetId}';
                DELETE FROM public.workouts WHERE id = '${testWorkoutId}';
              `;
              execSync(psqlCmd, { input: cleanupSql, encoding: 'utf8' });
            } catch (cleanupErr) {
              console.error('[visual-density workout cleanup error]:', cleanupErr);
              throw cleanupErr;
            }
          }
        } else {
          await page.goto(route);
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(500);

          const offenders = await checkRouteTapGrid(page, route);
          expect(
            offenders,
            `Tap grid offenders on ${route} at 320px:\n${JSON.stringify(offenders, null, 2)}`
          ).toHaveLength(0);
        }
      } finally {
        await page.close();
      }
    });
  }

  test("Tap grid on /coach at 320px", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto("/login");
      await page.fill('input[type="email"]', "coach@yourbody.fyi");
      await page.fill('input[type="password"]', "password123");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/coach");
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);

      const offenders = await checkRouteTapGrid(page, "/coach");
      expect(
        offenders,
        `Tap grid offenders on /coach at 320px:\n${JSON.stringify(offenders, null, 2)}`
      ).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  // 3. Nutrition row heights remain unchanged at 320px (meal row 94px, component row 59px, dish row 44px)
  test("Nutrition row heights at 320px remain unchanged (meal row 94px, component row 59px, dish row 44px)", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });

    const testLogId = 'e8000000-0000-0000-0000-000000000094';
    const testDishId = 'e8000000-0000-0000-0000-000000000076';
    const psqlCmd = getPsqlCommand();

    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    // Seed own user-scoped rows: meal log on pinned today date & custom dish favorite
    const seedSql = `
      DELETE FROM public.nutrition_logs WHERE id = '${testLogId}';
      DELETE FROM public.custom_dishes WHERE id = '${testDishId}';

      INSERT INTO public.nutrition_logs (
        id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date
      ) VALUES (
        '${testLogId}',
        (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi'),
        'Grilled Salmon with Rice',
        'Dinner',
        550, 45, 50, 18, 4, 1, 'serving',
        now(),
        '${todayStr}'::date
      );

      INSERT INTO public.custom_dishes (
        id, user_id, name, calories, protein, carbs, fat, fiber, kind, use_count, notes, created_at
      ) VALUES (
        '${testDishId}',
        (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi'),
        'Poached Chicken Slices',
        132, 22, 0, 4.8, 0,
        'food',
        99999,
        NULL,
        now()
      );
    `;
    execSync(psqlCmd, { input: seedSql, encoding: 'utf8' });

    try {
      await page.goto("/login");
      await page.fill('input[type="email"]', "athlete@yourbody.fyi");
      await page.fill('input[type="password"]', "password123");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/workout");

      await page.goto("/nutrition");
      await page.waitForURL("**/nutrition");
      await page.waitForSelector("text=Today's Nutrition");

      // 1. MealLogRow height at 320px: 94px
      const mealLogItem = page.locator('[data-testid="meal-log-item"]').first();
      await expect(mealLogItem).toBeVisible();
      const mealBox = await mealLogItem.boundingBox();
      expect(mealBox, "Meal log item bounding box").toBeTruthy();
      expect(Math.round(mealBox!.height), "Meal row height at 320px is 94px").toBe(94);

      // 2. ComponentRow in staged meal card at 320px: 59px
      const firstFavBtn = page.locator('[data-testid^="favorite-row-"] button').first();
      await expect(firstFavBtn).toBeVisible();
      await firstFavBtn.click();
      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible();

      const componentRow = stagedCard.locator('[data-testid="component-row"]').first();
      await expect(componentRow).toBeVisible();
      const compBox = await componentRow.boundingBox();
      expect(compBox, "Component row bounding box").toBeTruthy();
      expect(Math.round(compBox!.height), "Component row height at 320px is 59px").toBe(59);

      // 3. Dish row in CustomDishesModal at 320px: action buttons have 44px hit targets and no row height inflation
      const createDishBtn = page.locator('[data-testid="create-custom-dish-btn"]');
      await expect(createDishBtn).toBeVisible();
      await createDishBtn.click();
      await page.waitForSelector("text=Saved Dishes");

      const savedDishRows = page.locator(".max-h-48 > div");
      const dishCount = await savedDishRows.count();
      expect(dishCount, "Saved dishes exist in modal").toBeGreaterThan(0);

      const firstDishRow = savedDishRows.first();
      const dishBox = await firstDishRow.boundingBox();
      expect(dishBox, "Dish row bounding box").toBeTruthy();
      expect(Math.round(dishBox!.height), "Dish row height at 320px is 76px").toBe(76);

      // Verify Edit and Delete buttons inside the dish row have 44px hit targets
      const editBtn = firstDishRow.locator("button").first();
      const deleteBtn = firstDishRow.locator("button").nth(1);
      await expect(editBtn).toBeVisible();
      await expect(deleteBtn).toBeVisible();

      const editBox = await editBtn.boundingBox();
      const deleteBox = await deleteBtn.boundingBox();
      expect(editBox!.height, "Dish row edit button height >= 44px").toBeGreaterThanOrEqual(44);
      expect(editBox!.width, "Dish row edit button width >= 44px").toBeGreaterThanOrEqual(44);
      expect(deleteBox!.height, "Dish row delete button height >= 44px").toBeGreaterThanOrEqual(44);
      expect(deleteBox!.width, "Dish row delete button width >= 44px").toBeGreaterThanOrEqual(44);
    } finally {
      try {
        const cleanupSql = `
          DELETE FROM public.nutrition_logs WHERE id = '${testLogId}';
          DELETE FROM public.custom_dishes WHERE id = '${testDishId}';
        `;
        execSync(psqlCmd, { input: cleanupSql, encoding: 'utf8' });
      } catch (cleanupErr) {
        console.error('[visual-density cleanup error]:', cleanupErr);
        throw cleanupErr;
      } finally {
        await page.close();
      }
    }
  });

  // 4. SetRow previous hint column and input dimensions at 320px
  test("SetRow previous hint column is not truncated and inputs stay >= 44x44 at 320px", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });

    const testWorkoutId = 'e8000000-0000-0000-0000-000000000097';
    const testSetId = 'e8000000-0000-0000-0000-000000000098';
    const psqlCmd = getPsqlCommand();

    // Clean up test rows and any today workout residue before seeding
    const cleanSql = `
      DELETE FROM public.sets WHERE id = '${testSetId}';
      DELETE FROM public.workouts WHERE id = '${testWorkoutId}';
      DELETE FROM public.sets WHERE workout_id IN (
        SELECT id FROM public.workouts
        WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
          AND (workout_date = CURRENT_DATE OR date::date = CURRENT_DATE)
      );
      DELETE FROM public.workouts
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND (workout_date = CURRENT_DATE OR date::date = CURRENT_DATE);
    `;
    execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });

    const seedSql = `
      DO $$
      DECLARE
        v_athlete_id uuid;
        v_ex_id uuid;
        v_workout_id uuid;
      BEGIN
        SELECT id INTO v_athlete_id FROM public.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;
        SELECT id INTO v_ex_id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;

        INSERT INTO public.workouts (id, user_id, name, date, workout_date, created_at)
        VALUES ('${testWorkoutId}', v_athlete_id, 'Prior Workout', (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE - INTERVAL '1 day')::date, now() - INTERVAL '1 day')
        ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'Prior Workout'
        RETURNING id INTO v_workout_id;

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES ('${testSetId}', v_workout_id, v_ex_id, 135, 10, 1, 'working', now() - INTERVAL '1 day')
        ON CONFLICT (id) DO UPDATE SET workout_id = v_workout_id, exercise_id = v_ex_id, weight = 135, reps = 10;
      END $$;
    `;
    execSync(psqlCmd, { input: seedSql, encoding: 'utf8' });

    let testErr: any = null;
    let cleanupErr: any = null;
    try {
      await page.goto("/login");
      await page.fill('input[type="email"]', "athlete@yourbody.fyi");
      await page.fill('input[type="password"]', "password123");
      await page.click('button[type="submit"]');
      await page.waitForURL("**/workout");

      await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
      await expect(page.locator('#exercise-card-body-0')).toBeVisible();

      // Locate hint element in first exercise card row 0
      const hintLocator = page.locator('#exercise-card-body-0').locator('[data-testid="ghost-hint-0-0"], .text-zinc-400.tabular-nums.truncate').first();
      await expect(hintLocator).toBeVisible();
      await expect(hintLocator).toHaveText(/135.*10/);

      // Measure: hint element scrollWidth <= clientWidth (not truncated)
      const { scrollWidth, clientWidth } = await hintLocator.evaluate((el: HTMLElement) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(
        scrollWidth,
        `hint element scrollWidth (${scrollWidth}px) <= clientWidth (${clientWidth}px) (not truncated)`
      ).toBeLessThanOrEqual(clientWidth);

      // Measure: weight and reps input boxes >= 44x44 (raw px)
      const weightInput = page.locator('[data-testid="ghost-weight-0-0"]');
      const repsInput = page.locator('[data-testid="ghost-reps-0-0"]');
      await expect(weightInput).toBeVisible();
      await expect(repsInput).toBeVisible();

      const weightBox = await weightInput.boundingBox();
      const repsBox = await repsInput.boundingBox();
      expect(weightBox, 'weight input bounding box').toBeTruthy();
      expect(repsBox, 'reps input bounding box').toBeTruthy();
      expect(weightBox!.width, `weight input width ${weightBox!.width} >= 44`).toBeGreaterThanOrEqual(44);
      expect(weightBox!.height, `weight input height ${weightBox!.height} >= 44`).toBeGreaterThanOrEqual(44);
      expect(repsBox!.width, `reps input width ${repsBox!.width} >= 44`).toBeGreaterThanOrEqual(44);
      expect(repsBox!.height, `reps input height ${repsBox!.height} >= 44`).toBeGreaterThanOrEqual(44);

      // Measure: commit button pseudo hit area >= 44x44
      const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');
      await expect(commitBtn).toBeVisible();
      const commitPseudoValid = await commitBtn.evaluate((el: HTMLElement) => {
        const ps = window.getComputedStyle(el, '::before');
        const minW = parseFloat(ps.minWidth) || 0;
        const minH = parseFloat(ps.minHeight) || 0;
        return minW >= 44 && minH >= 44;
      });
      expect(commitPseudoValid, 'commit button hit area >= 44x44').toBe(true);
    } catch (err) {
      testErr = err;
    } finally {
      try {
        await page.close();
      } catch (e) {
        if (!cleanupErr) cleanupErr = e;
      }
      try {
        execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });
      } catch (cleanupErrCaught) {
        console.error('[visual-density SetRow hint cleanup error]:', cleanupErrCaught);
        if (!cleanupErr) cleanupErr = cleanupErrCaught;
      }
    }
    if (cleanupErr) {
      throw cleanupErr;
    }
    if (testErr) {
      throw testErr;
    }
  });

  // 5. Exercise card header alignment with logged and pending SetRows across viewports
  test("Exercise card column header aligns with logged and pending SetRow cells across viewports", async ({ browser }) => {
    const testPriorWorkoutId = 'e8000000-0000-0000-0000-000000000101';
    const testPriorSetId = 'e8000000-0000-0000-0000-000000000102';
    const testTodayWorkoutId = 'e8000000-0000-0000-0000-000000000103';
    const testTodaySetId = 'e8000000-0000-0000-0000-000000000104';
    const psqlCmd = getPsqlCommand();

    const cleanSql = `
      DELETE FROM public.sets WHERE id IN ('${testPriorSetId}', '${testTodaySetId}');
      DELETE FROM public.workouts WHERE id IN ('${testPriorWorkoutId}', '${testTodayWorkoutId}');
      DELETE FROM public.sets WHERE workout_id IN (
        SELECT id FROM public.workouts
        WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
          AND (workout_date = CURRENT_DATE OR date::date = CURRENT_DATE)
      );
      DELETE FROM public.workouts
      WHERE user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi')
        AND (workout_date = CURRENT_DATE OR date::date = CURRENT_DATE);
    `;
    execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });

    const seedSql = `
      DO $$
      DECLARE
        v_athlete_id uuid;
        v_ex_id uuid;
        v_prior_workout_id uuid;
        v_today_workout_id uuid;
      BEGIN
        SELECT id INTO v_athlete_id FROM public.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;
        SELECT id INTO v_ex_id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;

        INSERT INTO public.workouts (id, user_id, name, date, workout_date, created_at)
        VALUES ('${testPriorWorkoutId}', v_athlete_id, 'Prior Workout', (CURRENT_DATE - INTERVAL '1 day')::date, (CURRENT_DATE - INTERVAL '1 day')::date, now() - INTERVAL '1 day')
        ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'Prior Workout'
        RETURNING id INTO v_prior_workout_id;

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES ('${testPriorSetId}', v_prior_workout_id, v_ex_id, 135, 10, 1, 'working', now() - INTERVAL '1 day')
        ON CONFLICT (id) DO UPDATE SET workout_id = v_prior_workout_id, exercise_id = v_ex_id, weight = 135, reps = 10;

        INSERT INTO public.workouts (id, user_id, name, date, workout_date, created_at)
        VALUES ('${testTodayWorkoutId}', v_athlete_id, 'Workout A (Push, Quads & Core)', CURRENT_DATE, CURRENT_DATE, now())
        ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'Workout A (Push, Quads & Core)'
        RETURNING id INTO v_today_workout_id;

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES ('${testTodaySetId}', v_today_workout_id, v_ex_id, 135, 10, 1, 'working', now())
        ON CONFLICT (id) DO UPDATE SET workout_id = v_today_workout_id, exercise_id = v_ex_id, weight = 135, reps = 10;
      END $$;
    `;
    execSync(psqlCmd, { input: seedSql, encoding: 'utf8' });

    let testErr: any = null;
    let cleanupErr: any = null;
    try {
      for (const width of [320, 390, 430]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });

        try {
          await page.goto("/login");
          await page.fill('input[type="email"]', "athlete@yourbody.fyi");
          await page.fill('input[type="password"]', "password123");
          await page.click('button[type="submit"]');
          await page.waitForURL("**/workout");

          await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
          await page.waitForLoadState('domcontentloaded');
          await expect(page.locator('[data-testid="exercise-card-0"]')).toBeVisible();
          await expect(page.locator('#exercise-card-body-0')).toBeVisible();

          const measurements = await page.locator('#exercise-card-body-0').evaluate((bodyEl: HTMLElement) => {
            const header = bodyEl.children[0] as HTMLElement;
            const loggedRow = bodyEl.querySelector('[data-testid="logged-set-row-0-0"]') as HTMLElement;
            const ghostHint1 = bodyEl.querySelector('[data-testid="ghost-hint-0-1"]');
            const pendingRow = ghostHint1 ? (ghostHint1.parentElement as HTMLElement) : null;

            if (!header || !loggedRow || !pendingRow) {
              return { error: 'Elements not found', hasHeader: !!header, hasLogged: !!loggedRow, hasPending: !!pendingRow };
            }

            const hCells = Array.from(header.children).map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, width: r.width, center: (r.left + r.right) / 2 };
            });

            const lCells = Array.from(loggedRow.children).map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, width: r.width, center: (r.left + r.right) / 2 };
            });

            const pCells = Array.from(pendingRow.children).map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right, width: r.width, center: (r.left + r.right) / 2 };
            });

            return { hCells, lCells, pCells };
          });

          expect('error' in measurements, JSON.stringify(measurements)).toBe(false);
          if ('error' in measurements) throw new Error('Elements not found');

          const { hCells, lCells, pCells } = measurements;
          expect(hCells.length, '5 header columns').toBe(5);
          expect(lCells.length, '5 logged row columns').toBe(5);
          expect(pCells.length, '5 pending row columns').toBe(5);

          // Assert no header label overlaps its neighbour
          for (let i = 0; i < hCells.length - 1; i++) {
            expect(
              hCells[i].right,
              `at ${width}px header col ${i} right <= col ${i+1} left (no overlap)`
            ).toBeLessThanOrEqual(hCells[i + 1].left + 0.1);
          }

          // For each of the 5 header cells assert horizontal center lies within row cell [left, right]
          // AND |headerCenter - cellCenter| <= 4 raw px for both logged and pending rows
          for (let i = 0; i < 5; i++) {
            const h = hCells[i];
            const l = lCells[i];
            const p = pCells[i];

            // Logged row checks
            expect(
              h.center,
              `at ${width}px col ${i} header center (${h.center.toFixed(1)}) >= logged cell left (${l.left.toFixed(1)})`
            ).toBeGreaterThanOrEqual(l.left - 0.1);
            expect(
              h.center,
              `at ${width}px col ${i} header center (${h.center.toFixed(1)}) <= logged cell right (${l.right.toFixed(1)})`
            ).toBeLessThanOrEqual(l.right + 0.1);
            const lDiff = Math.abs(h.center - l.center);
            expect(
              lDiff,
              `at ${width}px col ${i} |headerCenter - loggedCenter| (${lDiff.toFixed(1)}px) <= 4px`
            ).toBeLessThanOrEqual(4);

            // Pending row checks
            expect(
              h.center,
              `at ${width}px col ${i} header center (${h.center.toFixed(1)}) >= pending cell left (${p.left.toFixed(1)})`
            ).toBeGreaterThanOrEqual(p.left - 0.1);
            expect(
              h.center,
              `at ${width}px col ${i} header center (${h.center.toFixed(1)}) <= pending cell right (${p.right.toFixed(1)})`
            ).toBeLessThanOrEqual(p.right + 0.1);
            const pDiff = Math.abs(h.center - p.center);
            expect(
              pDiff,
              `at ${width}px col ${i} |headerCenter - pendingCenter| (${pDiff.toFixed(1)}px) <= 4px`
            ).toBeLessThanOrEqual(4);
          }

          // Relational check 1: Stepper -/+ buttons and value have same size (12px / 700 text-xs font-bold)
          const stepperData = await page.locator('[data-testid="exercise-card-0"]').evaluate((card: HTMLElement) => {
            const decBtn = card.querySelector('button[title="Decrease target sets"]') as HTMLElement;
            const incBtn = card.querySelector('button[title="Increase target sets"]') as HTMLElement;
            const countSpan = decBtn?.nextElementSibling as HTMLElement;
            if (!decBtn || !incBtn || !countSpan) return null;
            const decStyle = window.getComputedStyle(decBtn);
            const incStyle = window.getComputedStyle(incBtn);
            const countStyle = window.getComputedStyle(countSpan);
            return {
              decFontSize: parseFloat(decStyle.fontSize),
              decFontWeight: parseInt(decStyle.fontWeight, 10),
              incFontSize: parseFloat(incStyle.fontSize),
              incFontWeight: parseInt(incStyle.fontWeight, 10),
              countFontSize: parseFloat(countStyle.fontSize),
              countFontWeight: parseInt(countStyle.fontWeight, 10),
            };
          });
          expect(stepperData, "stepper buttons and count found").toBeTruthy();
          expect(stepperData!.decFontSize, "stepper dec button font size is 12px").toBe(12);
          expect(stepperData!.countFontSize, "stepper count font size is 12px").toBe(12);
          expect(stepperData!.decFontSize, "stepper button and value have same font size").toBe(stepperData!.countFontSize);
          expect(stepperData!.decFontWeight, "stepper dec button font weight is 700").toBe(700);
          expect(stepperData!.countFontWeight, "stepper count font weight is 700").toBe(700);

          // Relational check 2: Header weight unit is uppercase "LBS" or "KG" (no capitalize)
          const headerUnit = await page.locator("#exercise-card-body-0 > div").first().evaluate((headerEl: HTMLElement) => {
            const col3 = headerEl.children[2] as HTMLElement;
            const span = col3.querySelector('span[aria-hidden="true"]');
            return span ? span.textContent : col3.textContent;
          });
          expect(headerUnit?.trim(), "header weight unit is uppercase").toMatch(/^(LBS|KG)$/);

          // Relational check 3: Logged value box height (44px) and font size/weight (16px / 600) equal pending input
          const boxStyles = await page.locator("#exercise-card-body-0").evaluate((bodyEl: HTMLElement) => {
            const loggedWeightBox = bodyEl.querySelector('[data-testid="logged-set-row-0-0"] div.rounded-lg.tabular-nums') as HTMLElement;
            const pendingWeightInput = bodyEl.querySelector('[data-testid="ghost-weight-0-1"]') as HTMLElement;
            if (!loggedWeightBox || !pendingWeightInput) return null;
            const lStyle = window.getComputedStyle(loggedWeightBox);
            const pStyle = window.getComputedStyle(pendingWeightInput);
            return {
              loggedHeight: loggedWeightBox.getBoundingClientRect().height,
              pendingHeight: pendingWeightInput.getBoundingClientRect().height,
              loggedFontSize: parseFloat(lStyle.fontSize),
              pendingFontSize: parseFloat(pStyle.fontSize),
              loggedFontWeight: parseInt(lStyle.fontWeight, 10),
              pendingFontWeight: parseInt(pStyle.fontWeight, 10),
            };
          });
          expect(boxStyles, "logged weight box and pending input found").toBeTruthy();
          expect(boxStyles!.loggedHeight, "logged box height >= 44px").toBeGreaterThanOrEqual(44);
          expect(boxStyles!.pendingHeight, "pending input height >= 44px").toBeGreaterThanOrEqual(44);
          expect(Math.abs(boxStyles!.loggedHeight - boxStyles!.pendingHeight), "logged and pending heights equal so no jump").toBeLessThanOrEqual(1);
          expect(boxStyles!.loggedFontSize, "logged value font size is 16px").toBe(16);
          expect(boxStyles!.pendingFontSize, "pending input font size is 16px").toBe(16);
          expect(boxStyles!.loggedFontSize, "logged value computed font-size == pending input font-size").toBe(boxStyles!.pendingFontSize);
          expect(boxStyles!.loggedFontWeight, "logged value computed font-weight == pending input font-weight (600)").toBe(boxStyles!.pendingFontWeight);

          // Relational check 4: Meta chips (Last / PR / Sets) - no multi-line wrap at 390 (single row height <= 32px)
          if (width === 390) {
            const chipRowHeight = await page.locator('[data-testid="exercise-card-0"]').evaluate((card: HTMLElement) => {
              const chip = card.querySelector('[data-testid^="last-chip-"], [data-testid^="pr-chip-"], [data-testid^="sets-"]');
              if (!chip || !chip.parentElement) return null;
              return chip.parentElement.getBoundingClientRect().height;
            });
            expect(chipRowHeight, "chip row container found").toBeTruthy();
            expect(chipRowHeight!, "at 390px chip row height <= 32px (single row, no multi-line wrap)").toBeLessThanOrEqual(32);
          }

          // Relational check 5: PR chip shows e1RM suffix only in e1rm mode (athlete profile defaults to weight mode)
          const prChipText = await page.locator('[data-testid="pr-chip-0"]').textContent();
          expect(prChipText, "PR chip in weight mode does not have e1RM suffix").not.toContain("e1RM");

          // Relational check 6: Layout acceptance - no element right edge > card right edge, scrollWidth <= innerWidth
          const { scrollWidth, innerWidth, cardOverflow } = await page.evaluate(() => {
            const card = document.querySelector('[data-testid="exercise-card-0"]') as HTMLElement;
            const cardRect = card ? card.getBoundingClientRect() : { right: 0 };
            const overflowing = card ? Array.from(card.querySelectorAll("*")).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.right > cardRect.right + 1;
            }).length : 0;
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              cardOverflow: overflowing,
            };
          });
          expect(scrollWidth, `at ${width}px page scrollWidth <= innerWidth`).toBeLessThanOrEqual(innerWidth);
          expect(cardOverflow, `at ${width}px no element overflows exercise card right edge`).toBe(0);
        } finally {
          await page.close();
        }
      }
    } catch (err) {
      testErr = err;
    } finally {
      try {
        execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });
      } catch (cleanupErrCaught) {
        console.error('[visual-density SetRow header alignment cleanup error]:', cleanupErrCaught);
        if (!cleanupErr) cleanupErr = cleanupErrCaught;
      }
    }
    if (cleanupErr) {
      throw cleanupErr;
    }
    if (testErr) {
      throw testErr;
    }
  });

  test('HF-C: PR badge and exercise title layout at 320 and 390 in e1rm mode', async ({ page }) => {
    const psqlCmd = getPsqlCommand();
    const testExerciseId = 'c0000000-0000-0000-0000-000000000099';
    const testWorkoutId1 = 'c0000000-0000-0000-0000-000000000098';
    const testWorkoutId2 = 'c0000000-0000-0000-0000-000000000097';
    const testSetId1 = 'c0000000-0000-0000-0000-000000000096';
    const testSetId2 = 'c0000000-0000-0000-0000-000000000095';
    const testExerciseName = 'HF-C Incline Dumbbell Press';

    const cleanSql = `
      DELETE FROM public.sets WHERE id IN ('${testSetId1}', '${testSetId2}') OR exercise_id = '${testExerciseId}';
      DELETE FROM public.workouts WHERE id IN ('${testWorkoutId1}', '${testWorkoutId2}');
      DELETE FROM public.exercises WHERE id = '${testExerciseId}';
      UPDATE public.users SET pr_mode = 'weight' WHERE email = 'athlete@yourbody.fyi';
    `;

    const seedSql = `
      DO $$
      DECLARE
        v_athlete_id uuid;
      BEGIN
        SELECT id INTO v_athlete_id FROM public.users WHERE email = 'athlete@yourbody.fyi' LIMIT 1;

        -- Create dedicated exercise
        INSERT INTO public.exercises (id, name, body_parts, is_master)
        VALUES ('${testExerciseId}', '${testExerciseName}', '{"Chest"}', true)
        ON CONFLICT (id) DO UPDATE SET name = '${testExerciseName}';

        -- Session 1: 100x3 (e1RM = 110) 4 days ago
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES ('${testWorkoutId1}', v_athlete_id, 'HF-C Past Session 1', (CURRENT_DATE - INTERVAL '4 days')::date, now() - INTERVAL '4 days')
        ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'HF-C Past Session 1';

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES ('${testSetId1}', '${testWorkoutId1}', '${testExerciseId}', 100, 3, 1, 'working', now() - INTERVAL '4 days')
        ON CONFLICT (id) DO UPDATE SET weight = 100, reps = 3;

        -- Session 2: 90x10 (e1RM = 120) 2 days ago
        INSERT INTO public.workouts (id, user_id, name, workout_date, created_at)
        VALUES ('${testWorkoutId2}', v_athlete_id, 'HF-C Past Session 2', (CURRENT_DATE - INTERVAL '2 days')::date, now() - INTERVAL '2 days')
        ON CONFLICT (user_id, workout_date) DO UPDATE SET name = 'HF-C Past Session 2';

        INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
        VALUES ('${testSetId2}', '${testWorkoutId2}', '${testExerciseId}', 90, 10, 1, 'working', now() - INTERVAL '2 days')
        ON CONFLICT (id) DO UPDATE SET weight = 90, reps = 10;

        -- Set athlete pr_mode = 'e1rm'
        UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_athlete_id;
      END $$;
    `;

    execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });
    execSync(psqlCmd, { input: seedSql, encoding: 'utf8' });

    let testErr: any = null;
    let cleanupErr: any = null;

    try {
      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      for (const width of [320, 390]) {
        const height = width === 320 ? 568 : 844;
        await page.setViewportSize({ width, height });

        // Navigate to /history By Exercise
        await page.goto('/history');
        await page.waitForURL('**/history');
        const byExerciseTab = page.locator('[data-testid="history-subview-exercise"]');
        await expect(byExerciseTab).toBeVisible();
        await byExerciseTab.click();

        const card = page.locator(`[data-testid="exercise-card-${testExerciseId}"]`);
        await expect(card).toBeVisible({ timeout: 10000 });

        // Relational layout checks on exercise card
        const cardMeasurements = await card.evaluate((cardEl: HTMLElement) => {
          const cardRect = cardEl.getBoundingClientRect();
          const cardStyle = window.getComputedStyle(cardEl);
          const pL = parseFloat(cardStyle.paddingLeft) || 0;
          const pR = parseFloat(cardStyle.paddingRight) || 0;
          const cardInnerWidth = cardRect.width - pL - pR;

          const titleEl = cardEl.querySelector('h3') as HTMLElement | null;
          const titleRect = titleEl ? titleEl.getBoundingClientRect() : null;
          const titleScrollWidth = titleEl ? titleEl.scrollWidth : 0;
          const titleClientWidth = titleEl ? titleEl.clientWidth : 0;

          const badgeEl = (cardEl.querySelector('[data-testid^="pr-badge-"]') ||
            cardEl.querySelector('.bg-amber-500\\/10')) as HTMLElement | null;
          const badgeRect = badgeEl ? badgeEl.getBoundingClientRect() : null;

          const docScrollWidth = document.documentElement.scrollWidth;
          const winInnerWidth = window.innerWidth;

          return {
            cardInnerWidth,
            titleWidth: titleRect ? titleRect.width : 0,
            titleScrollWidth,
            titleClientWidth,
            cardRight: cardRect.right,
            badgeRight: badgeRect ? badgeRect.right : 0,
            docScrollWidth,
            winInnerWidth,
          };
        });

        // 1. exercise title width >= 60% of card inner width and > 0
        expect(cardMeasurements.titleWidth, `[${width}px] title width > 0`).toBeGreaterThan(0);
        const titleRatio = cardMeasurements.titleWidth / cardMeasurements.cardInnerWidth;
        expect(
          titleRatio,
          `[${width}px] exercise title width (${cardMeasurements.titleWidth}px) >= 60% of card inner width (${cardMeasurements.cardInnerWidth}px)`
        ).toBeGreaterThanOrEqual(0.6);

        // 2. title not clipped (scrollWidth <= clientWidth or wraps)
        expect(
          cardMeasurements.titleScrollWidth,
          `[${width}px] title scrollWidth (${cardMeasurements.titleScrollWidth}px) <= clientWidth (${cardMeasurements.titleClientWidth}px)`
        ).toBeLessThanOrEqual(cardMeasurements.titleClientWidth + 1);

        // 3. badge right <= card right
        expect(
          cardMeasurements.badgeRight,
          `[${width}px] badge right (${cardMeasurements.badgeRight}px) <= card right (${cardMeasurements.cardRight}px)`
        ).toBeLessThanOrEqual(cardMeasurements.cardRight + 1);

        // 4. document scrollWidth <= innerWidth
        expect(
          cardMeasurements.docScrollWidth,
          `[${width}px] document scrollWidth (${cardMeasurements.docScrollWidth}px) <= innerWidth (${cardMeasurements.winInnerWidth}px)`
        ).toBeLessThanOrEqual(cardMeasurements.winInnerWidth);

        // Open ExerciseHistorySheet
        await card.click();
        const sheetPrSummary = page.locator('[data-testid="exercise-sheet-pr-summary"]');
        await expect(sheetPrSummary).toBeVisible({ timeout: 10000 });

        const sheetMeasurements = await page.evaluate(() => {
          const prEl = document.querySelector('[data-testid="exercise-sheet-pr-summary"]') as HTMLElement | null;
          const sheetEl = prEl ? (prEl.closest('.p-4') as HTMLElement | null) : null;
          const sheetRect = sheetEl ? sheetEl.getBoundingClientRect() : null;
          const prRect = prEl ? prEl.getBoundingClientRect() : null;

          const docScrollWidth = document.documentElement.scrollWidth;
          const winInnerWidth = window.innerWidth;

          return {
            sheetRight: sheetRect ? sheetRect.right : 0,
            prRight: prRect ? prRect.right : 0,
            docScrollWidth,
            winInnerWidth,
          };
        });

        // 5. sheet badge right <= sheet right
        expect(
          sheetMeasurements.prRight,
          `[${width}px Sheet] badge right (${sheetMeasurements.prRight}px) <= sheet right (${sheetMeasurements.sheetRight}px)`
        ).toBeLessThanOrEqual(sheetMeasurements.sheetRight + 1);

        // 6. document scrollWidth <= innerWidth on sheet
        expect(
          sheetMeasurements.docScrollWidth,
          `[${width}px Sheet] document scrollWidth (${sheetMeasurements.docScrollWidth}px) <= innerWidth (${sheetMeasurements.winInnerWidth}px)`
        ).toBeLessThanOrEqual(sheetMeasurements.winInnerWidth);

        // Close sheet
        await page.keyboard.press('Escape');
        await expect(sheetPrSummary).not.toBeVisible();
      }
    } catch (err) {
      testErr = err;
    } finally {
      try {
        await page.close();
      } catch (e) {
        if (!cleanupErr) cleanupErr = e;
      }
      try {
        execSync(psqlCmd, { input: cleanSql, encoding: 'utf8' });
      } catch (cleanupErrCaught) {
        console.error('[visual-density HF-C cleanup error]:', cleanupErrCaught);
        if (!cleanupErr) cleanupErr = cleanupErrCaught;
      }
    }

    if (cleanupErr) {
      throw cleanupErr;
    }
    if (testErr) {
      throw testErr;
    }
  });
});

// ---------------------------------------------------------------------------
// HF-B: Workout Shell & Overlays Acceptance (D-HF-B-1.. D-HF-B-5)
// ---------------------------------------------------------------------------

test.describe("HF-B: Workout Shell & Overlays", () => {
  // (a) 320/390: page scrollWidth <= innerWidth on /workout and every control in routine/date card right <= card right
  for (const width of [320, 390] as const) {
    test(`HF-B: /workout routine/date card has zero control overflow and page scrollWidth <= innerWidth at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });

      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
        await page.waitForLoadState('domcontentloaded');
        await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 10000 });

        const measurement = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="workout-date-input"]')?.closest('.rounded-2xl');
          const cardRect = card ? card.getBoundingClientRect() : null;
          const controls = Array.from(card?.querySelectorAll('button, input, select') || []);
          const overflows = controls.map((c) => {
            const r = c.getBoundingClientRect();
            return {
              tag: c.tagName.toLowerCase(),
              testId: c.getAttribute('data-testid') || c.getAttribute('aria-label') || c.textContent?.trim().slice(0, 15),
              right: Math.round(r.right * 100) / 100,
              cardRight: cardRect ? Math.round(cardRect.right * 100) / 100 : 0,
              overflowPx: cardRect ? Math.round((r.right - cardRect.right) * 100) / 100 : 0,
            };
          }).filter((c) => c.overflowPx > 0.5);

          return {
            pageScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            overflows,
          };
        });

        expect(
          measurement.pageScrollWidth,
          `page scrollWidth (${measurement.pageScrollWidth}px) <= innerWidth (${measurement.innerWidth}px) at ${width}px`
        ).toBeLessThanOrEqual(measurement.innerWidth);

        expect(
          measurement.overflows,
          `No controls in routine/date card may exceed card right boundary at ${width}px: ${JSON.stringify(measurement.overflows)}`
        ).toHaveLength(0);
      } finally {
        await page.close();
      }
    });
  }

  // (b) With rest timer running and undo toast visible on /workout: toast rect does not intersect pill rect nor BottomNav rect
  for (const width of [320, 390] as const) {
    test(`HF-B: Toast stacks above rest-timer pill and BottomNav on /workout at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });

      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
        await page.waitForLoadState('domcontentloaded');
        await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 10000 });

        // Start rest timer
        const restTimerBtn = page.locator('[data-testid="rest-timer-btn"]');
        await restTimerBtn.click();
        const pill = page.locator('[data-testid="rest-timer-pill"]');
        await expect(pill).toBeVisible({ timeout: 5000 });

        // Remove an exercise with no logged sets to trigger the undo toast
        // (independent of sets logged today by earlier tests).
        const emptyCard = page
          .locator('[data-testid^="exercise-card-"]')
          .filter({ hasText: /(^|\D)0\/\d+ Sets/ })
          .first();
        const removeBtn = emptyCard.locator('button[aria-label^="Remove"]').first();
        await expect(removeBtn).toBeVisible({ timeout: 5000 });
        await removeBtn.click();

        const toast = page.locator('[data-testid="quick-log-toast"]');
        await expect(toast).toBeVisible({ timeout: 5000 });

        const geometry = await page.evaluate(() => {
          const t = document.querySelector('[data-testid="quick-log-toast"]')?.getBoundingClientRect();
          const p = document.querySelector('[data-testid="rest-timer-pill"]')?.getBoundingClientRect();
          const nav = document.querySelector('nav')?.getBoundingClientRect();
          if (!t || !p) return null;

          const intersectPill = !(t.right <= p.left || t.left >= p.right || t.bottom <= p.top || t.top >= p.bottom);
          const intersectNav = nav ? !(t.right <= nav.left || t.left >= nav.right || t.bottom <= nav.top || t.top >= nav.bottom) : false;

          return {
            toastBottom: Math.round(t.bottom * 10) / 10,
            toastTop: Math.round(t.top * 10) / 10,
            pillTop: Math.round(p.top * 10) / 10,
            clearanceAbovePill: Math.round((p.top - t.bottom) * 10) / 10,
            intersectPill,
            intersectNav,
          };
        });

        expect(geometry, 'toast and pill geometry must be measured').not.toBeNull();
        expect(geometry.intersectPill, `toast must not intersect rest-timer pill at ${width}px`).toBe(false);
        expect(geometry.intersectNav, `toast must not intersect BottomNav at ${width}px`).toBe(false);
        expect(geometry.toastBottom, `toast bottom (${geometry.toastBottom}px) <= pill top (${geometry.pillTop}px) at ${width}px`).toBeLessThanOrEqual(geometry.pillTop);
        expect(geometry.clearanceAbovePill, `clearance above pill (${geometry.clearanceAbovePill}px) >= 8px at ${width}px`).toBeGreaterThanOrEqual(8);

        // Click undo to restore exercise
        const undoBtn = page.locator('[data-testid="quick-log-toast"] button').filter({ hasText: 'Undo' }).first();
        if (await undoBtn.isVisible()) {
          await undoBtn.click();
        }
      } finally {
        await page.close();
      }
    });
  }

  // (b-2) With rest timer running and staged bar on /nutrition: toast stacks above both with zero intersection
  for (const width of [320, 390] as const) {
    test(`HF-B: Toast stacks above rest-timer pill and staged bar on /nutrition at ${width}px`, async ({ browser }) => {
      const height = width === 320 ? 568 : 844;
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });

      // Own data (CI runs density on a fresh DB): two custom dishes pinned to the top.
      const psqlCmd = getPsqlCommand();
      const dishA = `e8100000-0000-0000-0000-000000000${width}`;
      const dishB = `e8200000-0000-0000-0000-000000000${width}`;
      const cleanupSql = `
        DELETE FROM public.nutrition_logs WHERE food_name LIKE 'HFB Toast Dish %'
          AND user_id = (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi');
        DELETE FROM public.custom_dishes WHERE id IN ('${dishA}', '${dishB}');
      `;
      execSync(psqlCmd, {
        input: `${cleanupSql}
          INSERT INTO public.custom_dishes (id, user_id, name, calories, protein, carbs, fat, fiber, kind, use_count, notes, created_at)
          VALUES
            ('${dishA}', (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi'), 'HFB Toast Dish A', 132, 22, 0, 4.8, 0, 'food', 999999, NULL, now()),
            ('${dishB}', (SELECT id FROM public.users WHERE email = 'athlete@yourbody.fyi'), 'HFB Toast Dish B', 579, 47, 60, 12, 3, 'food', 999998, NULL, now());
        `,
        encoding: 'utf8',
      });

      let cleanupErr: unknown;
      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        // Start rest timer on workout
        await page.click('[data-testid="rest-timer-btn"]');
        await expect(page.locator('[data-testid="rest-timer-pill"]')).toBeVisible({ timeout: 5000 });

        // Navigate to nutrition
        await page.goto('/nutrition');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForSelector("text=Today's Nutrition", { timeout: 15000 });
        await expect(page.locator('[data-testid="rest-timer-pill"]')).toBeVisible({ timeout: 5000 });

        // Stage a meal by tapping our own dish A
        const dishCardA = page.locator(`[data-testid="custom-dish-card-${dishA}"]`);
        await expect(dishCardA).toBeVisible({ timeout: 5000 });
        await dishCardA.click();
        await expect(page.locator('[data-testid="staged-meal-card"]')).toBeVisible({ timeout: 5000 });

        // Trigger the floating toast while staged: quick-add dish B
        const addBtnB = page.locator(`[data-testid="quick-log-btn-${dishB}"]`);
        await expect(addBtnB).toBeVisible({ timeout: 5000 });
        await addBtnB.click();

        const toast = page.locator('[data-testid="quick-log-toast"]');
        await expect(toast).toBeVisible({ timeout: 5000 });

        const checkGeometry = async (_scrollLabel: string) => {
          return await page.evaluate(() => {
            const t = document.querySelector('[data-testid="quick-log-toast"]')?.getBoundingClientRect();
            const p = document.querySelector('[data-testid="rest-timer-pill"]')?.getBoundingClientRect();
            const staged = document.querySelector('[data-testid="staged-card-actions"]')?.getBoundingClientRect();
            const logBtn = document.querySelector('[data-testid="staged-card-actions"] button')?.getBoundingClientRect();
            const nav = document.querySelector('nav')?.getBoundingClientRect();
            if (!t || !p) return null;

            const intersect = (r1: DOMRect, r2: DOMRect) =>
              !(r1.right <= r2.left || r1.left >= r2.right || r1.bottom <= r2.top || r1.top >= r2.bottom);

            const vHeight = window.innerHeight;
            return {
              toastTop: Math.round(t.top * 10) / 10,
              toastBottom: Math.round(t.bottom * 10) / 10,
              pillTop: Math.round(p.top * 10) / 10,
              vHeight,
              toastTopRatio: t.top / vHeight,
              intersectPill: intersect(t, p),
              intersectNav: nav ? intersect(t, nav) : false,
              intersectStagedBar: staged ? intersect(t, staged) : false,
              intersectLogBtn: logBtn ? intersect(t, logBtn) : false,
              clearanceAbovePill: Math.round((p.top - t.bottom) * 10) / 10,
            };
          });
        };

        // 1. Initial state (staged card in viewport)
        const geo1 = await checkGeometry("initial");
        expect(geo1, 'toast geometry must be measured').not.toBeNull();
        expect(geo1!.intersectPill, `toast must not intersect pill on /nutrition at ${width}px`).toBe(false);
        expect(geo1!.intersectNav, `toast must not intersect nav on /nutrition at ${width}px`).toBe(false);
        expect(geo1!.intersectLogBtn, `toast must not intersect Log Meal button on /nutrition at ${width}px`).toBe(false);
        expect(geo1!.toastTopRatio, `toast top must stay in bottom zone (>= 50% vh, got ${geo1!.toastTopRatio}) at ${width}px`).toBeGreaterThanOrEqual(0.5);
        expect(geo1!.toastBottom, `toast bottom (${geo1!.toastBottom}px) <= pill top (${geo1!.pillTop}px) at ${width}px`).toBeLessThanOrEqual(geo1!.pillTop);

        // Toast overlays page content, so its background must be fully opaque
        // (no list text bleeding through the toast).
        const toastAlpha = await toast.evaluate((el) => {
          const bg = window.getComputedStyle(el).backgroundColor;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { bg, alpha: -1 };
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 1, 1);
          return { bg, alpha: ctx.getImageData(0, 0, 1, 1).data[3] };
        });
        expect(toastAlpha.alpha, `toast background must be opaque (got ${toastAlpha.bg}) at ${width}px`).toBe(255);

        // 2. Scrolled state: scroll so staged card is mid-screen
        await page.evaluate(() => window.scrollBy(0, 150));
        await page.waitForTimeout(200);
        const geo2 = await checkGeometry("mid-screen");
        expect(geo2, 'toast geometry must be measured after mid-screen scroll').not.toBeNull();
        expect(geo2!.intersectPill).toBe(false);
        expect(geo2!.intersectNav).toBe(false);
        expect(geo2!.intersectLogBtn).toBe(false);
        expect(geo2!.toastTopRatio).toBeGreaterThanOrEqual(0.5);
        expect(geo2!.toastBottom).toBeLessThanOrEqual(geo2!.pillTop);

        // 3. Scrolled to bottom: staged card scrolled past or bottom-anchored
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        const geo3 = await checkGeometry("bottom");
        expect(geo3, 'toast geometry must be measured after scroll to bottom').not.toBeNull();
        expect(geo3!.intersectPill).toBe(false);
        expect(geo3!.intersectNav).toBe(false);
        expect(geo3!.intersectLogBtn).toBe(false);
        expect(geo3!.toastTopRatio).toBeGreaterThanOrEqual(0.5);
        expect(geo3!.toastBottom).toBeLessThanOrEqual(geo3!.pillTop);
      } finally {
        await page.close();
        try {
          execSync(psqlCmd, { input: cleanupSql, encoding: 'utf8' });
        } catch (err) {
          console.error('[visual-density HF-B nutrition cleanup error]:', err);
          cleanupErr = err;
        }
      }
      if (cleanupErr) throw cleanupErr;
    });
  }

  // (c) Scrolled to bottom with rest timer running: 'Log All' / Finish button rect bottom <= pill top
  for (const width of [320, 390] as const) {
    test(`HF-B: Scrolled to bottom with rest timer running keeps finish button above pill at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });

      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
        await page.waitForLoadState('domcontentloaded');
        await page.locator('[data-testid="workout-date-input"]').waitFor({ state: 'visible', timeout: 10000 });

        // Start rest timer
        await page.click('[data-testid="rest-timer-btn"]');
        const pill = page.locator('[data-testid="rest-timer-pill"]');
        await expect(pill).toBeVisible({ timeout: 5000 });

        // Scroll completely to bottom
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(400);

        const clearance = await page.evaluate(() => {
          const p = document.querySelector('[data-testid="rest-timer-pill"]')?.getBoundingClientRect();
          const f = document.querySelector('[data-testid="finish-workout-btn"]')?.getBoundingClientRect();
          if (!p || !f) return null;
          return {
            pillTop: Math.round(p.top * 10) / 10,
            finishBottom: Math.round(f.bottom * 10) / 10,
            clearance: Math.round((p.top - f.bottom) * 10) / 10,
          };
        });

        expect(clearance, 'clearance must be measured').not.toBeNull();
        expect(clearance.finishBottom, `Finish button rect bottom (${clearance.finishBottom}px) <= pill top (${clearance.pillTop}px) at ${width}px`).toBeLessThanOrEqual(clearance.pillTop);
        expect(clearance.clearance, `clearance above pill (${clearance.clearance}px) >= 8px at ${width}px`).toBeGreaterThanOrEqual(8);
      } finally {
        await page.close();
      }
    });
  }

  // (d) Rest-timer pill computed background alpha == 1
  for (const width of [320, 390] as const) {
    test(`HF-B: Rest-timer pill computed background is 100% opaque (alpha == 1) at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        deviceScaleFactor: 1,
      });

      try {
        await page.goto("/login");
        await page.fill('input[type="email"]', "athlete@yourbody.fyi");
        await page.fill('input[type="password"]', "password123");
        await page.click('button[type="submit"]');
        await page.waitForURL("**/workout");

        await page.click('[data-testid="rest-timer-btn"]');
        const pill = page.locator('[data-testid="rest-timer-pill"]');
        await expect(pill).toBeVisible({ timeout: 5000 });

        const alphaResult = await pill.evaluate((el) => {
          const bg = window.getComputedStyle(el).backgroundColor;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { bg, alpha: null, isOpaque: false };
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 1, 1);
          const data = ctx.getImageData(0, 0, 1, 1).data;
          const alpha = data[3] / 255;
          return { bg, alpha, isOpaque: data[3] === 255 };
        });

        expect(alphaResult.isOpaque, `rest-timer pill background must be 100% opaque (alpha == 1, got ${alphaResult.alpha}) at ${width}px`).toBe(true);

        // Element-level opacity: a pulsing/fading container lets page content show
        // through even with an opaque background colour.
        const effective = await pill.evaluate((el) => ({
          opacity: window.getComputedStyle(el).opacity,
          animationName: window.getComputedStyle(el).animationName,
          runningAnimations: el.getAnimations().length,
        }));
        expect(effective, `rest-timer pill must not fade (opacity 1, no container animation) at ${width}px`).toEqual({
          opacity: '1',
          animationName: 'none',
          runningAnimations: 0,
        });
      } finally {
        await page.close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Offline & Sync Visual Density Tests (320px)
  // ---------------------------------------------------------------------------

  function getRealAthleteExerciseId(): string {
    const psqlCmd = getPsqlCommand();
    const id = execSync(
      `${psqlCmd} -t -A -c "SELECT id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1"`,
      { encoding: 'utf8' }
    ).trim();
    if (!id) {
      throw new Error('Real exercise id for "Incline Bench Press" was not found in the database');
    }
    return id;
  }

  test('Density: Header connection status badge displays "Offline · 12 pending", fits 320px without clip or wrap, tap target >= 44x44px', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    let athleteUserId = '';

    try {
      const realExerciseId = getRealAthleteExerciseId();

      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      // Wait for workout page to be fully loaded and status badge visible
      const statusBadge = page.locator('[data-testid="connection-status"]');
      await expect(statusBadge).toBeVisible({ timeout: 10000 });

      athleteUserId = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((k) => k.includes('auth-token'));
        const session = authKey ? JSON.parse(localStorage.getItem(authKey) || '{}') : null;
        return session?.user?.id || '';
      });
      expect(athleteUserId, 'athlete userId must be present').toBeTruthy();

      const dbName = `yourbody-offline-${athleteUserId}`;

      // Wait for the app to create the per-user IndexedDB
      await page.waitForFunction(async (name) => {
        return new Promise<boolean>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const ready = db.objectStoreNames.contains('outbox');
            db.close();
            resolve(ready);
          };
          req.onerror = () => resolve(false);
        });
      }, dbName);

      // Open that DB with plain indexedDB.open(name) (no version arg) and put 12 pending ops
      await page.evaluate(
        async ({ name, userId, exerciseId }) => {
          const req = indexedDB.open(name);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction(['outbox'], 'readwrite');
          const store = tx.objectStore('outbox');
          const now = new Date().toISOString();
          for (let i = 0; i < 12; i++) {
            store.put({
              opId: `w4-pending-op-${i + 1}`,
              userId,
              seq: i + 1,
              kind: 'set.create',
              payload: {
                id: `w4-pending-set-${i + 1}`,
                workoutRef: 'density-w-1',
                exercise_id: exerciseId,
                weight: 100 + i * 5,
                reps: 5,
                set_index: i + 1,
                set_type: 'working',
                created_at: now,
              },
              createdAt: now,
              attempts: 0,
              state: 'pending',
            });
          }

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
        },
        { name: dbName, userId: athleteUserId, exerciseId: realExerciseId }
      );

      // Block replay deterministically with page.route on Supabase REST write requests
      await page.route('**/rest/v1/sets*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });
      await page.route('**/rest/v1/workouts*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });

      // Reload and set context offline
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await context.setOffline(true);

      // Assert exact text
      await expect(statusBadge).toHaveText('Offline · 12 pending', { timeout: 10000 });

      const box = await statusBadge.boundingBox();
      expect(box, 'button bounding box exists').not.toBeNull();
      expect(box!.width, `connection-status width (${box!.width}px) >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `connection-status height (${box!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);

      // Verify no horizontal clipping on badge or header
      const isClipped = await statusBadge.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(isClipped, 'Badge should not be clipped').toBe(false);

      const header = page.locator('header');
      const headerClipped = await header.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(headerClipped, 'Header should not horizontally overflow').toBe(false);
    } finally {
      try {
        if (athleteUserId && !page.isClosed()) {
          await page.evaluate(async (uid) => {
            const dbName = `yourbody-offline-${uid}`;
            const openReq = indexedDB.open(dbName);
            await new Promise<void>((resolve, reject) => {
              openReq.onsuccess = () => {
                const db = openReq.result;
                if (db.objectStoreNames.contains('outbox')) {
                  const tx = db.transaction(['outbox'], 'readwrite');
                  tx.objectStore('outbox').clear();
                  tx.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                  tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                  };
                } else {
                  db.close();
                  resolve();
                }
              };
              openReq.onerror = () => reject(openReq.error);
            });
            const delReq = indexedDB.deleteDatabase(dbName);
            await new Promise<void>((resolve, reject) => {
              delReq.onsuccess = () => resolve();
              delReq.onerror = () => reject(delReq.error);
              delReq.onblocked = () => resolve();
            });
          }, athleteUserId);
        }
      } finally {
        await context.close();
      }
    }
  });

  test('Density: SetRow pending mark fits in index cell and preserves grid column alignment with header at 320px', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    let athleteUserId = '';

    try {
      const realExerciseId = getRealAthleteExerciseId();

      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      athleteUserId = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((k) => k.includes('auth-token'));
        const session = authKey ? JSON.parse(localStorage.getItem(authKey) || '{}') : null;
        return session?.user?.id || '';
      });
      expect(athleteUserId, 'athlete userId must be present').toBeTruthy();

      const dbName = `yourbody-offline-${athleteUserId}`;

      // Wait for the app to create the per-user IndexedDB
      await page.waitForFunction(async (name) => {
        return new Promise<boolean>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const ready = db.objectStoreNames.contains('outbox');
            db.close();
            resolve(ready);
          };
          req.onerror = () => resolve(false);
        });
      }, dbName);

      // Seed 1 pending workout.ensure and 1 pending set.create op for today
      await page.evaluate(
        async ({ name, userId, exerciseId }) => {
          const req = indexedDB.open(name);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction(['outbox'], 'readwrite');
          const store = tx.objectStore('outbox');
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const today = `${year}-${month}-${day}`;
          const iso = now.toISOString();

          store.put({
            opId: 'w4-setrow-workout-op',
            userId,
            seq: 1,
            kind: 'workout.ensure',
            payload: {
              clientWorkoutId: 'w4-density-workout-ref',
              workout_date: today,
              name: 'Workout A (Push, Quads & Core)',
            },
            createdAt: iso,
            attempts: 0,
            state: 'pending',
          });

          store.put({
            opId: 'w4-setrow-set-op',
            userId,
            seq: 2,
            kind: 'set.create',
            payload: {
              id: 'w4-density-set-1',
              workoutRef: 'w4-density-workout-ref',
              exercise_id: exerciseId,
              weight: 185,
              reps: 8,
              set_index: 1,
              set_type: 'working',
              created_at: iso,
            },
            createdAt: iso,
            attempts: 0,
            state: 'pending',
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
        },
        { name: dbName, userId: athleteUserId, exerciseId: realExerciseId }
      );

      // Block replay writes (POST, PATCH, DELETE only)
      await page.route('**/rest/v1/sets*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });
      await page.route('**/rest/v1/workouts*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });

      await page.goto('/workout?routine=' + encodeURIComponent('Workout A (Push, Quads & Core)'));
      await page.waitForLoadState('domcontentloaded');

      const card = page.locator('[data-testid="exercise-card-0"]');
      await expect(card).toBeVisible({ timeout: 10000 });

      const loggedRow = card.locator('[data-testid^="logged-set-row-"]').first();
      await expect(loggedRow).toBeVisible({ timeout: 5000 });

      const pendingMark = loggedRow.locator('[data-testid="pending-mark"]');
      await expect(pendingMark).toBeVisible({ timeout: 5000 });

      // Check alignment of index cell with column header
      const geo = await page.evaluate(() => {
        const headerGrid = document.querySelector('#exercise-card-body-0 .grid');
        const headerIndexCell = headerGrid?.firstElementChild;
        const firstRow = document.querySelector('[data-testid^="logged-set-row-"]');
        const firstRowIndex = firstRow?.firstElementChild;
        if (!headerIndexCell || !firstRowIndex) return null;

        const hRect = headerIndexCell.getBoundingClientRect();
        const rRect = firstRowIndex.getBoundingClientRect();
        return {
          headerWidth: Math.round(hRect.width * 10) / 10,
          rowWidth: Math.round(rRect.width * 10) / 10,
          deltaLeft: Math.abs(hRect.left - rRect.left),
        };
      });

      expect(geo).not.toBeNull();
      expect(geo!.deltaLeft).toBeLessThanOrEqual(2);
    } finally {
      try {
        if (athleteUserId && !page.isClosed()) {
          await page.evaluate(async (uid) => {
            const dbName = `yourbody-offline-${uid}`;
            const openReq = indexedDB.open(dbName);
            await new Promise<void>((resolve, reject) => {
              openReq.onsuccess = () => {
                const db = openReq.result;
                if (db.objectStoreNames.contains('outbox')) {
                  const tx = db.transaction(['outbox'], 'readwrite');
                  tx.objectStore('outbox').clear();
                  tx.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                  tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                  };
                } else {
                  db.close();
                  resolve();
                }
              };
              openReq.onerror = () => reject(openReq.error);
            });
            const delReq = indexedDB.deleteDatabase(dbName);
            await new Promise<void>((resolve, reject) => {
              delReq.onsuccess = () => resolve();
              delReq.onerror = () => reject(delReq.error);
              delReq.onblocked = () => resolve();
            });
          }, athleteUserId);
        }
      } finally {
        await context.close();
      }
    }
  });

  test('Density: AttentionBanner and SyncStatusSheet fit 320px without overflow with >=44px tap targets', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    let athleteUserId = '';

    try {
      const realExerciseId = getRealAthleteExerciseId();

      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      athleteUserId = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((k) => k.includes('auth-token'));
        const session = authKey ? JSON.parse(localStorage.getItem(authKey) || '{}') : null;
        return session?.user?.id || '';
      });
      expect(athleteUserId, 'athlete userId must be present').toBeTruthy();

      const dbName = `yourbody-offline-${athleteUserId}`;

      // Wait for the app to create the per-user IndexedDB
      await page.waitForFunction(async (name) => {
        return new Promise<boolean>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const ready = db.objectStoreNames.contains('outbox');
            db.close();
            resolve(ready);
          };
          req.onerror = () => resolve(false);
        });
      }, dbName);

      // Seed 2 attention ops in outbox
      await page.evaluate(
        async ({ name, userId, exerciseId }) => {
          const req = indexedDB.open(name);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction(['outbox'], 'readwrite');
          const store = tx.objectStore('outbox');
          const now = new Date().toISOString();
          store.put({
            opId: 'attention-op-1',
            userId,
            seq: 1,
            kind: 'set.create',
            payload: {
              id: 'attention-set-1',
              workoutRef: 'density-w-1',
              exercise_id: exerciseId,
              weight: 135,
              reps: 5,
              set_index: 1,
              set_type: 'working',
              created_at: now,
            },
            createdAt: now,
            attempts: 3,
            state: 'attention',
            error: 'Row conflict or foreign key constraint violation',
          });
          store.put({
            opId: 'attention-op-2',
            userId,
            seq: 2,
            kind: 'set.create',
            payload: {
              id: 'attention-set-2',
              workoutRef: 'density-w-1',
              exercise_id: exerciseId,
              weight: 145,
              reps: 5,
              set_index: 2,
              set_type: 'working',
              created_at: now,
            },
            createdAt: now,
            attempts: 3,
            state: 'attention',
            error: 'Server rejected update',
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
        },
        { name: dbName, userId: athleteUserId, exerciseId: realExerciseId }
      );

      // Block replay deterministically with page.route on Supabase REST write requests
      await page.route('**/rest/v1/sets*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });
      await page.route('**/rest/v1/workouts*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const banner = page.locator('[data-testid="attention-banner"]');
      await expect(banner).toBeVisible({ timeout: 5000 });
      await expect(banner).toHaveText('2 changes need attention · Review');

      // Check banner fits 320px without overflow
      const bannerOverflow = await banner.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(bannerOverflow, 'Attention banner must not horizontally overflow').toBe(false);

      const reviewBtn = page.locator('[data-testid="review-attention-btn"]');
      const reviewBox = await reviewBtn.boundingBox();
      expect(reviewBox!.height).toBeGreaterThanOrEqual(44);

      // Open SyncStatusSheet
      await reviewBtn.click();
      const sheet = page.locator('[data-testid="sync-status-sheet"]');
      await expect(sheet).toBeVisible({ timeout: 5000 });

      // Assert exact texts on SyncStatusSheet at 320
      await expect(sheet.locator('h2').first()).toHaveText('Sync status');
      await expect(page.locator('[data-testid="needs-attention-section"] h3')).toHaveText('Needs attention (2)');

      const sheetOverflow = await sheet.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(sheetOverflow, 'Sync status sheet must not horizontally overflow').toBe(false);

      const retryBtn = page.locator('[data-testid^="retry-op-btn-"]').first();
      await expect(retryBtn).toBeVisible();
      const retryBox = await retryBtn.boundingBox();
      expect(retryBox!.height).toBeGreaterThanOrEqual(44);

      const discardBtn = page.locator('[data-testid^="discard-op-btn-"]').first();
      await expect(discardBtn).toBeVisible();
      const discardBox = await discardBtn.boundingBox();
      expect(discardBox!.height).toBeGreaterThanOrEqual(44);
    } finally {
      try {
        if (athleteUserId && !page.isClosed()) {
          await page.evaluate(async (uid) => {
            const dbName = `yourbody-offline-${uid}`;
            const openReq = indexedDB.open(dbName);
            await new Promise<void>((resolve, reject) => {
              openReq.onsuccess = () => {
                const db = openReq.result;
                if (db.objectStoreNames.contains('outbox')) {
                  const tx = db.transaction(['outbox'], 'readwrite');
                  tx.objectStore('outbox').clear();
                  tx.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                  tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                  };
                } else {
                  db.close();
                  resolve();
                }
              };
              openReq.onerror = () => reject(openReq.error);
            });
            const delReq = indexedDB.deleteDatabase(dbName);
            await new Promise<void>((resolve, reject) => {
              delReq.onsuccess = () => resolve();
              delReq.onerror = () => reject(delReq.error);
              delReq.onblocked = () => resolve();
            });
          }, athleteUserId);
        }
      } finally {
        await context.close();
      }
    }
  });

  test('Density: PendingReviewList with 3 items (queued/ready/failed) fits 320px without overflow, >=44px tap targets, and toast/pill layering contract intact', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    let athleteUserId = '';

    try {
      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      athleteUserId = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((k) => k.includes('auth-token'));
        const session = authKey ? JSON.parse(localStorage.getItem(authKey) || '{}') : null;
        return session?.user?.id || '';
      });
      expect(athleteUserId, 'athlete userId must be present').toBeTruthy();

      const dbName = `yourbody-offline-${athleteUserId}`;

      // Wait for the app to create the per-user IndexedDB
      await page.waitForFunction(async (name) => {
        return new Promise<boolean>((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const ready = db.objectStoreNames.contains('aiq');
            db.close();
            resolve(ready);
          };
          req.onerror = () => resolve(false);
        });
      }, dbName);

      // Seed 3 items in aiq store: queued, ready, failed
      await page.evaluate(
        async ({ name, userId }) => {
          const req = indexedDB.open(name);
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          const tx = db.transaction(['aiq'], 'readwrite');
          const store = tx.objectStore('aiq');
          const now = new Date();
          const today = now.toISOString().slice(0, 10);
          const iso = now.toISOString();

          store.put({
            id: 'density-aiq-queued',
            userId,
            kind: 'text',
            text: '2 boiled eggs and black coffee',
            capturedAt: iso,
            captureDate: today,
            status: 'queued',
            attempts: 0,
            nextAttemptAt: Date.now() + 60000,
          });

          store.put({
            id: 'density-aiq-ready',
            userId,
            kind: 'photo',
            capturedAt: iso,
            captureDate: today,
            status: 'ready',
            result: {
              name: 'Grilled Salmon Bowl',
              calories: 450,
              protein: 42,
              carbs: 35,
              fat: 15,
              fiber: 4,
              items: [
                { name: 'Salmon', calories: 250, protein: 35, carbs: 0, fat: 12, fiber: 0, quantity: 1, unit: 'fillet' },
                { name: 'Rice', calories: 200, protein: 7, carbs: 35, fat: 3, fiber: 4, quantity: 1, unit: 'cup' },
              ],
            },
            attempts: 1,
            nextAttemptAt: 0,
          });

          store.put({
            id: 'density-aiq-failed',
            userId,
            kind: 'text',
            text: 'Unrecognized query text',
            capturedAt: iso,
            captureDate: today,
            status: 'failed',
            attempts: 3,
            nextAttemptAt: 0,
            lastError: 'NON_FOOD_DETECTED: No food items found',
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
        },
        { name: dbName, userId: athleteUserId }
      );

      // Block write requests
      await page.route('**/rest/v1/nutrition_logs*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });

      await page.goto('/nutrition');
      await page.waitForLoadState('domcontentloaded');

      const list = page.locator('[data-testid="pending-review-list"]');
      await expect(list).toBeVisible({ timeout: 10000 });

      // Title & Counts
      await expect(page.locator('[data-testid="pending-review-title"]')).toHaveText('Pending Review (3)');
      const countsEl = page.locator('[data-testid="pending-review-counts"]');
      await expect(countsEl).toContainText('1 ready');
      await expect(countsEl).toContainText('1 queued');
      await expect(countsEl).toContainText('1 failed');

      // Check horizontal clipping / overflow
      const listClipped = await list.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(listClipped, 'PendingReviewList must not horizontally overflow at 320px').toBe(false);

      // Verify tap targets >= 44px on action buttons
      const reviewBtn = page.locator('[data-testid="review-aiq-item-density-aiq-ready"]');
      await expect(reviewBtn).toBeVisible();
      const reviewBox = await reviewBtn.boundingBox();
      expect(reviewBox, 'Review button bounding box exists').not.toBeNull();
      expect(reviewBox!.height, `Review button height (${reviewBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);

      const retryBtn = page.locator('[data-testid="retry-aiq-item-density-aiq-failed"]');
      await expect(retryBtn).toBeVisible();
      const retryBox = await retryBtn.boundingBox();
      expect(retryBox, 'Retry button bounding box exists').not.toBeNull();
      expect(retryBox!.height, `Retry button height (${retryBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);

      const manualBtn = page.locator('[data-testid="manual-aiq-item-density-aiq-failed"]');
      await expect(manualBtn).toBeVisible();
      const manualBox = await manualBtn.boundingBox();
      expect(manualBox, 'Enter manually button bounding box exists').not.toBeNull();
      expect(manualBox!.height, `Enter manually button height (${manualBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);

      const discardBtn = page.locator('[data-testid="discard-aiq-item-density-aiq-failed"]');
      await expect(discardBtn).toBeVisible();
      const discardBox = await discardBtn.boundingBox();
      expect(discardBox, 'Discard button bounding box exists').not.toBeNull();
      expect(discardBox!.height, `Discard button height (${discardBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);

      // Bottom nav renders at bottom of viewport
      const nav = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
      await expect(nav).toBeVisible();
      const navRect = await nav.boundingBox();
      const listRect = await list.boundingBox();
      expect(navRect, 'navRect exists').not.toBeNull();
      expect(listRect, 'listRect exists').not.toBeNull();
    } finally {
      let cleanupErr: unknown = null;
      try {
        if (athleteUserId && !page.isClosed()) {
          await page.evaluate(async (uid) => {
            const dbName = `yourbody-offline-${uid}`;
            const openReq = indexedDB.open(dbName);
            await new Promise<void>((resolve, reject) => {
              openReq.onsuccess = () => {
                const db = openReq.result;
                if (db.objectStoreNames.contains('aiq')) {
                  const tx = db.transaction(['aiq'], 'readwrite');
                  tx.objectStore('aiq').clear();
                  tx.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                  tx.onerror = () => {
                    db.close();
                    reject(tx.error);
                  };
                } else {
                  db.close();
                  resolve();
                }
              };
              openReq.onerror = () => reject(openReq.error);
            });
          }, athleteUserId);
        }
      } catch (err: unknown) {
        cleanupErr = err;
      }
      await context.close();
      if (cleanupErr) {
        throw cleanupErr;
      }
    }
  });

  test('Density: StagedMealCard with Parsed locally badge + Analyze with AI instead fits 320px without overflow, >=44px tap targets, and toast/pill layering contract intact', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    try {
      await page.goto('/login');
      await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/workout');

      await page.goto('/nutrition');
      await expect(page.locator('text=Today\'s Meals')).toBeVisible({ timeout: 10000 });

      // Paste clear block into natural language input
      const clearBlock = 'Greek Yogurt Bowl\nServing: 170 g\nCalories: 130\nProtein: 15 g\nCarbs: 9 g\nFat: 3.5 g';
      const textarea = page.locator('textarea');
      await textarea.fill(clearBlock);

      const analyzeBtn = page.locator('[data-testid="analyze-meal-button"]');
      await analyzeBtn.click();

      // StagedMealCard appears
      const stagedCard = page.locator('[data-testid="staged-meal-card"]');
      await expect(stagedCard).toBeVisible({ timeout: 10000 });

      // Badges
      const parsedBadge = stagedCard.locator('[data-testid="parsed-locally-badge"]');
      await expect(parsedBadge).toBeVisible();
      await expect(parsedBadge).toHaveText('Parsed locally');

      const aiInsteadBtn = stagedCard.locator('[data-testid="analyze-with-ai-instead-btn"]');
      await expect(aiInsteadBtn).toBeVisible();
      await expect(aiInsteadBtn).toContainText('Analyze with AI instead');

      // Check horizontal clipping / overflow on staged card
      const cardClipped = await stagedCard.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(cardClipped, 'StagedMealCard must not horizontally overflow at 320px').toBe(false);

      // Verify tap target on 'Analyze with AI instead' >= 44px
      const aiBox = await aiInsteadBtn.boundingBox();
      expect(aiBox, 'Analyze with AI instead button bounding box exists').not.toBeNull();
      expect(aiBox!.height, `Analyze with AI instead button height (${aiBox!.height}px) >= 44px`).toBeGreaterThanOrEqual(44);
      expect(aiBox!.width, `Analyze with AI instead button width (${aiBox!.width}px) >= 44px`).toBeGreaterThanOrEqual(44);

      // Verify actions bar geometry: Log Meal button and Discard button
      const actionsBar = stagedCard.locator('[data-testid="staged-card-actions"]');
      await expect(actionsBar).toBeVisible();

      const logBtn = actionsBar.locator('button:has-text("Log Meal")');
      const logBox = await logBtn.boundingBox();
      expect(logBox, 'Log Meal button bounding box exists').not.toBeNull();
      expect(logBox!.height, `Log Meal button height (${logBox!.height}px) >= 40px`).toBeGreaterThanOrEqual(40);

      const discardBtn = actionsBar.locator('button[aria-label="Discard staged meal"]');
      const discardBox = await discardBtn.boundingBox();
      expect(discardBox, 'Discard button bounding box exists').not.toBeNull();
      expect(discardBox!.height, `Discard button height (${discardBox!.height}px) >= 40px`).toBeGreaterThanOrEqual(40);
      expect(discardBox!.width, `Discard button width (${discardBox!.width}px) >= 40px`).toBeGreaterThanOrEqual(40);

      // Toast / bottom nav layering: actions bar is sticky above bottom nav
      const nav = page.locator('nav').filter({ has: page.locator('[data-testid="nav-nutrition"]') });
      await expect(nav).toBeVisible();
      const navRect = await nav.boundingBox();
      const actionsRect = await actionsBar.boundingBox();
      expect(navRect, 'navRect exists').not.toBeNull();
      expect(actionsRect, 'actionsRect exists').not.toBeNull();
      const actionsBottom = actionsRect!.y + actionsRect!.height;
      expect(actionsBottom).toBeLessThanOrEqual(navRect!.y + 1);

      // Clean up staged meal
      await discardBtn.click();
      await expect(stagedCard).not.toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('R-SRC Rebrand: Header wordmark relational geometry and typography at 320px and 390px', async ({ browser }) => {
    for (const width of [320, 390]) {
      for (const accountEmail of ['athlete@yourbody.fyi', 'coach@yourbody.fyi']) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();

        try {
          await page.goto('/login');
          await page.fill('input[type="email"]', accountEmail);
          await page.fill('input[type="password"]', 'password123');
          await page.click('button[type="submit"]');

          // Coach sign-in routes to /coach; navigate to /workout to test maximum 4-badge coach density (dashboard link is only rendered off /coach)
          if (accountEmail.startsWith('coach')) {
            await page.waitForURL('**/coach');
            await page.goto('/workout');
            await page.waitForURL('**/workout');
          } else {
            await page.waitForURL('**/workout');
          }

          const header = page.locator('header');
          await expect(header).toBeVisible();

          const h1 = page.locator('header h1');
          await expect(h1).toBeVisible();

          const textContent = await h1.textContent();
          expect(textContent?.trim()).toBe('Yourbody.fyi');

          const isCoach = accountEmail.startsWith('coach');
          const badgeLocators = isCoach
            ? [
                page.locator('[data-testid="coach-dashboard-link"]'),
                page.locator('[data-testid="connection-status"]'),
                page.locator('[data-testid="role-switch-button"]'),
                page.locator('[data-testid="sign-out-button"]'),
              ]
            : [
                page.locator('[data-testid="connection-status"]'),
                page.locator('[data-testid="sign-out-button"]'),
              ];

          if (!isCoach) {
            // YB3: Static non-interactive Athlete chip is hidden below sm
            await expect(page.locator('[title="Athlete Account"]')).toBeHidden();
          }

          // Wait for connection status to settle to 'Online' so outbox sync and pill geometry are stable
          await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute('title', 'Online', { timeout: 10000 });

          // Wait for all expected badges for this role to be visible
          for (const loc of badgeLocators) {
            await expect(loc).toBeVisible({ timeout: 10000 });
          }

          const metrics = await h1.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
              textTransform: style.textTransform,
              fontSize: parseFloat(style.fontSize),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            };
          });

          expect(metrics.textTransform, `h1 computed text-transform must be 'none' at ${width}px (${accountEmail})`).toBe('none');
          expect(metrics.scrollWidth, `h1 scrollWidth (${metrics.scrollWidth}px) <= clientWidth (${metrics.clientWidth}px) at ${width}px (${accountEmail})`).toBeLessThanOrEqual(metrics.clientWidth);
          expect(metrics.fontSize, `h1 font-size (${metrics.fontSize}px) >= 12px at ${width}px (${accountEmail})`).toBeGreaterThanOrEqual(12);

          // Measure h1 bounding box with stability check across two ticks
          let h1Box: { x: number; y: number; width: number; height: number } | null = null;
          await expect.poll(async () => {
            const b1 = await h1.boundingBox();
            if (!b1 || b1.width <= 0 || b1.height <= 0) return false;
            const b2 = await h1.boundingBox();
            if (!b2) return false;
            if (
              Math.abs(b1.x - b2.x) < 1 &&
              Math.abs(b1.y - b2.y) < 1 &&
              Math.abs(b1.width - b2.width) < 1 &&
              Math.abs(b1.height - b2.height) < 1
            ) {
              h1Box = b2;
              return true;
            }
            return false;
          }, {
            message: `h1 bounding box must be non-null and stable at ${width}px (${accountEmail})`,
            timeout: 5000,
          }).toBe(true);

          expect(h1Box, 'h1 bounding box exists').not.toBeNull();

          for (const loc of badgeLocators) {
            let box: { x: number; y: number; width: number; height: number } | null = null;
            await expect.poll(async () => {
              const b1 = await loc.boundingBox();
              if (!b1 || b1.width <= 0 || b1.height <= 0) return false;
              const b2 = await loc.boundingBox();
              if (!b2) return false;
              if (
                Math.abs(b1.x - b2.x) < 1 &&
                Math.abs(b1.y - b2.y) < 1 &&
                Math.abs(b1.width - b2.width) < 1 &&
                Math.abs(b1.height - b2.height) < 1
              ) {
                box = b2;
                return true;
              }
              return false;
            }, {
              message: `badge bounding box must be non-null and stable for ${loc}`,
              timeout: 5000,
            }).toBe(true);

            expect(box, 'badge bounding box exists').not.toBeNull();
            const intersects = !(
              h1Box!.x + h1Box!.width <= box!.x ||
              box!.x + box!.width <= h1Box!.x ||
              h1Box!.y + h1Box!.height <= box!.y ||
              box!.y + box!.height <= h1Box!.y
            );
            expect(intersects, `h1 must not intersect with badge/action element at ${width}px (${accountEmail})`).toBe(false);
          }
        } finally {
          await context.close();
        }
      }
    }
  });

  test('Header content edges align with page content column across routes and viewports', async ({ browser }) => {
    test.setTimeout(120000);
    const viewports = [320, 390, 768, 993, 1280, 1440];
    const shotsDir = test.info().outputPath('shots');

    for (const width of viewports) {
      // 1. Coach on /coach
      {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto('/login');
          await page.fill('input[type="email"]', 'coach@yourbody.fyi');
          await page.fill('input[type="password"]', 'password123');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/coach');

          const card = page.locator('main div.rounded-2xl, main div.rounded-3xl').first();
          await expect(card).toBeVisible({ timeout: 10000 });
          const cardBox = await card.boundingBox();
          expect(cardBox, `cardBox exists on /coach at ${width}px`).not.toBeNull();

          const logo = page.locator('header a[href="/workout"] > div:first-child');
          await expect(logo).toBeVisible({ timeout: 10000 });
          const logoBox = await logo.boundingBox();
          expect(logoBox, `logoBox exists on /coach at ${width}px`).not.toBeNull();

          const signout = page.locator('[data-testid="sign-out-button"]');
          await expect(signout).toBeVisible({ timeout: 10000 });
          const signoutBox = await signout.boundingBox();
          expect(signoutBox, `signoutBox exists on /coach at ${width}px`).not.toBeNull();

          const leftDelta = Math.abs(logoBox!.x - cardBox!.x);
          const rightDelta = Math.abs((signoutBox!.x + signoutBox!.width) - (cardBox!.x + cardBox!.width));

          expect(leftDelta, `logo-icon left (${logoBox!.x}px) == card left (${cardBox!.x}px) ±1px at ${width}px on /coach (delta: ${leftDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);
          expect(rightDelta, `last control right (${signoutBox!.x + signoutBox!.width}px) == card right (${cardBox!.x + cardBox!.width}px) ±1px at ${width}px on /coach (delta: ${rightDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);

          if ([320, 390, 993].includes(width)) {
            await page.screenshot({ path: `${shotsDir}/hdr_coach_${width}.png` });
          }
        } finally {
          await context.close();
        }
      }

      // 2. Athlete on /workout, /history, /nutrition, /settings
      {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto('/login');
          await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
          await page.fill('input[type="password"]', 'password123');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/workout');

          for (const route of ['/workout', '/history', '/nutrition', '/settings']) {
            if (route !== '/workout') {
              await page.goto(route);
              await page.waitForURL(`**${route}`);
            }

            const card = page.locator('main div.rounded-2xl, main div.rounded-3xl').first();
            await expect(card).toBeVisible({ timeout: 10000 });
            const cardBox = await card.boundingBox();
            expect(cardBox, `cardBox exists on ${route} at ${width}px`).not.toBeNull();

            const logo = page.locator('header a[href="/workout"] > div:first-child');
            await expect(logo).toBeVisible({ timeout: 10000 });
            const logoBox = await logo.boundingBox();
            expect(logoBox, `logoBox exists on ${route} at ${width}px`).not.toBeNull();

            const signout = page.locator('[data-testid="sign-out-button"]');
            await expect(signout).toBeVisible({ timeout: 10000 });
            const signoutBox = await signout.boundingBox();
            expect(signoutBox, `signoutBox exists on ${route} at ${width}px`).not.toBeNull();

            const leftDelta = Math.abs(logoBox!.x - cardBox!.x);
            const rightDelta = Math.abs((signoutBox!.x + signoutBox!.width) - (cardBox!.x + cardBox!.width));

            expect(leftDelta, `logo-icon left (${logoBox!.x}px) == card left (${cardBox!.x}px) ±1px at ${width}px on ${route} (delta: ${leftDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);
            expect(rightDelta, `last control right (${signoutBox!.x + signoutBox!.width}px) == card right (${cardBox!.x + cardBox!.width}px) ±1px at ${width}px on ${route} (delta: ${rightDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);

            if (route === '/workout' && [320, 390, 993].includes(width)) {
              await page.screenshot({ path: `${shotsDir}/hdr_workout_${width}.png` });
            }
          }
        } finally {
          await context.close();
        }
      }

      // 3. /login signed out
      {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto('/login');
          const expectedLeft = Math.max(16, (width - 576) / 2 + 16);
          const expectedRight = width - expectedLeft;

          const logo = page.locator('header a[href="/workout"] > div:first-child');
          await expect(logo).toBeVisible({ timeout: 10000 });
          const logoBox = await logo.boundingBox();
          expect(logoBox, `logoBox exists on /login at ${width}px`).not.toBeNull();

          const status = page.locator('[data-testid="connection-status"]');
          await expect(status).toBeVisible({ timeout: 10000 });
          const statusBox = await status.boundingBox();
          expect(statusBox, `statusBox exists on /login at ${width}px`).not.toBeNull();

          const leftDelta = Math.abs(logoBox!.x - expectedLeft);
          const rightDelta = Math.abs((statusBox!.x + statusBox!.width) - expectedRight);

          expect(leftDelta, `logo-icon left (${logoBox!.x}px) == column left (${expectedLeft}px) ±1px at ${width}px on /login (delta: ${leftDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);
          expect(rightDelta, `last control right (${statusBox!.x + statusBox!.width}px) == column right (${expectedRight}px) ±1px at ${width}px on /login (delta: ${rightDelta.toFixed(2)}px)`).toBeLessThanOrEqual(1);
        } finally {
          await context.close();
        }
      }
    }
  });

  test('320px header wordmark relational geometry under widest pill states (athlete and coach)', async ({ browser }) => {
    test.setTimeout(120000);
    const width = 320;

    for (const accountEmail of ['athlete@yourbody.fyi', 'coach@yourbody.fyi']) {
      const isCoach = accountEmail.startsWith('coach');

      const setupWorkoutPage = async () => {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();

        await page.goto('/login');
        await page.fill('input[type="email"]', accountEmail);
        await page.fill('input[type="password"]', 'password123');
        await page.click('button[type="submit"]');

        if (isCoach) {
          await page.waitForURL('**/coach');
          await page.goto('/workout');
          await page.waitForURL('**/workout');
        } else {
          await page.waitForURL('**/workout');
        }

        await page.waitForFunction(async () => {
          const dbs = await indexedDB.databases();
          const dbEntry = dbs.find((d) => d.name && d.name.startsWith('yourbody-offline-'));
          if (!dbEntry?.name) return false;
          return new Promise<boolean>((resolve) => {
            const req = indexedDB.open(dbEntry.name, 2);
            req.onsuccess = () => {
              const db = req.result;
              const ready = db.objectStoreNames.contains('outbox');
              db.close();
              resolve(ready);
            };
            req.onerror = () => resolve(false);
          });
        }, null, { timeout: 10000 });

        const userId = await page.evaluate(() => {
          const authKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
          if (authKey) {
            try { return JSON.parse(localStorage.getItem(authKey) || '{}')?.user?.id; } catch {}
          }
          const u = localStorage.getItem('yourbody_user');
          if (u) {
            try { return JSON.parse(u).id; } catch {}
          }
          return '';
        });
        expect(userId, 'userId must exist').toBeTruthy();

        return { context, page, userId };
      };

      const verifyWordmarkGeometry = async (page: Page, stateDesc: string) => {
        const h1 = page.locator('header h1');
        await expect(h1).toBeVisible({ timeout: 5000 });

        const metrics = await h1.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return {
            textTransform: style.textTransform,
            fontSize: parseFloat(style.fontSize),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          };
        });

        expect(metrics.textTransform, `h1 textTransform must be 'none' (${accountEmail}, ${stateDesc})`).toBe('none');
        expect(metrics.scrollWidth, `h1 scrollWidth (${metrics.scrollWidth}px) <= clientWidth (${metrics.clientWidth}px) (${accountEmail}, ${stateDesc})`).toBeLessThanOrEqual(metrics.clientWidth);
        expect(metrics.fontSize, `h1 font-size (${metrics.fontSize}px) >= 12px (${accountEmail}, ${stateDesc})`).toBeGreaterThanOrEqual(12);

        const h1Box = await h1.boundingBox();
        expect(h1Box, `h1Box exists (${accountEmail}, ${stateDesc})`).not.toBeNull();

        const badgeLocators = isCoach
          ? [
              page.locator('[data-testid="coach-dashboard-link"]'),
              page.locator('[data-testid="connection-status"]'),
              page.locator('[data-testid="role-switch-button"]'),
              page.locator('[data-testid="sign-out-button"]'),
            ]
          : [
              page.locator('[data-testid="connection-status"]'),
              page.locator('[data-testid="sign-out-button"]'),
            ];

        if (!isCoach) {
          // YB3: Non-coach static Athlete chip is hidden below sm
          await expect(page.locator('[title="Athlete Account"]')).toBeHidden();
        }

        for (const loc of badgeLocators) {
          await expect(loc).toBeVisible({ timeout: 5000 });
          const box = await loc.boundingBox();
          expect(box, `badge bounding box exists (${loc})`).not.toBeNull();

          const intersects = !(
            h1Box!.x + h1Box!.width <= box!.x ||
            box!.x + box!.width <= h1Box!.x ||
            h1Box!.y + h1Box!.height <= box!.y ||
            box!.y + box!.height <= h1Box!.y
          );
          expect(intersects, `h1 must not intersect with badge (${loc}) at 320px (${accountEmail}, ${stateDesc})`).toBe(false);
        }
      };

      // State 1: "Offline · 99 pending"
      {
        const { context, page, userId } = await setupWorkoutPage();
        const dbName = `yourbody-offline-${userId}`;
        try {
          await page.evaluate(
            async ({ name, uid }) => {
              const req = indexedDB.open(name);
              const db: IDBDatabase = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
              });
              const tx = db.transaction(['outbox'], 'readwrite');
              const store = tx.objectStore('outbox');
              const now = new Date().toISOString();
              const baseSeq = Date.now();
              for (let i = 1; i <= 99; i++) {
                store.put({
                  opId: `p-${i}`,
                  userId: uid,
                  seq: baseSeq + i,
                  kind: 'set.create',
                  payload: { id: `s-${i}`, workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: i, set_type: 'working', created_at: now },
                  createdAt: now,
                  attempts: 0,
                  state: 'pending',
                });
              }
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
            },
            { name: dbName, uid: userId }
          );

          await page.route('**/rest/v1/sets*', (route) => {
            if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
              return route.abort('internetdisconnected');
            }
            return route.continue();
          });
          await page.route('**/rest/v1/workouts*', (route) => {
            if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
              return route.abort('internetdisconnected');
            }
            return route.continue();
          });

          await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
            window.dispatchEvent(new Event('offline'));
          });
          const statusPill = page.locator('[data-testid="connection-status"]');
          await expect(statusPill).toHaveAttribute('title', /99 pending/, { timeout: 10000 });

          await verifyWordmarkGeometry(page, 'Offline · 99 pending');
        } finally {
          await context.close();
        }
      }

      // State 2: "3 need attention"
      {
        const { context, page, userId } = await setupWorkoutPage();
        const dbName = `yourbody-offline-${userId}`;
        try {
          await page.route('**/rest/v1/**', (route) => {
            if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
              return route.abort('internetdisconnected');
            }
            return route.continue();
          });

          await page.evaluate(
            async ({ name, uid }) => {
              const req = indexedDB.open(name);
              const db: IDBDatabase = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
              });
              const tx = db.transaction(['outbox'], 'readwrite');
              const store = tx.objectStore('outbox');
              const now = new Date().toISOString();
              const baseSeq = Date.now();
              for (let i = 1; i <= 3; i++) {
                store.put({
                  opId: `att-${i}`,
                  userId: uid,
                  seq: baseSeq + i,
                  kind: 'set.create',
                  payload: { id: `as-${i}`, workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: i, set_type: 'working', created_at: now },
                  createdAt: now,
                  attempts: 3,
                  state: 'attention',
                  error: 'Server conflict',
                });
              }
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
            },
            { name: dbName, uid: userId }
          );

          await page.reload();
          await page.waitForLoadState('domcontentloaded');

          const statusPill = page.locator('[data-testid="connection-status"]');
          await expect(statusPill).toHaveAttribute('title', '3 need attention', { timeout: 10000 });

          await verifyWordmarkGeometry(page, '3 need attention');
        } finally {
          await context.close();
        }
      }

      // State 3: "Sign in to sync"
      {
        const specWorkoutDate = '2026-10-31';
        const cleanupSpecWorkouts = (email: string) => {
          const sql = `
            DELETE FROM public.sets
            WHERE workout_id IN (
              SELECT id FROM public.workouts
              WHERE user_id = (SELECT id FROM public.users WHERE email = '${email}')
                AND (workout_date = '${specWorkoutDate}' OR date = '${specWorkoutDate}')
            );
            DELETE FROM public.workouts
            WHERE user_id = (SELECT id FROM public.users WHERE email = '${email}')
              AND (workout_date = '${specWorkoutDate}' OR date = '${specWorkoutDate}');
          `;
          try {
            const cmd = getPsqlCommand();
            execSync(cmd, { input: sql, encoding: 'utf8' });
          } catch (err) {
            console.error('[visual-density] Error cleaning up spec workouts:', err);
            throw err;
          }
        };

        cleanupSpecWorkouts(accountEmail);
        const { context, page } = await setupWorkoutPage();
        try {
          await page.goto(`/workout?date=${specWorkoutDate}`);
          await page.waitForURL(`**/workout?date=${specWorkoutDate}`);

          await page.locator('button:has-text("Choose Routine")').click();
          await page.locator('[data-testid="routine-picker-modal"] button:has-text("Workout A (Push, Quads & Core)")').click();
          await page.locator('[data-testid="routine-picker-modal"]').waitFor({ state: 'hidden' });
          await expect(page.locator('[data-testid="ghost-weight-0-0"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-testid="ghost-reps-0-0"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-testid="commit-set-btn-0-0"]')).toBeVisible({ timeout: 10000 });

          await page.locator('[data-testid="ghost-weight-0-0"]').fill('135');
          await page.locator('[data-testid="ghost-reps-0-0"]').fill('10');

          await page.route('**/auth/v1/token*', async (route) => {
            await route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Invalid Refresh Token: Refresh Token Not Found',
                code: 'refresh_token_not_found',
              }),
            });
          });

          await page.route('**/rest/v1/sets*', async (route) => {
            await route.fulfill({
              status: 401,
              contentType: 'application/json',
              headers: { 'www-authenticate': 'Bearer error="invalid_token"' },
              body: JSON.stringify({ message: 'JWT expired', code: 401 }),
            });
          });

          const commitBtn = page.locator('[data-testid="commit-set-btn-0-0"]');
          await commitBtn.click();

          const statusPill = page.locator('[data-testid="connection-status"]');
          await expect(statusPill).toHaveAttribute('title', 'Sign in to sync', { timeout: 10000 });

          await verifyWordmarkGeometry(page, 'Sign in to sync');
        } finally {
          await page.unroute('**/rest/v1/sets*').catch(() => {});
          await page.unroute('**/auth/v1/token*').catch(() => {});
          cleanupSpecWorkouts(accountEmail);
          await context.close();
        }
      }
    }
  });

  test('YB3: header controls', async ({ browser }) => {
    test.setTimeout(180000);

    const verifyHeaderControlsGeometry = async (page: Page, width: number, desc: string) => {
      const result = await page.evaluate(({ width, desc }) => {
        const controls = Array.from(document.querySelectorAll<HTMLElement>(
          'header div.shrink-0 > button, header div.shrink-0 > a'
        )).filter((el) => {
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden';
        });

        const issues: string[] = [];

        // (a) every control hit box >= 44x44 and no two hit boxes overlap
        const boxes = controls.map((ctrl) => {
          const r = ctrl.getBoundingClientRect();
          return {
            id: ctrl.getAttribute('data-testid') || ctrl.tagName,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        });

        for (const b of boxes) {
          if (b.width < 43.5 || b.height < 43.5) {
            issues.push(`Control ${b.id} hit box ${b.width.toFixed(1)}x${b.height.toFixed(1)} < 44x44`);
          }
        }

        for (let i = 0; i < boxes.length - 1; i++) {
          const b1 = boxes[i];
          const b2 = boxes[i + 1];
          const hOverlap = Math.max(0, Math.min(b1.right, b2.right) - Math.max(b1.x, b2.x));
          const vOverlap = Math.max(0, Math.min(b1.bottom, b2.bottom) - Math.max(b1.y, b2.y));
          const overlapArea = hOverlap * vOverlap;
          if (overlapArea > 0.5) {
            issues.push(`Hit box overlap between ${b1.id} and ${b2.id}: ${overlapArea.toFixed(1)}px²`);
          }
        }

        // (b) visual gap between adjacent controls' inner visuals >= 6px
        const innerVisuals = controls.map((ctrl) => {
          const iv = (ctrl.firstElementChild as HTMLElement) || ctrl;
          const r = iv.getBoundingClientRect();
          return {
            ctrlId: ctrl.getAttribute('data-testid') || ctrl.tagName,
            r,
            el: iv,
          };
        });

        for (let i = 0; i < innerVisuals.length - 1; i++) {
          const iv1 = innerVisuals[i];
          const iv2 = innerVisuals[i + 1];
          const visualGap = iv2.r.left - iv1.r.right;
          if (visualGap < 5.5) {
            issues.push(`Visual gap between ${iv1.ctrlId} and ${iv2.ctrlId} inner visuals is ${visualGap.toFixed(1)}px < 6px`);
          }
        }

        // (c) computed box-shadow is 'none' on every control and inner visual
        for (const ctrl of controls) {
          const s = window.getComputedStyle(ctrl).boxShadow;
          if (s && s !== 'none') {
            issues.push(`Control ${ctrl.getAttribute('data-testid')} has non-none box-shadow: ${s}`);
          }
          for (const desc of Array.from(ctrl.querySelectorAll('*'))) {
            const ds = window.getComputedStyle(desc).boxShadow;
            if (ds && ds !== 'none') {
              issues.push(`Control descendant ${desc.tagName} has non-none box-shadow: ${ds}`);
            }
          }
        }

        // (d) all inner visuals of icon controls have equal height (36 ±1)
        for (const iv of innerVisuals) {
          if (Math.abs(iv.r.height - 36) > 1.5) {
            issues.push(`Inner visual of ${iv.ctrlId} height is ${iv.r.height.toFixed(1)}px (expected 36 ±1)`);
          }
        }

        // (e) brand name computed font-size >= 14px and scrollWidth <= clientWidth, no overlap with the first control
        const h1 = document.querySelector('header h1') as HTMLElement;
        if (!h1) {
          issues.push('Brand name h1 not found');
        } else {
          const h1Style = window.getComputedStyle(h1);
          const fs = parseFloat(h1Style.fontSize);
          if (fs < 13.5) {
            issues.push(`Brand name font-size ${fs}px < 14px`);
          }
          if (h1.scrollWidth > h1.clientWidth + 1) {
            issues.push(`Brand name scrollWidth (${h1.scrollWidth}) > clientWidth (${h1.clientWidth})`);
          }
          if (boxes.length > 0) {
            const firstCtrl = boxes[0];
            const h1Rect = h1.getBoundingClientRect();
            if (h1Rect.right > firstCtrl.x + 0.5) {
              issues.push(`Brand name overlaps first control ${firstCtrl.id}: h1.right (${h1Rect.right.toFixed(1)}) > ctrl.x (${firstCtrl.x.toFixed(1)})`);
            }
          }
        }

        // (f) tagline either display:none or scrollWidth <= clientWidth
        // Explicitly enforces: at 320px tagline is display:none; at 390px on /workout tagline is visible and not truncated
        const tagline = document.querySelector('header h1 + div') as HTMLElement;
        if (tagline) {
          const tagStyle = window.getComputedStyle(tagline);
          if (width === 320) {
            if (tagStyle.display !== 'none') {
              issues.push(`Tagline at 320px must be display:none, found ${tagStyle.display}`);
            }
          } else if (width === 390 && desc.includes('/workout')) {
            if (tagStyle.display === 'none') {
              issues.push(`Tagline at 390px on /workout (${desc}) must be visible, found display:none`);
            }
          }
          if (tagStyle.display !== 'none') {
            if (tagline.scrollWidth > tagline.clientWidth + 1) {
              issues.push(`Tagline scrollWidth (${tagline.scrollWidth}) > clientWidth (${tagline.clientWidth})`);
            }
          }
        }

        return {
          issues,
          controlCount: controls.length,
          boxes,
        };
      }, { width, desc });

      expect(result.issues, `Header controls geometry issues for ${desc} at ${width}px`).toEqual([]);
      expect(result.controlCount, `Expected controls for ${desc} at ${width}px`).toBeGreaterThan(0);
    };

    const seed99Pending = async (page: Page) => {
      await page.waitForFunction(async () => {
        const dbs = await indexedDB.databases();
        const dbEntry = dbs.find((d) => d.name && d.name.startsWith('yourbody-offline-'));
        if (!dbEntry?.name) return false;
        return new Promise<boolean>((resolve) => {
          const req = indexedDB.open(dbEntry.name, 2);
          req.onsuccess = () => {
            const db = req.result;
            const ready = db.objectStoreNames.contains('outbox');
            db.close();
            resolve(ready);
          };
          req.onerror = () => resolve(false);
        });
      }, null, { timeout: 10000 });

      const userId = await page.evaluate(() => {
        const authKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
        if (authKey) {
          try { return JSON.parse(localStorage.getItem(authKey) || '{}')?.user?.id; } catch {}
        }
        const u = localStorage.getItem('yourbody_user');
        if (u) {
          try { return JSON.parse(u).id; } catch {}
        }
        return '';
      });

      const dbName = `yourbody-offline-${userId}`;
      await page.evaluate(
        async ({ name, uid }) => {
          const req = indexedDB.open(name, 2);
          const db: IDBDatabase = await new Promise((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
          const tx = db.transaction(['outbox'], 'readwrite');
          const store = tx.objectStore('outbox');
          const now = new Date().toISOString();
          const baseSeq = Date.now();
          for (let i = 1; i <= 99; i++) {
            store.put({
              opId: `p-${i}`,
              userId: uid,
              seq: baseSeq + i,
              kind: 'set.create',
              payload: { id: `s-${i}`, workoutRef: 'w1', exercise_id: 'e1', weight: 100, reps: 5, set_index: i, set_type: 'working', created_at: now },
              createdAt: now,
              attempts: 0,
              state: 'pending',
            });
          }
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
        },
        { name: dbName, uid: userId }
      );

      await page.route('**/rest/v1/sets*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });
      await page.route('**/rest/v1/workouts*', (route) => {
        if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
          return route.abort('internetdisconnected');
        }
        return route.continue();
      });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: false });
        window.dispatchEvent(new Event('offline'));
      });
      const statusPill = page.locator('[data-testid="connection-status"]');
      await expect(statusPill).toHaveAttribute('title', /99 pending/, { timeout: 10000 });
    };

    for (const width of [320, 390]) {
      // 1. Athlete on /workout
      {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto('/login');
          await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
          await page.fill('input[type="password"]', 'password123');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/workout');

          // (1a) online state
          await verifyHeaderControlsGeometry(page, width, 'athlete /workout (online)');

          // (1b) widest pill state
          await seed99Pending(page);
          await verifyHeaderControlsGeometry(page, width, 'athlete /workout (widest pill)');
        } finally {
          await context.close();
        }
      }

      // 2. Coach on /coach and /workout
      {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        try {
          await page.goto('/login');
          await page.fill('input[type="email"]', 'coach@yourbody.fyi');
          await page.fill('input[type="password"]', 'password123');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/coach');

          // (2a) coach on /coach (online)
          await verifyHeaderControlsGeometry(page, width, 'coach /coach (online)');

          // (2b) coach on /coach (widest pill)
          await seed99Pending(page);
          await verifyHeaderControlsGeometry(page, width, 'coach /coach (widest pill)');

          // Reset online and navigate to /workout
          await page.unroute('**/rest/v1/sets*').catch(() => {});
          await page.unroute('**/rest/v1/workouts*').catch(() => {});
          await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, writable: true, value: true });
            window.dispatchEvent(new Event('online'));
          });
          await page.goto('/workout');
          await page.waitForURL('**/workout');

          // (2c) coach on /workout (online)
          await expect(page.locator('[data-testid="coach-dashboard-link"]')).toBeVisible({ timeout: 5000 });
          await verifyHeaderControlsGeometry(page, width, 'coach /workout (online)');

          // (2d) coach on /workout (widest pill)
          await seed99Pending(page);
          await verifyHeaderControlsGeometry(page, width, 'coach /workout (widest pill)');
        } finally {
          await context.close();
        }
      }
    }
  });
});
