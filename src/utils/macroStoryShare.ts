import type { NutritionDaySummary } from '../components/history/NutritionHistoryTimeline';
import type { UserProfile } from '../types/database';
import type { ToastOptions } from '../hooks/useToast';
import { buildMacroStoryData, type MacroStoryData } from './macroStorySummary';

export interface ShareMacroStoryDeps {
  renderToBlob?: (data: MacroStoryData) => Promise<Blob>;
}

export async function shareMacroStory(
  day: NutritionDaySummary,
  profile: Partial<UserProfile> | null | undefined,
  showToast: (options: ToastOptions) => void,
  deps?: ShareMacroStoryDeps
): Promise<void> {
  try {
    // 1. Build summary data (pure function)
    const storyData = buildMacroStoryData({
      date: day.date,
      totals: day.totals,
      targets: profile,
      meals: day.meals,
    });

    // 2. Lazy-load renderer via dynamic import on tap so entry chunk remains small
    let blob: Blob;
    if (deps?.renderToBlob) {
      blob = await deps.renderToBlob(storyData);
    } else {
      const { renderMacroStoryToBlob } = await import('./macroStoryRenderer');
      blob = await renderMacroStoryToBlob(storyData);
    }

    if (!blob) {
      throw new Error('Image generation yielded null blob');
    }

    const dateSlug = (day.date || 'nutrition').slice(0, 10);
    const filename = `nutrition-${dateSlug}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    // 3. Share or fallback to download
    const canShare =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });

    if (canShare) {
      try {
        await navigator.share({
          files: [file],
          title: storyData.title,
        });
      } catch (shareError: unknown) {
        if (shareError instanceof Error && shareError.name === 'AbortError') {
          // User cancel is silent
          return;
        }
        throw shareError;
      }
    } else {
      // Fallback: download the PNG
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
    }
  } catch (caughtError: unknown) {
    if (caughtError instanceof Error && caughtError.name === 'AbortError') {
      return;
    }
    showToast({
      message: 'Failed to share day',
      kind: 'info',
    });
  }
}
