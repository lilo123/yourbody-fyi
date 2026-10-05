import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');

interface GeometryMeasurement {
  imgWidth: number;
  imgHeight: number;
  firstCyanCol: number;
  lastCyanCol: number;
  minCyanRow: number;
  maxCyanRow: number;
  indicatorLeftCol: number;
  rightRefCol: number;
  leftGapPx: number;
  rightGapPx: number;
  gapDiffPx: number;
}

async function safeGoto(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  } catch {
    await page.goto(url);
  }
}

async function loginAsAthlete(page: Page): Promise<void> {
  await safeGoto(page, '/login');
  await page.fill('input[type="email"]', 'athlete@yourbody.fyi');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/workout');
}

function analyzeDateInputGeometry(
  imageBuffer: Buffer,
  deviceScaleFactor: number
): GeometryMeasurement {
  const png = PNG.sync.read(imageBuffer);
  const cyanCols: number[] = [];
  const cyanRows: number[] = [];

  // Exclude 2px border on each side scaled by device pixel ratio to prevent border antialiasing
  const borderPx = Math.round(2 * deviceScaleFactor);
  const innerLeftCol = borderPx;
  const innerRightCol = png.width - borderPx;
  const innerTopRow = borderPx;
  const innerBottomRow = png.height - borderPx;

  for (let row = innerTopRow; row < innerBottomRow; row++) {
    for (let col = innerLeftCol; col < innerRightCol; col++) {
      const offset = (row * png.width + col) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];

      // Cyan date text: #22d3ee (R: 34, G: 211, B: 238)
      if (alpha > 128 && blue > 150 && green > 150 && red < 120) {
        cyanCols.push(col);
        cyanRows.push(row);
      }
    }
  }

  if (cyanCols.length === 0 || cyanRows.length === 0) {
    throw new Error(`No cyan text pixels detected in screenshot (${png.width}x${png.height})`);
  }

  const firstCyanCol = Math.min(...cyanCols);
  const lastCyanCol = Math.max(...cyanCols);
  const minCyanRow = Math.min(...cyanRows);
  const maxCyanRow = Math.max(...cyanRows);

  // Search for non-cyan bright cluster (calendar picker indicator) to the right of text
  let indicatorLeftCol = -1;
  for (let col = lastCyanCol + 1; col < innerRightCol; col++) {
    let brightPixelCount = 0;
    for (let row = minCyanRow; row <= maxCyanRow; row++) {
      const offset = (row * png.width + col) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];

      if (alpha > 128 && red > 120 && green > 120 && blue > 120) {
        brightPixelCount++;
      }
    }
    if (brightPixelCount >= 2) {
      indicatorLeftCol = col;
      break;
    }
  }

  const rightRefCol = indicatorLeftCol !== -1 ? indicatorLeftCol : innerRightCol;
  const leftGapPx = Number(((firstCyanCol - innerLeftCol) / deviceScaleFactor).toFixed(1));
  const rightGapPx = Number(((rightRefCol - lastCyanCol) / deviceScaleFactor).toFixed(1));
  const gapDiffPx = Number(Math.abs(leftGapPx - rightGapPx).toFixed(1));

  return {
    imgWidth: png.width,
    imgHeight: png.height,
    firstCyanCol,
    lastCyanCol,
    minCyanRow,
    maxCyanRow,
    indicatorLeftCol,
    rightRefCol,
    leftGapPx,
    rightGapPx,
    gapDiffPx,
  };
}

test.describe('YB5: Nutrition date-pill centring geometry', () => {
  const VIEWPORT_WIDTHS = [320, 393] as const;

  for (const viewportWidth of VIEWPORT_WIDTHS) {
    test(`nutrition date input value is centred at ${viewportWidth}px viewport`, async ({
      page,
    }, testInfo) => {
      await loginAsAthlete(page);
      await safeGoto(page, '/nutrition');
      await expect(page.locator("text=Today's Nutrition")).toBeVisible();

      await page.setViewportSize({ width: viewportWidth, height: 800 });

      const dateInput = page.locator('[data-testid="nutrition-date-input"]');
      await expect(dateInput).toBeVisible();

      await expect.poll(async () => {
        const box = await dateInput.boundingBox();
        return box?.width ?? 0;
      }).toBeGreaterThan(0);

      // Use a fixed date so digit and glyph counts are identical across runs
      await dateInput.fill('2026-10-04');
      await expect(dateInput).toHaveValue('2026-10-04');
      await dateInput.blur();

      const boundingBox = await dateInput.boundingBox();
      expect(boundingBox).not.toBeNull();

      const shotBuffer = await dateInput.screenshot();
      await testInfo.attach(`nutrition-date-input-${viewportWidth}`, {
        body: shotBuffer,
        contentType: 'image/png',
      });

      const deviceScaleFactor = await page.evaluate(() => window.devicePixelRatio || 1);
      const measurement = analyzeDateInputGeometry(shotBuffer, deviceScaleFactor);

      // Verify measurement sanity: image dimensions scale with devicePixelRatio and element box
      const expectedImgWidth = Math.round((boundingBox?.width ?? 0) * deviceScaleFactor);
      expect(Math.abs(measurement.imgWidth - expectedImgWidth)).toBeLessThanOrEqual(Math.ceil(deviceScaleFactor));
      const borderPx = Math.round(2 * deviceScaleFactor);
      expect(measurement.firstCyanCol).toBeGreaterThanOrEqual(borderPx);
      expect(measurement.lastCyanCol).toBeLessThan(measurement.imgWidth - borderPx);
      expect(measurement.rightRefCol).toBeGreaterThan(measurement.lastCyanCol);

      console.log(
        `[YB5-GEOMETRY] project=${testInfo.project.name} width=${viewportWidth} ` +
          `leftGap=${measurement.leftGapPx}px rightGap=${measurement.rightGapPx}px ` +
          `diff=${measurement.gapDiffPx}px firstCyan=${measurement.firstCyanCol} ` +
          `lastCyan=${measurement.lastCyanCol} rightRef=${measurement.rightRefCol} ` +
          `imgW=${measurement.imgWidth} dsf=${deviceScaleFactor}`
      );

      // Centring requirement: |leftGap - rightGap| <= 4px
      expect(
        measurement.gapDiffPx,
        `width=${viewportWidth} project=${testInfo.project.name} ` +
          `leftGap=${measurement.leftGapPx}px rightGap=${measurement.rightGapPx}px ` +
          `firstCyan=${measurement.firstCyanCol} lastCyan=${measurement.lastCyanCol} ` +
          `rightRef=${measurement.rightRefCol} imgW=${measurement.imgWidth}`
      ).toBeLessThanOrEqual(4);
    });
  }
});
