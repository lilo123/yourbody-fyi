import { execSync } from 'child_process';
import { test, expect, type Page } from '@playwright/test';

let userEmail = '';
const USER_PASSWORD = 'password123';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58821';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:58822/postgres';

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getPsqlCommand(): string {
  const baseCmd = process.env.DATABASE_URL
    ? `psql "${process.env.DATABASE_URL}" -v ON_ERROR_STOP=1`
    : `psql "${DB_URL}" -v ON_ERROR_STOP=1`;
  return `flock -w 600 /tmp/fitness_local_db.flock ${baseCmd}`;
}

function cleanupUser(email: string): void {
  if (!email) return;
  const sql = `
    DELETE FROM public.nutrition_logs WHERE user_id IN (
      SELECT id FROM auth.users WHERE email = '${email}'
    );
    DELETE FROM public.coach_athlete_links WHERE athlete_id IN (
      SELECT id FROM auth.users WHERE email = '${email}'
    );
    DELETE FROM auth.users WHERE email = '${email}';
    DELETE FROM public.users WHERE email = '${email}';
  `;
  try {
    const cmd = getPsqlCommand();
    execSync(cmd, { input: sql, encoding: 'utf8' });
  } catch (err) {
    console.error(`[yb4-history-day-card-overlap] Cleanup error for ${email}:`, err);
    throw err;
  }
}

function seedNutritionData(userId: string, email: string): void {
  const sql = `
    DO $$
    DECLARE
      v_uid uuid := '${userId}';
      v_date date;
    BEGIN
      -- Ensure profile username and athlete role
      INSERT INTO public.users (id, email, username, role)
      VALUES (v_uid, '${email}', 'YB4 Overlap Athlete', 'athlete')
      ON CONFLICT (id) DO UPDATE SET username = 'YB4 Overlap Athlete', role = 'athlete';

      -- Seed 10 days of nutrition logs (CURRENT_DATE down to CURRENT_DATE - 9)
      -- Each day has realistic macros incl. fiber (45g) so chips wrap to 2 rows at 393px and 320px
      FOR i IN 0..9 LOOP
        v_date := CURRENT_DATE - i;
        INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, protein, carbs, fat, fiber, logged_at, logged_date)
        VALUES
          (gen_random_uuid(), v_uid, 'YB4 Daily Power Bowl ' || i, 3250, 240, 320, 115, 45, v_date::timestamptz + interval '12 hours', v_date);
      END LOOP;
    END $$;
  `;
  const cmd = getPsqlCommand();
  execSync(cmd, { input: sql, encoding: 'utf8' });
}

async function loginUser(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', USER_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout', { timeout: 15000 });
}

interface GeometryResult {
  ok: boolean;
  error?: string;
  measuredHeights?: { index: number; height: number }[];
}

async function assertDayCardGeometry(page: Page, stepName: string): Promise<void> {
  await expect(async () => {
    const evalResult = await page.evaluate((): GeometryResult => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-index]'))
        .sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index')));

      if (cards.length < 2) {
        return { ok: false, error: `Expected at least 2 rendered day cards, found ${cards.length}` };
      }

      const container = cards[0].parentElement;
      if (!container) {
        return { ok: false, error: 'Virtual container parent not found' };
      }
      const containerRect = container.getBoundingClientRect();

      const measuredHeights = cards.map((c) => ({
        index: Number(c.getAttribute('data-index')),
        height: Math.round(c.getBoundingClientRect().height * 100) / 100,
      }));

      // Invariant: for each consecutive pair cardN.bottom <= cardN+1.top + 0.5 AND |gap-16| <= 2
      for (let i = 0; i < cards.length - 1; i++) {
        const cardN = cards[i];
        const cardNext = cards[i + 1];
        const idxN = Number(cardN.getAttribute('data-index'));
        const idxNext = Number(cardNext.getAttribute('data-index'));
        const rectN = cardN.getBoundingClientRect();
        const rectNext = cardNext.getBoundingClientRect();
        const gap = rectNext.top - rectN.bottom;

        const nonOverlapping = rectN.bottom <= rectNext.top + 0.5;
        const gapValid = Math.abs(gap - 16) <= 2;

        if (!nonOverlapping || !gapValid) {
          return {
            ok: false,
            error: `raw px: (index: ${idxN}, bottom: ${rectN.bottom.toFixed(2)}, nextTop: ${rectNext.top.toFixed(2)}, gap: ${gap.toFixed(2)}) | card${idxN}.bottom <= card${idxNext}.top + 0.5: ${nonOverlapping} | |gap-16| <= 2: ${gapValid}`,
            measuredHeights,
          };
        }
      }

      // Invariant: virtual container height >= last rendered card bottom - container top
      const lastCard = cards[cards.length - 1];
      const lastRect = lastCard.getBoundingClientRect();
      const contentBottomRel = lastRect.bottom - containerRect.top;
      if (containerRect.height < contentBottomRel - 0.5) {
        return {
          ok: false,
          error: `Virtual container height violation: container.height=${containerRect.height.toFixed(2)}px < contentBottom=${contentBottomRel.toFixed(2)}px (diff=${(contentBottomRel - containerRect.height).toFixed(2)}px)`,
          measuredHeights,
        };
      }

      return { ok: true, measuredHeights };
    });

    expect(evalResult.ok, `[GEOMETRY_FAILURE] Step "${stepName}": ${evalResult.error}`).toBe(true);
  }).toPass({ timeout: 5000 });
}

test.describe('D-YB4-3: Nutrition History Day Card Overlap Regression', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    void browser;
    userEmail = `yb4-overlap-${slug(testInfo.project.name)}-${testInfo.parallelIndex}@yourbody.fyi`;
    cleanupUser(userEmail);

    // Signup test account
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: userEmail,
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

    seedNutritionData(userId, userEmail);
  });

  test.afterAll(() => {
    cleanupUser(userEmail);
  });

  for (const viewport of [
    { width: 320, height: 800, label: '320px' },
    { width: 393, height: 852, label: '393px' },
    { width: 768, height: 1024, label: '768px' },
  ]) {
    test(`day card accordion non-overlap sequences at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginUser(page, userEmail);

      // Navigate to /history
      await page.goto('/history');
      await expect(page.locator('text=Workout History')).toBeVisible({ timeout: 10000 });

      // Switch to Nutrition tab
      const nutritionTab = page.locator('[data-testid="history-tab-nutrition"]');
      await expect(nutritionTab).toBeVisible({ timeout: 10000 });
      await nutritionTab.click();
      await expect(nutritionTab).toHaveAttribute('aria-selected', 'true');

      // Select range All
      const rangeAllBtn = page.locator('[data-testid="history-range-all"]');
      await expect(rangeAllBtn).toBeVisible({ timeout: 10000 });
      await rangeAllBtn.click();
      await expect(rangeAllBtn).toHaveAttribute('aria-pressed', 'true');

      // Assert VIRTUAL container is present (not the fallback list)
      await expect(page.locator('[data-testid="virtualizer-fallback-notice"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="nutrition-history-skeleton"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="nutrition-history-empty"]')).toHaveCount(0);

      const virtualCards = page.locator('[data-index]');
      await expect(virtualCards.first()).toBeVisible({ timeout: 10000 });
      const virtualContainer = virtualCards.first().locator('..');
      await expect(virtualContainer).toHaveCSS('position', 'relative');

      // Positive proof of virtualization:
      // (1) Fewer cards rendered than seeded days (windowing active; e.g. < 10 cards rendered)
      const renderedCardCount = await virtualCards.count();
      expect(renderedCardCount).toBeLessThan(10);
      expect(renderedCardCount).toBeGreaterThanOrEqual(2);

      // (2) Container total height exceeds sum of rendered card heights (scroll extent includes unrendered items)
      const virtualizationMetrics = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-index]'));
        const container = cards[0]?.parentElement;
        const containerH = container ? Math.round(container.getBoundingClientRect().height) : 0;
        const renderedSum = cards.reduce((sum, c) => sum + Math.round(c.getBoundingClientRect().height), 0);
        return { containerH, renderedSum, count: cards.length };
      });
      expect(virtualizationMetrics.containerH).toBeGreaterThan(virtualizationMetrics.renderedSum);

      // Measure collapsed card heights at this viewport (helps D-YB4-2)
      const initialHeights = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-index]'));
        return cards.slice(0, 3).map((c) => ({
          index: Number(c.getAttribute('data-index')),
          height: Math.round(c.getBoundingClientRect().height * 100) / 100,
        }));
      });
      console.log(`[MEASURED_COLLAPSED_HEIGHT] Viewport ${viewport.label}:`, JSON.stringify(initialHeights));

      // Assert initial collapsed geometry before interaction
      await assertDayCardGeometry(page, 'Initial collapsed state');

      // Deterministic card toggles: Card A (index 0), Card B (index 1)
      const toggleA = page.locator('[data-index="0"] button[data-testid^="expand-day-btn-"]');
      const toggleB = page.locator('[data-index="1"] button[data-testid^="expand-day-btn-"]');

      // (i) expand A, collapse A
      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (i) - expand A');

      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (i) - collapse A');

      // (ii) expand A, collapse A, expand B
      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (ii) - expand A');

      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (ii) - collapse A');

      await toggleB.click();
      await expect(toggleB).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (ii) - expand B');

      await toggleB.click();
      await expect(toggleB).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (ii) - collapse B reset');

      // (iii) expand A, expand B, collapse A
      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (iii) - expand A');

      await toggleB.click();
      await expect(toggleB).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (iii) - expand B');

      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (iii) - collapse A');

      await toggleB.click();
      await expect(toggleB).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (iii) - collapse B reset');

      // (iv) scroll down past a few cards and back, then toggle
      await page.evaluate(() => window.scrollTo(0, 450));
      await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await assertDayCardGeometry(page, 'Sequence (iv) - scrolled down');

      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
      await assertDayCardGeometry(page, 'Sequence (iv) - scrolled back top');

      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'true');
      await assertDayCardGeometry(page, 'Sequence (iv) - toggle expand A');

      await toggleA.click();
      await expect(toggleA).toHaveAttribute('aria-expanded', 'false');
      await assertDayCardGeometry(page, 'Sequence (iv) - toggle collapse A');

      // (v) range-change step: switch to '30d' and back to 'all', assert geometry holds
      const range30dBtn = page.locator('[data-testid="history-range-30d"]');
      await range30dBtn.click();
      await expect(range30dBtn).toHaveAttribute('aria-pressed', 'true');
      await assertDayCardGeometry(page, 'Sequence (v) - range change to 30d');

      await rangeAllBtn.click();
      await expect(rangeAllBtn).toHaveAttribute('aria-pressed', 'true');
      await assertDayCardGeometry(page, 'Sequence (v) - range change back to all');
    });
  }
});
