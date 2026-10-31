import type { HistorySession, HistorySet } from '../components/history/useWorkoutHistory';
import type { Exercise, WorkoutSet } from '../types/database';
import type { WeightUnit } from './weight';
import type { ToastOptions } from '../hooks/useToast';
import type { PrMode } from '../lib/prComparator';
import type { QueryClient } from '@tanstack/react-query';
import { fetchSessionSets } from '../components/history/useWorkoutHistory';
import { buildWorkoutStoryData, type WorkoutStoryData } from './workoutStorySummary';

export interface ShareWorkoutStoryDeps {
  renderToBlob?: (data: WorkoutStoryData) => Promise<Blob>;
  prMode?: PrMode;
  cachedSets?: (WorkoutSet & { exercise_name?: string })[];
  queryClient?: QueryClient;
  fetchSessionSets?: (workoutId: string) => Promise<HistorySet[]>;
}

export function getCachedSetsFromQueryClient(
  queryClient: QueryClient,
  sessionId: string
): HistorySet[] | null {
  const direct = queryClient.getQueryData<HistorySet[]>(['session_sets', sessionId]);
  if (direct && Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  const allSessionQueries = queryClient.getQueriesData<HistorySet[]>({
    queryKey: ['session_sets'],
  });
  for (const [key, data] of allSessionQueries) {
    if (key[1] === sessionId && Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  const allWorkoutQueries = queryClient.getQueriesData<unknown>({
    queryKey: ['workout_sets'],
  });
  for (const [, queryData] of allWorkoutQueries) {
    if (Array.isArray(queryData)) {
      const matching = queryData.filter(
        (candidateSet: any) => candidateSet && candidateSet.workout_id === sessionId
      );
      if (matching.length > 0) {
        return matching as HistorySet[];
      }
    }
  }

  return null;
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

    // 1. Resolve sets: use session.sets, cached sets from deps, query cache, or network fetch
    let sets = session.sets;
    if (!sets || sets.length === 0) {
      if (deps?.cachedSets && deps.cachedSets.length > 0) {
        sets = deps.cachedSets as HistorySet[];
      } else if (deps?.queryClient) {
        const cached = getCachedSetsFromQueryClient(deps.queryClient, session.id);
        if (cached && cached.length > 0) {
          sets = cached;
        }
      }
    }

    if (!sets || sets.length === 0) {
      const isOfflineOnly = session.id.startsWith('offline-');
      if (!isOfflineOnly) {
        try {
          const fetcher = deps?.fetchSessionSets || fetchSessionSets;
          sets = await fetcher(session.id);
        } catch {
          // Network failure: fall back to cached sets before empty array
          if (deps?.cachedSets && deps.cachedSets.length > 0) {
            sets = deps.cachedSets as HistorySet[];
          } else if (deps?.queryClient) {
            const cached = getCachedSetsFromQueryClient(deps.queryClient, session.id);
            sets = cached && cached.length > 0 ? cached : [];
          } else {
            sets = [];
          }
        }
      } else {
        if (deps?.cachedSets && deps.cachedSets.length > 0) {
          sets = deps.cachedSets as HistorySet[];
        } else if (deps?.queryClient) {
          const cached = getCachedSetsFromQueryClient(deps.queryClient, session.id);
          sets = cached && cached.length > 0 ? cached : [];
        } else {
          sets = [];
        }
      }
    }

    if (!sets || sets.length === 0) {
      if (deps?.cachedSets && deps.cachedSets.length > 0) {
        sets = deps.cachedSets as HistorySet[];
      } else if (deps?.queryClient) {
        const cached = getCachedSetsFromQueryClient(deps.queryClient, session.id);
        if (cached && cached.length > 0) {
          sets = cached;
        }
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
