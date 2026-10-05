import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  fetchExerciseCatalogPage,
  encodeCatalogCursor,
  type CatalogExercise,
} from '../lib/exercises';
import { fetchTemplateDetail } from '../components/workout/useWorkoutQueries';
import type { RoutineTemplate } from '../types/database';
import { isDbClosedError } from '../offline/db';

export const PREFETCH_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12 hours
export const PREFETCH_STORAGE_KEY_PREFIX = 'offline_prefetch_';

export function scheduleIdle(
  callback: () => void,
  timeoutMs = 2000
): { cancel: () => void } {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: timeoutMs });
    return {
      cancel: () => window.cancelIdleCallback(id),
    };
  }
  const id = setTimeout(callback, Math.min(timeoutMs, 1000));
  return {
    cancel: () => clearTimeout(id),
  };
}

export async function prefetchAllExercises(_userId?: string): Promise<CatalogExercise[]> {
  const all: CatalogExercise[] = [];
  let cursor: string | null = null;
  while (true) {
    if (typeof (supabase as any).rpc === 'function') {
      try {
        const rpcCall = (supabase as any).rpc('get_exercise_catalog', {
          p_search: null,
          p_scope: 'all',
          p_equipment: null,
          p_include_hidden: false,
          p_limit: 200,
          p_cursor: cursor,
        });
        const query =
          typeof rpcCall?.select === 'function'
            ? rpcCall.select('id, name, body_parts, equipment, is_master, user_id')
            : rpcCall;
        const res = await query;
        if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
          const rows = res.data as CatalogExercise[];
          all.push(...rows);
          if (rows.length < 200) break;
          const lastRow = rows[rows.length - 1];
          cursor = encodeCatalogCursor(lastRow.name, lastRow.id);
          continue;
        }
      } catch (err) {
        console.warn('[offlinePrefetch] get_exercise_catalog RPC select failed, falling back:', err);
      }
    }
    const page = await fetchExerciseCatalogPage({
      scope: 'all',
      limit: 200,
      cursor,
    });
    if (!page.items || page.items.length === 0) break;
    all.push(...page.items);
    if (!page.nextCursor || page.items.length < 200) break;
    cursor = page.nextCursor;
  }
  return all;
}

export async function prefetchRoutineCatalog(userId: string): Promise<RoutineTemplate[]> {
  if (typeof (supabase as any).rpc === 'function') {
    let allTemplates: RoutineTemplate[] = [];
    let cursor: string | null = null;
    let rpcFailed = false;

    while (true) {
      try {
        const rpcCall = (supabase as any).rpc('get_routine_catalog', {
          p_user_id: userId,
          p_limit: 200,
          p_cursor: cursor,
        });
        const query =
          typeof rpcCall?.select === 'function'
            ? rpcCall.select('id, user_id, name, is_master, assigned_to, days_of_week, created_at')
            : rpcCall;
        const res: any = await query;

        if (!res || res.error) {
          rpcFailed = true;
          break;
        }

        const pageData: any = res.data;
        if (!pageData || !Array.isArray(pageData) || pageData.length === 0) break;

        const mapped: RoutineTemplate[] = pageData.map((row: any) => ({
          id: row.id,
          user_id: row.user_id,
          name: row.name,
          is_master: row.is_master,
          assigned_to: row.assigned_to,
          days_of_week: row.days_of_week,
          created_at: row.created_at,
        }));
        allTemplates.push(...mapped);
        if (pageData.length < 200) break;
        cursor = pageData[pageData.length - 1].created_at;
      } catch (err) {
        console.warn('[offlinePrefetch] get_routine_catalog RPC failed, falling back:', err);
        rpcFailed = true;
        break;
      }
    }

    if (!rpcFailed) return allTemplates;
  }

  // REST fallback
  const filterParts = [`is_master.eq.true`];
  if (userId) {
    filterParts.push(`user_id.eq.${userId}`);
    filterParts.push(`assigned_to.eq.${userId}`);
  }
  const { data, error } = await supabase
    .from('routine_templates')
    .select('id, user_id, name, is_master, assigned_to, days_of_week, created_at')
    .or(filterParts.join(','))
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || []) as RoutineTemplate[];
}

export async function prefetchCustomDishes(userId: string): Promise<any[]> {
  // payload-gate: detail-fetch — prefetch full custom dishes with items and ingredients for offline caching
  const { data, error } = await supabase
    .from('custom_dishes')
    .select(
      'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes, items, ingredients'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data || []) as any[];
}

export async function runOfflinePrefetch(
  queryClient: QueryClient,
  userId: string,
  force = false
): Promise<boolean> {
  if (!userId) return false;

  const storageKey = `${PREFETCH_STORAGE_KEY_PREFIX}${userId}`;
  if (!force && typeof localStorage !== 'undefined') {
    try {
      const lastPrefetch = localStorage.getItem(storageKey);
      if (lastPrefetch) {
        const elapsed = Date.now() - Number(lastPrefetch);
        if (elapsed < PREFETCH_THROTTLE_MS) {
          return false;
        }
      }
    } catch (err) {
      console.warn('[offlinePrefetch] failed reading localStorage throttle in runOfflinePrefetch:', err);
    }
  }

  try {
    // 1. Exercise Catalog: Reuse already-cached catalog if available
    const existingCatalog =
      queryClient.getQueryData(['exercise_catalog', 'offline_all', userId]) ||
      queryClient.getQueryData(['exercise_catalog', 'offline_all']);
    if (!existingCatalog || (Array.isArray(existingCatalog) && existingCatalog.length === 0)) {
      const exercises = await prefetchAllExercises(userId);
      queryClient.setQueryData(['exercise_catalog', 'offline_all', userId], exercises);
      queryClient.setQueryData(['exercise_catalog', 'offline_all'], exercises);
    } else {
      queryClient.setQueryData(['exercise_catalog', 'offline_all', userId], existingCatalog);
      queryClient.setQueryData(['exercise_catalog', 'offline_all'], existingCatalog);
    }

    // 2. Routine Catalog: Reuse already-cached routine templates if available
    let templates = queryClient.getQueryData([
      'routine_templates',
      userId,
      'workout',
    ]) as RoutineTemplate[] | undefined;
    if (!templates || !Array.isArray(templates) || templates.length === 0) {
      templates = await prefetchRoutineCatalog(userId);
      queryClient.setQueryData(['routine_templates', userId, 'workout'], templates);
    }

    // 3. Template Details (own / recent, cap 60): Batch fetch uncached templates
    const templatesToFetch = (templates || [])
      .filter((t) => t.user_id === userId || t.is_master)
      .slice(0, 60);

    const uncachedTemplates = templatesToFetch.filter(
      (t) => !queryClient.getQueryData(['routine_template_detail', t.id])
    );

    if (uncachedTemplates.length > 0) {
      const ids = uncachedTemplates.map((t) => t.id);
      let batchedSuccess = false;
      try {
        // payload-gate: detail-fetch — batched template exercises and targets for offline prefetch
        const fromCall = (supabase as any)?.from?.('routine_templates');
        if (fromCall?.select) {
          const { data, error } = await fromCall
            .select(
              'id, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))'
            )
            .in('id', ids)
            .limit(60);

          if (!error && Array.isArray(data)) {
            for (const item of data) {
              queryClient.setQueryData(['routine_template_detail', item.id], item);
            }
            batchedSuccess = true;
          }
        }
      } catch (err) {
        console.warn('[offlinePrefetch] batch routine template detail fetch failed, falling back:', err);
      }

      if (!batchedSuccess) {
        await Promise.all(
          uncachedTemplates.map((t) =>
            queryClient.prefetchQuery({
              queryKey: ['routine_template_detail', t.id],
              queryFn: () => fetchTemplateDetail(t.id),
              staleTime: 1000 * 60 * 60,
            })
          )
        );
      }
    }

    // 4. Exercise Stats: Reuse already-cached stats from screen if available
    if (typeof (supabase as any).rpc === 'function') {
      const cachedWeightStats =
        queryClient.getQueryData(['exercise_stats', userId, 'weight']) ||
        queryClient.getQueryData(['exercise_stats', userId]);

      if (cachedWeightStats) {
        queryClient.setQueryData(['exercise_stats', userId, 'weight'], cachedWeightStats);
      }

      const cachedE1rmStats = queryClient.getQueryData(['exercise_stats', userId, 'e1rm']);

      const statsPromises: Promise<unknown>[] = [];
      if (!cachedWeightStats) {
        statsPromises.push(
          queryClient.prefetchQuery({
            queryKey: ['exercise_stats', userId, 'weight'],
            queryFn: async () => {
              const { data } = await (supabase as any).rpc('get_exercise_stats', {
                p_user_id: userId,
              });
              return data || [];
            },
            staleTime: 1000 * 60 * 60,
          })
        );
      }
      if (!cachedE1rmStats) {
        statsPromises.push(
          queryClient.prefetchQuery({
            queryKey: ['exercise_stats', userId, 'e1rm'],
            queryFn: async () => {
              const { data } = await (supabase as any).rpc('get_exercise_stats', {
                p_user_id: userId,
                p_pr_mode: 'e1rm',
              });
              return data || [];
            },
            staleTime: 1000 * 60 * 60,
          })
        );
      }
      if (statsPromises.length > 0) {
        await Promise.all(statsPromises);
      }
    }

    // 5. Custom Dishes: Prefetch full custom dishes (with items, ingredients) for offline use into 'full' cache
    const existingDishes = queryClient.getQueryData(['custom_dishes', userId, 'full']);
    if (!existingDishes || (Array.isArray(existingDishes) && existingDishes.length === 0)) {
      try {
        const dishes = await prefetchCustomDishes(userId);
        queryClient.setQueryData(['custom_dishes', userId, 'full'], dishes);
      } catch (dishErr) {
        console.warn('[offlinePrefetch] custom dishes prefetch failed, continuing:', dishErr);
      }
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageKey, String(Date.now()));
      } catch (err) {
        console.warn('[offlinePrefetch] failed writing localStorage throttle:', err);
      }
    }
    return true;
  } catch (err) {
    // Offline prefetch write may fail if DB is closing during teardown; absorb closed-DB, warn otherwise
    if (!isDbClosedError(err)) {
      console.warn('[useOfflinePrefetch] prefetch failed:', err);
    }
    return false;
  }
}

export const PREFETCH_INITIAL_DELAY_MS = 1500;
export const PREFETCH_SETTLE_DELAY_MS = 2000;

export const offlinePrefetchOps = {
  runOfflinePrefetch,
};

export function useOfflinePrefetch(userId?: string | null): void {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isOnline || !userId) return;

    // Check 12-hour cadence
    const storageKey = `${PREFETCH_STORAGE_KEY_PREFIX}${userId}`;
    if (typeof localStorage !== 'undefined') {
      try {
        const lastPrefetch = localStorage.getItem(storageKey);
        if (lastPrefetch) {
          const elapsed = Date.now() - Number(lastPrefetch);
          if (elapsed < PREFETCH_THROTTLE_MS) {
            return;
          }
        }
      } catch (err) {
        console.warn('[offlinePrefetch] failed reading localStorage throttle in hook:', err);
      }
    }

    let cancelled = false;
    let attempted = false;
    let cancelSchedule: (() => void) | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeCache: (() => void) | null = null;

    const cleanupTimersAndListeners = () => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (cancelSchedule) {
        cancelSchedule();
        cancelSchedule = null;
      }
      if (unsubscribeCache) {
        unsubscribeCache();
        unsubscribeCache = null;
      }
    };

    const execute = async () => {
      if (cancelled || attempted || runningRef.current) return;
      runningRef.current = true;
      attempted = true;
      cleanupTimersAndListeners();
      try {
        await offlinePrefetchOps.runOfflinePrefetch(queryClient, userId);
      } catch (err) {
        // Prefetch execute error: absorb closed-DB during unmount/teardown, warn otherwise
        if (!cancelled && !isDbClosedError(err)) {
          console.warn('[offlinePrefetch] execute failed:', err);
        }
      } finally {
        runningRef.current = false;
        cleanupTimersAndListeners();
      }
    };

    const scheduleOnIdle = () => {
      if (cancelled || attempted) return;
      const scheduled = scheduleIdle(() => {
        if (cancelled || attempted) return;
        if (queryClient.isFetching() > 0) {
          return;
        }
        execute();
      }, 2000);
      cancelSchedule = scheduled.cancel;
    };

    const resetSettleTimer = (delayMs: number) => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (cancelled || attempted) return;
      settleTimer = setTimeout(() => {
        if (cancelled || attempted) return;
        if (queryClient.isFetching() === 0) {
          scheduleOnIdle();
        }
      }, delayMs);
    };

    // Initial settle timer to allow route chunk download and initial queries to mount
    resetSettleTimer(PREFETCH_INITIAL_DELAY_MS + PREFETCH_SETTLE_DELAY_MS);

    // Subscribe to TanStack Query cache events
    unsubscribeCache = queryClient.getQueryCache().subscribe(() => {
      if (cancelled || attempted) return;
      if (queryClient.isFetching() > 0) {
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
      } else {
        resetSettleTimer(PREFETCH_SETTLE_DELAY_MS);
      }
    });

    return () => {
      cancelled = true;
      cleanupTimersAndListeners();
    };
  }, [isOnline, userId, queryClient]);
}
