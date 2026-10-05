import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

const USER_EMAIL = 'yb-nutrition-accordion@yourbody.fyi';
const USER_PASSWORD = 'password123';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58821';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

function getOffsetDateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DATE_EARLIER = getOffsetDateStr(-5);
const DATE_LATER = getOffsetDateStr(-4);

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

function cleanupUser(): void {
  const sql = `
    DELETE FROM public.nutrition_logs WHERE user_id IN (
      SELECT id FROM auth.users WHERE email = '${USER_EMAIL}'
    );
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (
      SELECT id FROM auth.users WHERE email = '${USER_EMAIL}'
    );
    DELETE FROM auth.users WHERE email = '${USER_EMAIL}';
    DELETE FROM public.users WHERE email = '${USER_EMAIL}';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error('[yb-nutrition-accordion] Cleanup error:', err);
    throw err;
  }
}

async function loginUser(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', USER_EMAIL);
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
}

test.describe('D-YB-9: Nutrition History Day Accordion', () => {
  test.beforeAll(async () => {
    cleanupUser();

    // Signup test account
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: USER_EMAIL,
        password: USER_PASSWORD,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create test user: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const userId = data.id || data.user?.id;
    if (!userId) {
      throw new Error('Failed to obtain user id from signup response');
    }

    // Seed 2 relative dates: earlier (2 meals) and later (1 meal) within 14-day history window
    const sql = `
      INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
      VALUES
        (gen_random_uuid(), '${userId}', 'Accordion Grilled Chicken', 500, 45, 30, 15, 4, '${DATE_EARLIER}T12:00:00Z', '${DATE_EARLIER}'),
        (gen_random_uuid(), '${userId}', 'Accordion Greek Yogurt', 250, 25, 15, 5, 2, '${DATE_EARLIER}T16:00:00Z', '${DATE_EARLIER}'),
        (gen_random_uuid(), '${userId}', 'Accordion Salmon & Rice', 650, 40, 60, 20, 5, '${DATE_LATER}T18:00:00Z', '${DATE_LATER}');
    `;
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  });

  test.afterAll(() => {
    cleanupUser();
  });

  for (const viewport of [
    { width: 320, height: 700, label: '320px' },
    { width: 390, height: 844, label: '390px' },
  ]) {
    test(`accordion behavior, touch targets, and non-overlap at ${viewport.label}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginUser(page);

      // Navigate to /history and switch to Nutrition tab
      await page.goto('/history');
      await expect(page.locator('text=Workout History')).toBeVisible({ timeout: 10000 });

      const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
      await expect(nutritionTab).toBeVisible({ timeout: 10000 });
      await nutritionTab.click();
      await expect(nutritionTab).toHaveAttribute('aria-selected', 'true');

      // 1. Collapsed by default: verify header row visible, meals & distribution bar NOT in DOM
      const toggle21 = page.locator(`button[data-testid="expand-day-btn-${DATE_LATER}"]`);
      const toggle20 = page.locator(`button[data-testid="expand-day-btn-${DATE_EARLIER}"]`);

      await expect(toggle21).toBeVisible({ timeout: 10000 });
      await expect(toggle20).toBeVisible({ timeout: 10000 });

      await expect(toggle21).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle21).toHaveAttribute('aria-controls', `nutrition-day-details-${DATE_LATER}`);
      await expect(toggle20).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle20).toHaveAttribute('aria-controls', `nutrition-day-details-${DATE_EARLIER}`);

      // Meal items and distribution bar must NOT exist in the DOM while collapsed
      expect(await page.locator(`#nutrition-day-details-${DATE_LATER}`).count()).toBe(0);
      expect(await page.locator(`#nutrition-day-details-${DATE_EARLIER}`).count()).toBe(0);
      expect(await page.locator('text=Accordion Salmon & Rice').count()).toBe(0);
      expect(await page.locator('text=Accordion Grilled Chicken').count()).toBe(0);
      expect(await page.locator('text=Caloric Macro Distribution').count()).toBe(0);

      // 2. Hit area >= 44x44 and elementFromPoint(center) is toggle or child
      const box = await toggle21.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);

      const isToggleUnderCenter = await page.evaluate(
        ({ x, y, selector }) => {
          const el = document.elementFromPoint(x, y);
          const btn = document.querySelector(selector);
          return btn ? (btn === el || btn.contains(el)) : false;
        },
        {
          x: box!.x + box!.width / 2,
          y: box!.y + box!.height / 2,
          selector: `button[data-testid="expand-day-btn-${DATE_LATER}"]`,
        }
      );
      expect(isToggleUnderCenter, 'Center of toggle button must resolve to the button or its child').toBe(true);

      // 3. Header chips + toggle do not overlap (rect predicates in px)
      const hasChipOverlap = await page.evaluate((selector) => {
        const toggleEl = document.querySelector(selector);
        if (!toggleEl) return true;
        const toggleRect = toggleEl.getBoundingClientRect();
        const cardEl = toggleEl.closest('.rounded-3xl');
        if (!cardEl) return true;

        const chips = cardEl.querySelectorAll('.tabular-nums span');
        for (const chip of Array.from(chips)) {
          const chipRect = chip.getBoundingClientRect();
          if (chipRect.width === 0 || chipRect.height === 0) continue;

          // Non-overlap predicate: bounding boxes must be disjoint
          const disjoint =
            chipRect.right <= toggleRect.left ||
            chipRect.left >= toggleRect.right ||
            chipRect.bottom <= toggleRect.top ||
            chipRect.top >= toggleRect.bottom;

          if (!disjoint) {
            return true;
          }
        }
        return false;
      }, `button[data-testid="expand-day-btn-${DATE_LATER}"]`);
      expect(hasChipOverlap, `Header chips and toggle button must not overlap at ${viewport.label}`).toBe(false);

      // 4. No horizontal overflow while collapsed
      const hasOverflowCollapsed = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflowCollapsed, `No horizontal overflow at ${viewport.label} (collapsed)`).toBe(false);

      // 5. Save collapsed screenshot at 320px
      if (viewport.width === 320) {
        await page.screenshot({
          path: testInfo.outputPath('yb_nutrition_collapsed_320.png'),
          fullPage: false,
        });
      }

      // 6. Expanding renders distribution bar and meals
      await toggle21.click();
      await expect(toggle21).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#nutrition-day-details-${DATE_LATER}`)).toBeVisible();
      await expect(page.locator('text=Accordion Salmon & Rice')).toBeVisible();
      await expect(page.locator('text=Caloric Macro Distribution').first()).toBeVisible();

      // Verify no horizontal overflow while expanded
      const hasOverflowExpanded = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasOverflowExpanded, `No horizontal overflow at ${viewport.label} (expanded)`).toBe(false);

      // 7. Save expanded screenshot at 320px
      if (viewport.width === 320) {
        await page.screenshot({
          path: testInfo.outputPath('yb_nutrition_expanded_320.png'),
          fullPage: false,
        });
      }

      // 8. Collapsing again removes distribution bar and meals from DOM
      await toggle21.click();
      await expect(toggle21).toHaveAttribute('aria-expanded', 'false');
      expect(await page.locator(`#nutrition-day-details-${DATE_LATER}`).count()).toBe(0);
      expect(await page.locator('text=Accordion Salmon & Rice').count()).toBe(0);
    });
  }
});
