/**
 * Shared canvas drawing helpers for on-device story card rendering.
 * Shared between workoutStoryRenderer and macroStoryRenderer.
 */

export const STORY_CANVAS_WIDTH = 1080;
export const STORY_CANVAS_HEIGHT = 1920;

/**
 * Draws a rounded rectangle path on the 2D canvas context.
 */
export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Truncates text with an ellipsis so that ctx.measureText(text).width <= maxWidth.
 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length > 0 ? truncated.trimEnd() + '…' : '…';
}

/**
 * Draws the base dark background and top ambient glow.
 */
export function drawStoryBackground(
  ctx: CanvasRenderingContext2D,
  width = STORY_CANVAS_WIDTH,
  height = STORY_CANVAS_HEIGHT,
  glowColor = 'rgba(6, 182, 212, 0.12)'
): void {
  // Base dark background (#09090b)
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient radial glow near top center
  const glow = ctx.createRadialGradient(width / 2, 180, 50, width / 2, 180, 600);
  glow.addColorStop(0, glowColor);
  glow.addColorStop(1, 'rgba(9, 9, 11, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, 800);
}

/**
 * Draws the centered branding wordmark at the bottom.
 */
export function drawStoryFooter(
  ctx: CanvasRenderingContext2D,
  width = STORY_CANVAS_WIDTH,
  y = 1850
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#71717a';
  ctx.fillText('yourbody.fyi', width / 2, y);
}

/**
 * Exports canvas to PNG blob.
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Canvas toBlob failed'));
      }
    }, 'image/png');
  });
}
