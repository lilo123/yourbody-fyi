import type { HistorySession } from '../components/history/useWorkoutHistory';
import type { Exercise } from '../types/database';
import type { WeightUnit } from './weight';
import type { ToastOptions } from '../hooks/useToast';
import type { PrMode } from '../lib/prComparator';
import { fetchSessionSets } from '../components/history/useWorkoutHistory';
import { buildWorkoutStoryData, type WorkoutStoryData } from './workoutStorySummary';

export interface ShareWorkoutStoryDeps {
  renderToBlob?: (data: WorkoutStoryData) => Promise<Blob>;
  prMode?: PrMode;
}

export async function shareWorkoutStory(
  session: HistorySession,
  exercises: Exercise[],
  unit: WeightUnit,
  showToast: (options: ToastOptions) => void,
  deps?: ShareWorkoutStoryDeps,
  prMode?: PrMode
): Promise<void> {
  try {
    const resolvedPrMode: PrMode = prMode === 'e1rm' || deps?.prMode === 'e1rm' ? 'e1rm' : 'weight';

    // 1. Fetch sets if not already loaded on session
    let sets = session.sets;
    if (!sets || sets.length === 0) {
      try {
        sets = await fetchSessionSets(session.id);
      } catch {
        // Fall back to empty sets if fetch fails
        sets = [];
      }
    }

    // 2. Build summary data (pure function)
    const storyData = buildWorkoutStoryData({
      sessionName: session.name,
      workoutDate: session.civil_date || session.workout_date || session.date,
      sets: sets || [],
      exercises,
      unit,
      totalVolume: session.total_volume,
      setCount: session.set_count,
      prMode: resolvedPrMode,
    });

    // 3. Lazy-load renderer (dynamic import on tap) so entry chunk does not grow
    let blob: Blob;
    if (deps?.renderToBlob) {
      blob = await deps.renderToBlob(storyData);
    } else {
      const { renderWorkoutStoryToBlob } = await import('./workoutStoryRenderer');
      blob = await renderWorkoutStoryToBlob(storyData);
    }

    if (!blob) {
      throw new Error('Image generation yielded null blob');
    }

    const dateSlug = (session.civil_date || session.workout_date || 'story').slice(0, 10);
    const filename = `workout-${dateSlug}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    // 4. Share or fallback to download
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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancel is silent
          return;
        }
        throw err;
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
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return;
    }
    showToast({
      message: 'Failed to share workout',
      kind: 'info',
    });
  }
}
