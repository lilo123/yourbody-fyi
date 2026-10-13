import type { MacroStoryData } from './macroStorySummary';
import {
  STORY_CANVAS_WIDTH,
  STORY_CANVAS_HEIGHT,
  drawRoundedRect,
  fitText,
  drawStoryBackground,
  drawStoryFooter,
  canvasToBlob,
} from './storyCanvasHelpers';

interface MacroGridItem {
  label: string;
  color: string;
  current: string;
  target: string | null;
  percentage: number | null;
}

export function renderMacroStory(canvas: HTMLCanvasElement, data: MacroStoryData): void {
  const width = STORY_CANVAS_WIDTH;
  const height = STORY_CANVAS_HEIGHT;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not obtain 2D canvas context');

  // 1. Dark Base Background & ambient glow (#09090b + cyan)
  drawStoryBackground(ctx, width, height, 'rgba(6, 182, 212, 0.12)');

  const marginX = 64;
  const contentWidth = width - marginX * 2; // 952 px

  // 2. Header Area
  let currentY = 120;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#22d3ee'; // cyan-400
  ctx.fillText('YOURBODY.FYI', marginX, currentY);

  // Date
  currentY += 50;
  if (data.dateFormatted) {
    ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#a1a1aa'; // zinc-400
    ctx.fillText(data.dateFormatted.toUpperCase(), marginX, currentY);
    currentY += 60;
  } else {
    currentY += 20;
  }

  // Title
  ctx.font = '700 68px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#f4f4f5'; // zinc-100
  const fittedTitle = fitText(ctx, data.title, contentWidth);
  ctx.fillText(fittedTitle, marginX, currentY);
  currentY += 40;

  // 3. Calorie Hero Card
  const heroY = currentY;
  const heroHeight = 160;

  drawRoundedRect(ctx, marginX, heroY, contentWidth, heroHeight, 22);
  ctx.fillStyle = '#18181b';
  ctx.fill();
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText('CALORIES', marginX + 32, heroY + 44);

  ctx.font = '700 52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#fbbf24'; // amber-400
  ctx.fillText(data.calories.currentFormatted, marginX + 32, heroY + 106);

  if (data.calories.target !== null && data.calories.targetFormatted) {
    // Goal text right aligned
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#a1a1aa';
    ctx.textAlign = 'right';
    ctx.fillText(`Goal: ${data.calories.targetFormatted}`, marginX + contentWidth - 32, heroY + 46);
    ctx.textAlign = 'left';

    // Percentage pill on right
    const pillWidth = 110;
    const pillHeight = 48;
    const pillX = marginX + contentWidth - pillWidth - 32;
    const pillY = heroY + 68;

    drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 14);
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${data.calories.percentage}%`, pillX + pillWidth / 2, pillY + pillHeight / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Thin progress bar
    const barX = marginX + 32;
    const barY = heroY + heroHeight - 16;
    const barWidth = contentWidth - 64;
    const barHeight = 6;
    drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 3);
    ctx.fillStyle = '#27272a';
    ctx.fill();

    const fillRatio = Math.min(1, Math.max(0, (data.calories.percentage || 0) / 100));
    if (fillRatio > 0) {
      drawRoundedRect(ctx, barX, barY, barWidth * fillRatio, barHeight, 3);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
    }
  } else {
    // Subtext when no target configured
    ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#71717a';
    const mealsLoggedText = `${data.totalMealsCount} logged meal${data.totalMealsCount === 1 ? '' : 's'}`;
    ctx.fillText(mealsLoggedText, marginX + 32, heroY + 140);
  }

  currentY = heroY + heroHeight + 20;

  // 4. Macro 4-Grid (2x2)
  const macroItems: MacroGridItem[] = [
    {
      label: 'PROTEIN',
      color: '#22d3ee', // cyan-400
      current: data.protein.currentFormatted,
      target: data.protein.targetFormatted,
      percentage: data.protein.percentage,
    },
    {
      label: 'CARBS',
      color: '#34d399', // emerald-400
      current: data.carbs.currentFormatted,
      target: data.carbs.targetFormatted,
      percentage: data.carbs.percentage,
    },
    {
      label: 'FAT',
      color: '#a78bfa', // violet-400
      current: data.fat.currentFormatted,
      target: data.fat.targetFormatted,
      percentage: data.fat.percentage,
    },
    {
      label: 'FIBER',
      color: '#2dd4bf', // teal-400
      current: data.fiber.currentFormatted,
      target: data.fiber.targetFormatted,
      percentage: data.fiber.percentage,
    },
  ];

  const gridGap = 16;
  const boxWidth = (contentWidth - gridGap) / 2; // 468 px
  const boxHeight = 126;

  for (let index = 0; index < macroItems.length; index++) {
    const item = macroItems[index];
    const rowIndex = Math.floor(index / 2);
    const colIndex = index % 2;
    const boxX = marginX + colIndex * (boxWidth + gridGap);
    const boxY = currentY + rowIndex * (boxHeight + gridGap);

    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 18);
    ctx.fillStyle = '#18181b';
    ctx.fill();
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, boxX + 24, boxY + 38);

    // Percentage on top right if target present
    if (item.percentage !== null) {
      ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = item.color;
      ctx.textAlign = 'right';
      ctx.fillText(`${item.percentage}%`, boxX + boxWidth - 24, boxY + 38);
      ctx.textAlign = 'left';
    }

    // Current amount
    ctx.font = '700 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#f4f4f5';
    ctx.fillText(item.current, boxX + 24, boxY + 84);

    // Target comparison if target present
    if (item.target) {
      ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#a1a1aa';
      const currentWidth = ctx.measureText(item.current).width;
      ctx.fillText(` / ${item.target}`, boxX + 24 + currentWidth + 6, boxY + 84);

      // Micro progress bar
      const barX = boxX + 24;
      const barY = boxY + boxHeight - 14;
      const barWidth = boxWidth - 48;
      const barHeight = 5;

      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 3);
      ctx.fillStyle = '#27272a';
      ctx.fill();

      const fillRatio = Math.min(1, Math.max(0, (item.percentage ?? 0) / 100));
      if (fillRatio > 0) {
        drawRoundedRect(ctx, barX, barY, barWidth * fillRatio, barHeight, 3);
        ctx.fillStyle = item.color;
        ctx.fill();
      }
    }
  }

  currentY = currentY + 2 * boxHeight + gridGap + 40;

  // 5. Meals Section Header
  ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#71717a';
  ctx.fillText('MEALS', marginX, currentY);
  currentY += 28;

  // 6. Meals List (up to 6)
  const mealHeight = 90;
  const mealGap = 12;

  if (data.meals.length === 0) {
    drawRoundedRect(ctx, marginX, currentY, contentWidth, 90, 18);
    ctx.fillStyle = '#18181b';
    ctx.fill();
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No meals logged for this day', marginX + contentWidth / 2, currentY + 45);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    currentY += 90;
  } else {
    for (let index = 0; index < data.meals.length; index++) {
      const meal = data.meals[index];
      const mealY = currentY;

      drawRoundedRect(ctx, marginX, mealY, contentWidth, mealHeight, 18);
      ctx.fillStyle = '#18181b';
      ctx.fill();
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Index circle indicator
      const indexX = marginX + 24;
      const indexCenterY = mealY + mealHeight / 2;
      ctx.beginPath();
      ctx.arc(indexX + 16, indexCenterY, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#27272a';
      ctx.fill();

      ctx.font = '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), indexX + 16, indexCenterY);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Calorie Pill on Right
      ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const kcalText = meal.caloriesFormatted;
      const kcalMetrics = ctx.measureText(kcalText);
      const pillPaddingX = 20;
      const pillWidth = Math.min(kcalMetrics.width + pillPaddingX * 2, 260);
      const pillHeight = 50;
      const pillX = marginX + contentWidth - pillWidth - 20;
      const pillY = mealY + (mealHeight - pillHeight) / 2;

      drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 14);
      ctx.fillStyle = '#27272a';
      ctx.fill();
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fittedKcal = fitText(ctx, kcalText, pillWidth - 16);
      ctx.fillText(fittedKcal, pillX + pillWidth / 2, pillY + pillHeight / 2);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Meal Name (bounded by pillX)
      const textStartX = indexX + 50;
      const availableNameWidth = pillX - textStartX - 20;

      ctx.font = '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#f4f4f5';
      const fittedName = fitText(ctx, meal.name, availableNameWidth);
      ctx.fillText(fittedName, textStartX, mealY + 54);

      currentY += mealHeight + mealGap;
    }
  }

  // Overflow text if more than 6 meals
  if (data.overflowCount > 0) {
    currentY += 10;
    ctx.font = '600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'center';
    ctx.fillText(
      `+${data.overflowCount} more meal${data.overflowCount > 1 ? 's' : ''}`,
      540,
      currentY
    );
    ctx.textAlign = 'left';
  }

  // 7. Wordmark Footer
  drawStoryFooter(ctx, width, 1850);
}

export async function renderMacroStoryToBlob(data: MacroStoryData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderMacroStory(canvas, data);
  return canvasToBlob(canvas);
}
