import { test, expect, type Page } from '@playwright/test';

/**
 * Measurement Debt Spec (NEW-11 & G2)
 *
 * Measures:
 * 1. NEW-11: StagedMealCard <select> rendered dimensions and typography
 *    against 44px touch-target and 16px iOS auto-zoom thresholds.
 * 2. G2: Non-text contrast (WCAG 2.2 SC 1.4.11, 3:1) across all visible
 *    element boundaries (borders and box-shadows) against nearest opaque ancestor.
 */

const UNICODE_MEAL = 'Açaí Bowl with Crème Brûlée & Jalapeño Poppers';

async function login(page: Page) {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
}

/** Deterministic analysis stub so no external Gemini runtime is needed. */
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

test.describe('Measurement Debt', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });
    await stubAnalysis(page);
    await login(page);
    await page.goto('/nutrition');
    await page.waitForSelector("text=Today's Nutrition");
  });

  for (const width of [320, 375] as const) {
    test(`measurement debt @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      expect(page.viewportSize()?.width).toBe(width);

      // Verify and prove that the browser DOM actually applied the requested viewport width
      const domMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
      }));
      expect(domMetrics.innerWidth).toBe(width);
      expect(domMetrics.clientWidth).toBeLessThanOrEqual(width);
      expect(domMetrics.clientWidth).toBeGreaterThanOrEqual(width - 20);

      await stageMeal(page);

      // =========================================================================
      // Measurement 1 — NEW-11, StagedMealCard <select>
      // =========================================================================
      const selectSelector = '[data-testid="staged-meal-card"] select[aria-label="Meal type"]';
      const select = page.locator(selectSelector);
      await expect(select).toBeVisible();

      const box = await select.boundingBox();
      if (!box) {
        throw new Error(`Bounding box was null for selector: ${selectSelector}`);
      }

      const widthPx = Number(box.width.toFixed(2));
      const heightPx = Number(box.height.toFixed(2));

      const computed = await select.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return {
          fontSize: cs.fontSize,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          borderTopWidth: cs.borderTopWidth,
          borderBottomWidth: cs.borderBottomWidth,
          borderLeftWidth: cs.borderLeftWidth,
          borderRightWidth: cs.borderRightWidth,
          lineHeight: cs.lineHeight,
          minHeight: cs.minHeight,
        };
      });

      const parsedFontSize = parseFloat(computed.fontSize);
      const meetsTarget44 = (widthPx >= 44 && heightPx >= 44) ? 'YES' : 'NO';
      const meetsFontSize16 = (parsedFontSize >= 16) ? 'YES' : 'NO';

      const payloadNEW11 = {
        item: 'NEW-11',
        viewport: width,
        clientWidth: domMetrics.clientWidth,
        width: widthPx,
        height: heightPx,
        meetsTarget44,
        fontSize: computed.fontSize,
        meetsFontSize16,
        computed: {
          fontSize: computed.fontSize,
          paddingTop: computed.paddingTop,
          paddingBottom: computed.paddingBottom,
          borderTopWidth: computed.borderTopWidth,
          borderBottomWidth: computed.borderBottomWidth,
          borderLeftWidth: computed.borderLeftWidth,
          borderRightWidth: computed.borderRightWidth,
          lineHeight: computed.lineHeight,
          minHeight: computed.minHeight,
        },
      };

      console.log(`MEASUREMENT_DEBT ${JSON.stringify(payloadNEW11)}`);

      // =========================================================================
      // Measurement 2 — G2, non-text contrast (WCAG 2.2 SC 1.4.11, 3:1)
      // =========================================================================
      const g2Results = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        let unparsedCount = 0;
        let totalEvaluated = 0;

        function parseColor(str: string): { r: number; g: number; b: number; a: number; valid: boolean } {
          const trimmed = str?.trim();
          if (!trimmed || trimmed === 'transparent' || trimmed === 'none' || trimmed === 'rgba(0, 0, 0, 0)' || trimmed === 'rgba(0,0,0,0)') {
            return { r: 0, g: 0, b: 0, a: 0, valid: true };
          }
          if (!ctx) return { r: 0, g: 0, b: 0, a: 0, valid: false };
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#010203';
          ctx.fillStyle = trimmed;
          const valid = ctx.fillStyle !== '#010203' || trimmed.toLowerCase() === '#010203';
          if (!valid) {
            return { r: 0, g: 0, b: 0, a: 0, valid: false };
          }
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a255] = ctx.getImageData(0, 0, 1, 1).data;
          return { r, g, b, a: a255 / 255, valid: true };
        }

        function sRgbToLinear(v: number): number {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        }

        function relativeLuminance(r: number, g: number, b: number): number {
          return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
        }

        function contrastRatio(l1: number, l2: number): number {
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        function composite(
          fg: { r: number; g: number; b: number; a: number },
          bg: { r: number; g: number; b: number }
        ): { r: number; g: number; b: number } {
          return {
            r: fg.r * fg.a + bg.r * (1 - fg.a),
            g: fg.g * fg.a + bg.g * (1 - fg.a),
            b: fg.b * fg.a + bg.b * (1 - fg.a),
          };
        }

        function getBackdrop(el: Element): {
          color: string;
          rgb: { r: number; g: number; b: number } | null;
          lum: number | null;
          indeterminate: boolean;
        } {
          let curr = el.parentElement;
          while (curr && curr !== document.documentElement) {
            const bg = window.getComputedStyle(curr).backgroundColor;
            const parsed = parseColor(bg);
            if (!parsed.valid) {
              unparsedCount++;
            } else if (parsed.a >= 0.999) {
              return {
                color: bg,
                rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
                lum: relativeLuminance(parsed.r, parsed.g, parsed.b),
                indeterminate: false,
              };
            }
            curr = curr.parentElement;
          }

          const bodyBg = window.getComputedStyle(document.body).backgroundColor;
          const bodyParsed = parseColor(bodyBg);
          if (!bodyParsed.valid) {
            unparsedCount++;
          } else if (bodyParsed.a >= 0.999) {
            return {
              color: bodyBg,
              rgb: { r: bodyParsed.r, g: bodyParsed.g, b: bodyParsed.b },
              lum: relativeLuminance(bodyParsed.r, bodyParsed.g, bodyParsed.b),
              indeterminate: false,
            };
          }

          const docBg = window.getComputedStyle(document.documentElement).backgroundColor;
          const docParsed = parseColor(docBg);
          if (!docParsed.valid) {
            unparsedCount++;
          } else if (docParsed.a >= 0.999) {
            return {
              color: docBg,
              rgb: { r: docParsed.r, g: docParsed.g, b: docParsed.b },
              lum: relativeLuminance(docParsed.r, docParsed.g, docParsed.b),
              indeterminate: false,
            };
          }

          return {
            color: 'transparent',
            rgb: null,
            lum: null,
            indeterminate: true,
          };
        }

        const candidates: Array<{
          element: string;
          sideOrShadow: string;
          color: string;
          backdropColor: string;
          ratio: number | null;
          indeterminate: boolean;
        }> = [];

        const elements = Array.from(document.querySelectorAll('*'));

        for (const el of elements) {
          if (['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE'].includes(el.tagName)) {
            continue;
          }

          const cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') {
            continue;
          }

          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) {
            continue;
          }

          const classNameRaw = typeof el.className === 'string'
            ? el.className
            : (el.getAttribute('class') || '');
          const classNameSnippet = classNameRaw.trim().slice(0, 60) || `<${el.tagName.toLowerCase()}>`;

          // 1. Check all four border sides
          const borderSides = [
            { side: 'top', width: parseFloat(cs.borderTopWidth) || 0, color: cs.borderTopColor, style: cs.borderTopStyle },
            { side: 'right', width: parseFloat(cs.borderRightWidth) || 0, color: cs.borderRightColor, style: cs.borderRightStyle },
            { side: 'bottom', width: parseFloat(cs.borderBottomWidth) || 0, color: cs.borderBottomColor, style: cs.borderBottomStyle },
            { side: 'left', width: parseFloat(cs.borderLeftWidth) || 0, color: cs.borderLeftColor, style: cs.borderLeftStyle },
          ];

          const activeBorders = borderSides.filter(
            (b) => b.width > 0 && b.style !== 'none' && b.style !== 'hidden'
          );

          if (activeBorders.length > 0) {
            const colorGroups = new Map<string, string[]>();
            for (const b of activeBorders) {
              const existing = colorGroups.get(b.color) || [];
              existing.push(b.side);
              colorGroups.set(b.color, existing);
            }

            for (const [colorStr, sides] of colorGroups.entries()) {
              const parsedColor = parseColor(colorStr);
              if (!parsedColor.valid) {
                unparsedCount++;
                continue;
              }
              if (parsedColor.a === 0) {
                continue;
              }

              totalEvaluated++;
              const backdrop = getBackdrop(el);
              const sideDescription = sides.length === 4
                ? 'border-all'
                : `border-${sides.join('-')}`;

              if (backdrop.indeterminate || !backdrop.rgb || backdrop.lum === null) {
                candidates.push({
                  element: classNameSnippet,
                  sideOrShadow: sideDescription,
                  color: colorStr,
                  backdropColor: backdrop.color,
                  ratio: null,
                  indeterminate: true,
                });
              } else {
                const blended = composite(parsedColor, backdrop.rgb);
                const borderLum = relativeLuminance(blended.r, blended.g, blended.b);
                const ratio = Number(contrastRatio(borderLum, backdrop.lum).toFixed(2));
                if (ratio < 3.0) {
                  candidates.push({
                    element: classNameSnippet,
                    sideOrShadow: sideDescription,
                    color: colorStr,
                    backdropColor: backdrop.color,
                    ratio,
                    indeterminate: false,
                  });
                }
              }
            }
          }

          // 2. Check box-shadow
          if (cs.boxShadow && cs.boxShadow !== 'none') {
            // Match color tokens in box-shadow (rgba, rgb, oklch, oklab, hsl, hex, etc.)
            const colorTokens = cs.boxShadow.match(/(?:rgba?|oklch|oklab|hsla?)\([^)]+\)|#[0-9a-f]{3,8}\b/gi);
            if (!colorTokens) {
              unparsedCount++;
            } else {
              for (const token of colorTokens) {
                const parsedShadow = parseColor(token);
                if (!parsedShadow.valid) {
                  unparsedCount++;
                  continue;
                }
                if (parsedShadow.a > 0) {
                  totalEvaluated++;
                  const backdrop = getBackdrop(el);
                  if (backdrop.indeterminate || !backdrop.rgb || backdrop.lum === null) {
                    candidates.push({
                      element: classNameSnippet,
                      sideOrShadow: 'shadow',
                      color: token,
                      backdropColor: backdrop.color,
                      ratio: null,
                      indeterminate: true,
                    });
                  } else {
                    const blended = composite(parsedShadow, backdrop.rgb);
                    const shadowLum = relativeLuminance(blended.r, blended.g, blended.b);
                    const ratio = Number(contrastRatio(shadowLum, backdrop.lum).toFixed(2));
                    if (ratio < 3.0) {
                      candidates.push({
                        element: classNameSnippet,
                        sideOrShadow: 'shadow',
                        color: token,
                        backdropColor: backdrop.color,
                        ratio,
                        indeterminate: false,
                      });
                    }
                  }
                  break;
                }
              }
            }
          }
        }

        return {
          totalEvaluated,
          unparsedCount,
          candidates,
        };
      });

      expect(g2Results.totalEvaluated).toBeGreaterThan(0);

      const payloadG2 = {
        item: 'G2',
        viewport: width,
        clientWidth: domMetrics.clientWidth,
        totalEvaluated: g2Results.totalEvaluated,
        unparsedCount: g2Results.unparsedCount,
        candidates: g2Results.candidates,
      };

      console.log(`MEASUREMENT_DEBT ${JSON.stringify(payloadG2)}`);
    });
  }
});
