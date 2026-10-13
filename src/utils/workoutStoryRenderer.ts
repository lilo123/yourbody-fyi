import type { WorkoutStoryData } from './workoutStorySummary';
import {
  STORY_CANVAS_WIDTH,
  STORY_CANVAS_HEIGHT,
  drawRoundedRect,
  fitText,
  drawStoryBackground,
  drawStoryFooter,
  canvasToBlob,
} from './storyCanvasHelpers';

export function renderWorkoutStory(canvas: HTMLCanvasElement, data: WorkoutStoryData): void {
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
  ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#22d3ee'; // cyan-400
  ctx.fillText('YOURBODY.FYI', marginX, currentY);

  // Civil Date
  currentY += 50;
  if (data.dateFormatted) {
    ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#a1a1aa'; // zinc-400
    ctx.fillText(data.dateFormatted.toUpperCase(), marginX, currentY);
    currentY += 60;
  } else {
    currentY += 20;
  }

  // Workout / Routine Name
  ctx.font = '700 68px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#f4f4f5'; // zinc-100 / white
  const fittedTitle = fitText(ctx, data.title, contentWidth);
  ctx.fillText(fittedTitle, marginX, currentY);
  currentY += 60;

  // 3. Stats Row (Total Volume & Total Sets)
  const statBoxY = currentY + 10;
  const statGap = 20;
  const statBoxWidth = (contentWidth - statGap) / 2; // 466 px
  const statBoxHeight = 140;

  // Volume Stat Box
  drawRoundedRect(ctx, marginX, statBoxY, statBoxWidth, statBoxHeight, 20);
  ctx.fillStyle = '#18181b'; // surface-card
  ctx.fill();
  ctx.strokeStyle = '#27272a'; // border-subtle
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText('TOTAL VOLUME', marginX + 28, statBoxY + 46);

  ctx.font = '700 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#fbbf24'; // amber-400
  const fittedVolume = fitText(ctx, data.totalVolumeFormatted, statBoxWidth - 56);
  ctx.fillText(fittedVolume, marginX + 28, statBoxY + 104);

  // Sets Stat Box
  const setsBoxX = marginX + statBoxWidth + statGap;
  drawRoundedRect(ctx, setsBoxX, statBoxY, statBoxWidth, statBoxHeight, 20);
  ctx.fillStyle = '#18181b';
  ctx.fill();
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText('TOTAL SETS', setsBoxX + 28, statBoxY + 46);

  ctx.font = '700 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#22d3ee'; // cyan-400
  const setsText = `${data.totalSets} completed`;
  const fittedSets = fitText(ctx, setsText, statBoxWidth - 56);
  ctx.fillText(fittedSets, setsBoxX + 28, statBoxY + 104);

  currentY = statBoxY + statBoxHeight + 50;

  // 4. Exercise Highlights Section Header
  ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#71717a'; // zinc-500
  ctx.fillText('EXERCISES', marginX, currentY);
  currentY += 24;

  // 5. Exercises List (up to 6)
  const cardHeight = 132;
  const cardGap = 16;

  for (let idx = 0; idx < data.exercises.length; idx++) {
    const ex = data.exercises[idx];
    const cardY = currentY;

    // Card background
    drawRoundedRect(ctx, marginX, cardY, contentWidth, cardHeight, 18);
    ctx.fillStyle = '#18181b'; // surface-card
    ctx.fill();
    ctx.strokeStyle = '#27272a'; // border-subtle
    ctx.lineWidth = 2;
    ctx.stroke();

    // Index circle indicator
    const indexX = marginX + 24;
    const indexCenterY = cardY + cardHeight / 2;
    ctx.beginPath();
    ctx.arc(indexX + 16, indexCenterY, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#27272a';
    ctx.fill();

    ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#22d3ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(idx + 1), indexX + 16, indexCenterY);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Best Set Pill on Right
    ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const bestSetText = ex.bestSetFormatted;
    const bestSetMetrics = ctx.measureText(bestSetText);
    const pillPaddingX = 24;
    const pillWidth = Math.min(bestSetMetrics.width + pillPaddingX * 2, 400);
    const pillHeight = 60;
    const pillX = marginX + contentWidth - pillWidth - 24;
    const pillY = cardY + (cardHeight - pillHeight) / 2;

    drawRoundedRect(ctx, pillX, pillY, pillWidth, pillHeight, 14);
    ctx.fillStyle = '#27272a'; // surface-elevated
    ctx.fill();
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#22d3ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fittedPillText = fitText(ctx, bestSetText, pillWidth - 20);
    ctx.fillText(fittedPillText, pillX + pillWidth / 2, pillY + pillHeight / 2);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Exercise Name (Left, bounded by pillX)
    const textStartX = indexX + 54;
    const availableNameWidth = pillX - textStartX - 24;

    ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#f4f4f5';
    const fittedName = fitText(ctx, ex.name, availableNameWidth);
    ctx.fillText(fittedName, textStartX, cardY + 56);

    // Set count subtext
    ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(`${ex.setCount} set${ex.setCount === 1 ? '' : 's'} logged`, textStartX, cardY + 98);

    currentY += cardHeight + cardGap;
  }

  // If there were more than 6 exercises:
  if (data.overflowCount > 0) {
    currentY += 8;
    ctx.font = '600 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#71717a';
    ctx.textAlign = 'center';
    ctx.fillText(
      `+${data.overflowCount} more exercise${data.overflowCount > 1 ? 's' : ''}`,
      540,
      currentY
    );
    ctx.textAlign = 'left';
  }

  // 6. Wordmark Footer at bottom
  drawStoryFooter(ctx, width, 1850);
}

export async function renderWorkoutStoryToBlob(data: WorkoutStoryData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderWorkoutStory(canvas, data);
  return canvasToBlob(canvas);
}
