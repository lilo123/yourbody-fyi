import { useMemo, useContext, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContextTypes';
import type { PrMode } from '../../lib/prComparator';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { WorkoutSet, Exercise, RoutineTemplate, TemplateExercise } from '../../types/database';
import {
  normalizeDateStr,
  DEFAULT_EXERCISES_LIST,
  DEFAULT_WORKOUT_TEMPLATES,
  getDayOfWeekAbbr,
  mergeBenchmarks,
  getLocalDateStr,
} from '../../utils/ghostSets';
import { formatSet } from '../../utils/weight';
import type { ExerciseBenchmarks } from '../../types/database';
import { isValidUUID, isDefaultRoutineHidden, isOwnOrAssignedRoutine } from './workoutEngineHelpers';
import { fetchAllVisibleExercises } from '../../lib/exercises';
import {
  applyPendingToDaySets,
  pendingSetsBefore,
  onSynced,
  offlineFallback,
  onPersistUserSwitch,
  getCurrentPersistingUserId,
  type OutboxOp,
} from '../../offline';
import { queryKeys } from '../../lib/queryKeys';
import { useWorkoutPendingOps } from './useWorkoutPendingOps';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { invalidateWorkoutDerived } from '../../lib/invalidate';

export const WORKOUT_WITH_SETS_PROJECTION =
  'id, date, name, sets(id, reps, weight, set_index, created_at, exercise_id, set_type, rpe)';

export const SETS_PAGE_LIMIT = 500;

/**
 * Per-workout cap for the coach cockpit's embedded `sets(...)`.
 *
 * `/coach` embeds sets across up to 100 workouts over ~90 days. PostgREST applies an
 * embedded limit *per parent row*, not across the response, so a "high" cap does
 * nothing: the pathological case is one enormous session, not many large ones.
 *
 * Measured against the payload-stress fixture (bench-athlete: 50 workouts, 598 sets in
 * 90 days, 500 of them in a single session) by issuing this exact query to PostgREST and
 * reading Content-Length. PostgREST answers identity even when the client offers gzip,
 * so these bytes are the bytes on the wire. `/coach` totals 57,422 B, of which this query
 * contributes 682 B for the test fixture, so the projection below is 56,740 B + embed:
 *
 *   uncapped ->  119,655 B embed -> /coach 176,395 B  OVER the 153,600 B ceiling
 *   cap 2000 ->  119,655 B embed -> /coach 176,395 B  OVER   (byte-identical to uncapped)
 *   cap  500 ->  119,655 B embed -> /coach 176,395 B  OVER   (byte-identical to uncapped)
 *   cap  200 ->   62,475 B embed -> /coach 119,215 B  under
 *   cap  100 ->   43,415 B embed -> /coach 100,155 B  under
 *   cap   50 ->   33,934 B embed -> /coach  90,674 B  under
 *
 * Caps of 500 and 2000 return byte-identical responses to no cap at all: no single
 * session exceeds 500, so they never bind. A "generous" cap is not a weak mitigation
 * here, it is no mitigation. 200 is the first value that changes anything.
 *
 * 200 is ~3x a heavy real session (a hard training day is 30-60 sets), so it should
 * never truncate genuine data, while cutting the one case that actually breaches the
 * ceiling today. If it ever does truncate, we say so rather than silently showing a
 * coach an incomplete history.
 *
 * This bounds the tail; it is NOT a hard guarantee. 100 workouts x 200 sets is still
 * far above the ceiling in principle. The structural fix is to stop embedding sets and
 * fetch them on expand, as `/history` already does via `fetchSessionSets` — the coach
 * timeline only needs counts and volumes while a session is collapsed. Tracked as W-10b.
 */
export const COACH_SETS_PER_WORKOUT_LIMIT = 200;

/**
 * Warn when the cockpit response was capped, or when it is large enough to be worth
 * noticing. Silence here would mean a coach reviews a partial history believing it
 * complete, which is the failure mode we care about most.
 */
export function warnIfCoachSetsTruncated(
  workouts: ReadonlyArray<{ id?: string; sets?: unknown[] | null }>
): void {
  const truncated = workouts.filter((w) => (w.sets?.length ?? 0) >= COACH_SETS_PER_WORKOUT_LIMIT);
  if (truncated.length > 0) {
    console.warn(
      `[CoachCockpit] ${truncated.length} session(s) hit the ${COACH_SETS_PER_WORKOUT_LIMIT}-set ` +
        `per-workout cap; those sessions are showing partial set detail. Session ids: ` +
        truncated.map((w) => w.id ?? '(unknown)').join(', ')
    );
  }
  const totalSets = workouts.reduce((acc, w) => acc + (w.sets?.length ?? 0), 0);
  if (totalSets > 2000) {
    console.warn(
      `[CoachCockpit] timeline embedded ${totalSets} sets across ${workouts.length} workouts. ` +
        `This route has a 153,600 B budget; see W-10b for the lazy-load fix.`
    );
  }
}

export interface RoutineTemplateDetail {
  id: string;
  exercises: TemplateExercise[];
}

export interface FetchTemplateDetailOptions {
  queryClient?: QueryClient;
  timeoutMs?: number;
  userId?: string | null;
}

export const DEFAULT_TEMPLATE_DETAIL_ONLINE_TIMEOUT_MS = 15000;
export const DEFAULT_TEMPLATE_DETAIL_OFFLINE_TIMEOUT_MS = 1500;
// Deprecated alias for backwards compatibility
export const DEFAULT_TEMPLATE_DETAIL_TIMEOUT_MS = DEFAULT_TEMPLATE_DETAIL_ONLINE_TIMEOUT_MS;
export const OFFLINE_TEMPLATE_DETAIL_TIMEOUT_MS = DEFAULT_TEMPLATE_DETAIL_OFFLINE_TIMEOUT_MS;
export const ROUTINE_TEMPLATE_DETAIL_KEY_PREFIX = 'routine_template_detail';

export function routineTemplateDetailQueryKey(templateId: string | null | undefined) {
  return queryKeys.routineTemplateDetail.byId(templateId);
}

const templateDetailMemoryCache = new Map<string, RoutineTemplateDetail>();

function getTemplateDetailCacheKey(templateId: string, userId?: string | null): string {
  return `${userId || 'anon'}:${templateId}`;
}

export function clearTemplateDetailCache(templateId?: string, userId?: string | null): void {
  if (templateId) {
    if (userId !== undefined) {
      templateDetailMemoryCache.delete(getTemplateDetailCacheKey(templateId, userId));
    } else {
      for (const key of templateDetailMemoryCache.keys()) {
        if (key.endsWith(`:${templateId}`) || key === templateId) {
          templateDetailMemoryCache.delete(key);
        }
      }
    }
  } else {
    templateDetailMemoryCache.clear();
  }
}

// Clear memory cache when persistController resets on user switch or sign-out
onPersistUserSwitch(() => {
  clearTemplateDetailCache();
});

async function fetchTemplateDetailFromNetwork(templateId: string): Promise<RoutineTemplateDetail | null> {
  // payload-gate: detail-fetch — template exercises and targets for resolved routine
  const { data, error } = await supabase
    .from('routine_templates')
    .select(
      'id, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))'
    )
    .eq('id', templateId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as RoutineTemplateDetail | null) ?? null;
}

export async function fetchTemplateDetail(
  templateId: string,
  optionsOrClient?: QueryClient | FetchTemplateDetailOptions
): Promise<RoutineTemplateDetail | null> {
  if (!templateId) return null;

  const client =
    optionsOrClient && 'getQueryData' in optionsOrClient
      ? (optionsOrClient as QueryClient)
      : (optionsOrClient as FetchTemplateDetailOptions)?.queryClient;

  const customTimeout =
    optionsOrClient && !('getQueryData' in optionsOrClient)
      ? (optionsOrClient as FetchTemplateDetailOptions)?.timeoutMs
      : undefined;

  const targetUserId =
    optionsOrClient && !('getQueryData' in optionsOrClient)
      ? (optionsOrClient as FetchTemplateDetailOptions)?.userId
      : undefined;

  const effectiveUserId = targetUserId ?? getCurrentPersistingUserId();
  const memCacheKey = getTemplateDetailCacheKey(templateId, effectiveUserId);

  const key = queryKeys.routineTemplateDetail.byId(templateId);
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  // 1. Offline path: cache-first
  if (isOffline) {
    if (client) {
      const cached = client.getQueryData<RoutineTemplateDetail>(key);
      if (cached !== undefined) return cached;
    }
    const memCached = templateDetailMemoryCache.get(memCacheKey);
    if (memCached !== undefined) return memCached;
  }

  // 2. Network attempt (online: network-first, offline: uncached fast-fail)
  const timeoutMs =
    customTimeout ??
    (isOffline
      ? DEFAULT_TEMPLATE_DETAIL_OFFLINE_TIMEOUT_MS
      : DEFAULT_TEMPLATE_DETAIL_ONLINE_TIMEOUT_MS);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Template detail fetch timed out after ${timeoutMs}ms for ${templateId}`));
    }, timeoutMs);
  });

  try {
    const detail = await Promise.race([
      fetchTemplateDetailFromNetwork(templateId),
      timeoutPromise,
    ]);
    if (detail) {
      if (client) {
        client.setQueryData(key, detail);
      }
      templateDetailMemoryCache.set(memCacheKey, detail);
    }
    return detail;
  } catch (error) {
    // When online and network fails or times out, fall back to cached detail if available
    if (!isOffline) {
      if (client) {
        const cached = client.getQueryData<RoutineTemplateDetail>(key);
        if (cached !== undefined) return cached;
      }
      const memCached = templateDetailMemoryCache.get(memCacheKey);
      if (memCached !== undefined) return memCached;
    }
    throw error;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export const workoutExercisesQueryOptions = {
  queryKey: ['exercises', 'workout'] as const,
  queryFn: async (): Promise<Exercise[]> => {
    const allExercises = await fetchAllVisibleExercises<Exercise>('id, name, body_parts, is_master', {
      isArchived: false,
    });
    if (allExercises.length === 0) return DEFAULT_EXERCISES_LIST;
    return allExercises;
  },
  staleTime: 5 * 60 * 1000,
};

/**
 * Pure function: applies pending operations (set.delete, set.update, workout.rename)
 * to historical/ghost server sets occurring before the active workout date.
 */
export function applyPendingToPriorServerSets(
  serverSets: (WorkoutSet & { workout_date: string; workout_name?: string })[],
  ops: OutboxOp[]
): (WorkoutSet & { workout_date: string; workout_name?: string; pending?: boolean })[] {
  const result: (WorkoutSet & { workout_date: string; workout_name?: string; pending?: boolean })[] =
    serverSets.map((item) => ({ ...item }));

  const sortedOps = [...ops].sort((first, second) => first.seq - second.seq);

  for (const op of sortedOps) {
    if (op.kind === 'set.update') {
      const { id, patch } = op.payload;
      const targetIndex = result.findIndex((item) => item.id === id);
      if (targetIndex !== -1) {
        result[targetIndex] = {
          ...result[targetIndex],
          ...patch,
          pending: true,
        };
      }
    } else if (op.kind === 'set.delete') {
      const { id } = op.payload;
      const targetIndex = result.findIndex((item) => item.id === id);
      if (targetIndex !== -1) {
        result.splice(targetIndex, 1);
      }
    } else if (op.kind === 'workout.rename') {
      const { workoutRef, name } = op.payload;
      for (let i = 0; i < result.length; i++) {
        if (result[i].workout_id === workoutRef) {
          result[i] = {
            ...result[i],
            workout_name: name,
            pending: true,
          };
        }
      }
    }
  }

  return result;
}

// UsePrMode added for
export function useWorkoutQueries(targetUserId: string, workoutDate: string) {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const pendingOps = useWorkoutPendingOps(targetUserId);

  useEffect(() => {
    const unsubscribe = onSynced(() => {
      invalidateWorkoutDerived(queryClient, targetUserId);
    });
    return unsubscribe;
  }, [queryClient, targetUserId]);

  const {
    data: exercises = DEFAULT_EXERCISES_LIST,
    isFetched: exercisesFetched,
    isError: isExercisesError,
    error: exercisesError,
  } = useQuery(workoutExercisesQueryOptions);

  const currentDayAbbr =
    getDayOfWeekAbbr(workoutDate) || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];

  const {
    data: rawTemplates = [],
    isFetched: rawTemplatesFetched,
    isError: rawTemplatesError,
  } = useQuery({
    queryKey: ['routine_templates', targetUserId, 'workout'],
    enabled: Boolean(targetUserId),
    queryFn: async () => {
      if (!targetUserId || !isValidUUID(targetUserId)) return [];

      if (typeof (supabase as any).rpc === 'function') {
        let allTemplates: RoutineTemplate[] = [];
        let cursor: string | null = null;
        let rpcFailed = false;

        while (true) {
          try {
            const rpcCall = (supabase as any).rpc('get_routine_catalog', {
              p_user_id: targetUserId,
              p_limit: 200,
              p_cursor: cursor,
            });
            const query =
              typeof rpcCall?.select === 'function'
                ? rpcCall.select('id,user_id,name,is_master,assigned_to,days_of_week,created_at')
                : rpcCall;
            const { data: rpcData, error: rpcError }: any = await query;
            if (rpcError) {
              console.warn('[useWorkoutQueries] get_routine_catalog RPC warning:', rpcError);
              rpcFailed = true;
              break;
            }
            if (!rpcData || rpcData.length === 0) {
              break;
            }
            allTemplates.push(...(rpcData as RoutineTemplate[]));
            if (rpcData.length < 200) {
              break;
            }
            cursor = rpcData[rpcData.length - 1].id;
          } catch (err) {
            console.warn('[useWorkoutQueries] get_routine_catalog RPC warning:', err);
            rpcFailed = true;
            break;
          }
        }

        if (!rpcFailed) {
          return allTemplates;
        }
      }

      const filterString = `user_id.eq.${targetUserId},is_master.eq.true,assigned_to.eq.${targetUserId}`;

      // accepted-list: routine templates metadata on /workout
      const { data, error } = await supabase
        .from('routine_templates')
        .select('id, user_id, name, is_master, assigned_to, days_of_week, created_at')
        .or(filterString)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data) return [];
      return (data as RoutineTemplate[]).sort((a, b) => {
        const getScore = (t: RoutineTemplate) => {
          if (t.assigned_to === targetUserId && !t.is_master) return 3;
          if (t.user_id === targetUserId && !t.is_master) return 2;
          if (t.is_master) return 1;
          return 0;
        };
        const diff = getScore(b) - getScore(a);
        if (diff !== 0) return diff;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
    },
  });

  const {
    data: rawUserLogs = [],
    isFetched: logsFetched,
    isError: isLogsError,
    error: logsError,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ['workout_sets', targetUserId, workoutDate],
    enabled: Boolean(targetUserId),
    placeholderData: () =>
      typeof navigator !== 'undefined' && !navigator.onLine
        ? offlineFallback<(WorkoutSet & { workout_date: string; workout_name?: string })[]>(
            queryClient,
            ['workout_sets', targetUserId]
          )
        : undefined,
    queryFn: async () => {
      if (!targetUserId || !isValidUUID(targetUserId)) return [];

      // Query 1: Today's workout session and sets
      const targetDate = workoutDate || getLocalDateStr(new Date());
      const startOfDay = `${targetDate}T00:00:00.000Z`;
      const endOfDay = `${targetDate}T23:59:59.999Z`;

      // payload-gate: accepted-list — today workout session and sets, measured 95311 B on /workout (500-set stress session; bounded to a single day; sets embed capped at SETS_PAGE_LIMIT). Source: docs/evidence/perf-trace-results.json (route /workout, the workouts+sets query), reproduced identically across every run. Cite that retained path, never a runId: this file is in scripts/perf-payload-sources.json, so editing this comment changes the fingerprint and retires the run whose id was written here — a runId citation can never converge. Was 122311 B before dropping the redundant workout_id from the embed.
      const { data: workoutsData, error: wError } = await supabase
        .from('workouts')
        .select(WORKOUT_WITH_SETS_PROJECTION)
        .eq('user_id', targetUserId)
        .gte('date', startOfDay)
        .lte('date', endOfDay)
        .order('date', { ascending: false })
        .limit(SETS_PAGE_LIMIT, { foreignTable: 'sets' })
        .limit(5);

      if (wError) throw wError;

      let currentExercises =
        queryClient.getQueryData<Exercise[]>(workoutExercisesQueryOptions.queryKey) || exercises;
      if (!currentExercises || currentExercises === DEFAULT_EXERCISES_LIST || currentExercises.length === 0) {
        try {
          currentExercises = await queryClient.ensureQueryData(workoutExercisesQueryOptions);
        } catch {
          currentExercises = exercises;
        }
      }

      const todaySets: (WorkoutSet & { workout_date: string; workout_name?: string })[] = [];
      if (workoutsData && workoutsData.length > 0) {
        const hasEmbeddedSets = workoutsData.some((w) => Array.isArray(w.sets));
        if (hasEmbeddedSets || workoutsData.every((w) => w.sets !== undefined)) {
          if (workoutsData.some((w) => Array.isArray(w.sets) && w.sets.length >= SETS_PAGE_LIMIT)) {
            console.warn(
              `[useWorkoutQueries] today workout sets query reached cap of ${SETS_PAGE_LIMIT} rows; older historical sets may be truncated.`
            );
          }

          const setsData = workoutsData.flatMap((w) =>
            (w.sets || []).map((s) => ({
              ...s,
              // See the matching note in CoachCockpit.tsx. `workout_id` is no longer in
              // WORKOUT_WITH_SETS_PROJECTION, so `s.workout_id` is statically absent and the old
              // `s.workout_id || w.id` is dead. The worker's `(s as { workout_id?: string })` cast was
              // rejected: silencing TS2339 by asserting a property the projection removed is exactly the
              // kind of unverifiable claim this programme exists to eliminate. These sets are embedded
              // under `w`, so `w.id` is not a fallback — it is the value.
              workout_id: w.id,
              workouts: { date: w.date, name: w.name },
            }))
          );

          setsData.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

          todaySets.push(
            ...setsData.map((s) => ({
              ...s,
              set_index: s.set_index ?? 0,
              set_type: (s as any).set_type || 'working',
              weight: s.weight ?? 0,
              workout_date: normalizeDateStr(s.workouts?.date || s.created_at),
              workout_name: s.workouts?.name || 'Workout Session',
              exercise_name:
                (s as any).exercise?.name ||
                currentExercises.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
                DEFAULT_EXERCISES_LIST.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
                (s as { exercise_name?: string }).exercise_name ||
                s.exercise_id,
            }))
          );
        } else {
          const workoutIds = workoutsData.map((w) => w.id);
          if (workoutIds.length > 0) {
            const { data: setsData, error: sError } = await supabase
              .from('sets')
              .select(
                'id, workout_id, exercise_id, weight, reps, set_index, created_at, set_type, rpe, workouts(date, name), exercise:exercises(id, name, body_parts)'
              )
              .in('workout_id', workoutIds)
              .order('created_at', { ascending: false })
              .limit(SETS_PAGE_LIMIT);

            if (sError) throw sError;
            if (setsData) {
              if (setsData.length >= SETS_PAGE_LIMIT) {
                console.warn(
                  `[useWorkoutQueries] today workout sets query reached cap of ${SETS_PAGE_LIMIT} rows; older historical sets may be truncated.`
                );
              }

              const sortedSets = [...setsData].sort(
                (a, b) =>
                  (a.created_at || '').localeCompare(b.created_at || '') ||
                  (a.set_index ?? 0) - (b.set_index ?? 0)
              );

              todaySets.push(
                ...sortedSets.map((s) => ({
                  ...s,
                  set_index: s.set_index ?? 0,
                  set_type: (s as any).set_type || 'working',
                  weight: s.weight ?? 0,
                  workout_date: normalizeDateStr(s.workouts?.date || s.created_at),
                  workout_name: s.workouts?.name || 'Workout Session',
                  exercise_name:
                    s.exercise?.name ||
                    currentExercises.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
                    DEFAULT_EXERCISES_LIST.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
                    (s as { exercise_name?: string }).exercise_name ||
                    s.exercise_id,
                }))
              );
            }
          }
        }
      }

      // Query 2: Ghost sets RPC for prior sessions (within 90 days)
      let ghostSets: (WorkoutSet & { workout_date: string; workout_name?: string })[] = [];
      if (typeof (supabase as any).rpc === 'function') {
        const { data: ghostData, error: ghostErr } = await (supabase as any).rpc('get_ghost_sets', {
          p_user_id: targetUserId,
          p_date: targetDate,
        });
        if (ghostErr) {
          console.warn('[useWorkoutQueries] get_ghost_sets RPC warning:', ghostErr);
        } else if (ghostData && Array.isArray(ghostData)) {
          ghostSets = ghostData.map((s: any) => ({
            ...s,
            set_index: s.set_index ?? 0,
            set_type: (s as any).set_type || 'working',
            weight: s.weight ?? 0,
            workout_date: normalizeDateStr(s.workout_date || s.created_at),
            workout_name: s.workout_name || 'Workout Session',
            exercise_name:
              s.exercise_name ||
              currentExercises.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
              DEFAULT_EXERCISES_LIST.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
              s.exercise_id,
          }));
        }
      }

      const combinedSets = [...todaySets, ...ghostSets];
      queryClient.setQueryData(['workout_sets', targetUserId, '90d'], combinedSets);
      return combinedSets;
    },
  });

  const auth = useContext(AuthContext);
  const prMode: PrMode = auth?.profile?.pr_mode === 'e1rm' ? 'e1rm' : 'weight';

  const todaySets = useMemo(() => {
    const rawToday = rawUserLogs.filter((s) => normalizeDateStr(s.workout_date) === workoutDate);
    const overlaid = applyPendingToDaySets(rawToday, pendingOps, workoutDate);
    return overlaid.map((s) => ({
      ...s,
      workout_date: s.workout_date || workoutDate,
      exercise_name:
        s.exercise_name ||
        (s as any).exercise?.name ||
        exercises.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
        DEFAULT_EXERCISES_LIST.find((e) => e.id === s.exercise_id || e.name === s.exercise_id)?.name ||
        s.exercise_id,
    }));
  }, [rawUserLogs, pendingOps, workoutDate, exercises]);

  const userLogs = useMemo(() => {
    const priorPending = pendingSetsBefore(workoutDate, pendingOps).map((item) => ({
      ...item,
      exercise_name:
        item.exercise_name ||
        (item as any).exercise?.name ||
        exercises.find((ex) => ex.id === item.exercise_id || ex.name === item.exercise_id)?.name ||
        DEFAULT_EXERCISES_LIST.find((ex) => ex.id === item.exercise_id || ex.name === item.exercise_id)?.name ||
        item.exercise_id,
    }));
    const rawPrior = rawUserLogs.filter(
      (item) => normalizeDateStr(item.workout_date) !== workoutDate
    );
    const overlaidPrior = applyPendingToPriorServerSets(rawPrior, pendingOps);
    const priorPendingIds = new Set(priorPending.map((item) => item.id));
    const priorServer = overlaidPrior
      .filter((item) => !priorPendingIds.has(item.id))
      .map((item) => ({
        ...item,
        exercise_name:
          exercises.find((ex) => ex.id === item.exercise_id || ex.name === item.exercise_id)?.name ||
          DEFAULT_EXERCISES_LIST.find((ex) => ex.id === item.exercise_id || ex.name === item.exercise_id)?.name ||
          (item as any).exercise?.name ||
          item.exercise_name ||
          item.exercise_id,
      }));
    return [...todaySets, ...priorPending, ...priorServer];
  }, [todaySets, workoutDate, pendingOps, rawUserLogs, exercises]);

  const exerciseIds = useMemo(() => {
    return exercises
      .filter((e) => isValidUUID(e.id))
      .map((e) => e.id)
      .sort();
  }, [exercises]);

  const {
    data: rawBenchmarks = {},
    isFetched: benchmarksFetched,
    isError: isBenchmarksError,
    error: benchmarksError,
  } = useQuery({
    queryKey: ['exercise_benchmarks', targetUserId, workoutDate, exerciseIds, prMode],
    enabled: Boolean(targetUserId && isValidUUID(targetUserId) && exerciseIds.length > 0),
    placeholderData: () =>
      typeof navigator !== 'undefined' && !navigator.onLine
        ? offlineFallback<Record<string, ExerciseBenchmarks>>(queryClient, [
            'exercise_benchmarks',
            targetUserId,
          ])
        : undefined,
    queryFn: async (): Promise<Record<string, ExerciseBenchmarks>> => {
      if (!targetUserId || !isValidUUID(targetUserId) || exerciseIds.length === 0) {
        return {};
      }
      if (typeof (supabase as any).rpc !== 'function') {
        return {};
      }
      const res = await (supabase as any).rpc('get_exercise_benchmarks', {
        p_user_id: targetUserId,
        p_date: workoutDate,
        p_exercise_ids: exerciseIds,
        p_pr_mode: prMode,
      });
      if (!res) return {};
      const { data, error } = res;
      if (error) {
        console.warn('[useWorkoutQueries] get_exercise_benchmarks RPC warning:', error);
        return {};
      }
      const benchmarksMap: Record<string, ExerciseBenchmarks> = {};
      if (data && Array.isArray(data)) {
        for (const row of data as any[]) {
          if (!row.exercise_id) continue;
          const hasPR = row.pr_weight != null && row.pr_reps != null;
          const pr = hasPR
            ? {
                weight: Number(row.pr_weight),
                reps: Number(row.pr_reps),
                date: row.pr_date || '',
                e1rm: row.pr_e1rm != null ? Number(row.pr_e1rm) : undefined,
              }
            : null;

          let lastSession: ExerciseBenchmarks['lastSession'] = null;
          if (row.last_date && Array.isArray(row.last_sets) && row.last_sets.length > 0) {
            const sets: WorkoutSet[] = row.last_sets.map((s: any) => ({
              id: s.id,
              workout_id: row.last_workout_id || '',
              exercise_id: row.exercise_id,
              weight: Number(s.weight) || 0,
              reps: Number(s.reps) || 0,
              set_index: s.set_index ?? 0,
              set_type: s.set_type || 'working',
              rpe: s.rpe ?? null,
            }));
            const summaryText = sets.map((s) => formatSet(s.weight, s.reps)).join(', ');
            lastSession = {
              date: row.last_date,
              summaryText,
              sets,
            };
          }

          benchmarksMap[row.exercise_id] = {
            pr,
            lastSession,
          };
        }
      }
      return benchmarksMap;
    },
  });

  const benchmarks = useMemo(() => {
    return mergeBenchmarks(rawBenchmarks, userLogs, prMode);
  }, [rawBenchmarks, userLogs, prMode]);

  const resolvedTemplateId = useMemo(() => {
    if (!rawTemplatesFetched || !logsFetched) return null;
    if (todaySets.length > 0) {
      const loggedName = todaySets[0]?.workout_name || (todaySets[0] as any)?.workouts?.name || '';
      const normLoggedName = loggedName.trim().toLowerCase();
      const matched = rawTemplates.find((t) => {
        const tNorm = t.name.trim().toLowerCase();
        return (
          tNorm === normLoggedName ||
          (normLoggedName.length > 0 &&
            (tNorm.startsWith(normLoggedName) || normLoggedName.startsWith(tNorm)))
        );
      });
      return matched ? matched.id : null;
    }
    const dayAbbr = getDayOfWeekAbbr(workoutDate) || currentDayAbbr;
    const scheduledOwn = rawTemplates.find(
      (t) => isOwnOrAssignedRoutine(t, targetUserId) && t.days_of_week?.includes(dayAbbr)
    );
    const scheduled = scheduledOwn || rawTemplates.find((t) => t.days_of_week?.includes(dayAbbr));
    return scheduled ? scheduled.id : null;
  }, [rawTemplates, rawTemplatesFetched, todaySets, logsFetched, workoutDate, currentDayAbbr]);

  const { data: templateDetail, isFetched: detailFetched } = useQuery({
    queryKey: queryKeys.routineTemplateDetail.byId(resolvedTemplateId),
    enabled: Boolean(resolvedTemplateId),
    queryFn: async () => {
      if (!resolvedTemplateId) return null;
      return fetchTemplateDetail(resolvedTemplateId, { queryClient, userId: targetUserId });
    },
  });

  const customTemplates = useMemo(() => {
    if (!resolvedTemplateId || !templateDetail) return rawTemplates;
    return rawTemplates.map((t) => {
      if (t.id === resolvedTemplateId) {
        return {
          ...t,
          exercises: templateDetail.exercises,
        };
      }
      return t;
    });
  }, [rawTemplates, resolvedTemplateId, templateDetail]);

  const isTestDummy = Boolean(targetUserId && !isValidUUID(targetUserId));

  const hasCachedData = Boolean(
    targetUserId &&
      isValidUUID(targetUserId) &&
      queryClient.getQueryData(['routine_templates', targetUserId, 'workout'])
  );

  const hasCatalogLoaded = isTestDummy
    ? customTemplates.some((t) => t.is_master)
    : Boolean(
        targetUserId &&
          isValidUUID(targetUserId) &&
          (rawTemplatesFetched || hasCachedData)
      );

  const isCatalogPending = isTestDummy
    ? false
    : Boolean(
        targetUserId &&
          isValidUUID(targetUserId) &&
          !hasCatalogLoaded &&
          isOnline &&
          !rawTemplatesError &&
          !rawTemplatesFetched
      );

  const templatesFetched = isTestDummy
    ? rawTemplatesFetched && logsFetched && (!resolvedTemplateId || detailFetched)
    : hasCatalogLoaded && logsFetched && (!resolvedTemplateId || detailFetched);

  const { data: hiddenTemplates = [] } = useQuery({
    queryKey: ['routine_templates', targetUserId, 'hidden'],
    enabled: Boolean(targetUserId && isValidUUID(targetUserId)),
    queryFn: async () => {
      if (!targetUserId || !isValidUUID(targetUserId)) return [];
      if (typeof (supabase as any).rpc === 'function') {
        try {
          const { data, error } = await (supabase.rpc as any)('get_hidden_routine_templates', {
            p_user_id: targetUserId,
          });
          if (error) {
            console.warn('[useWorkoutQueries] get_hidden_routine_templates RPC warning:', error);
            return [];
          }
          return ((data || []) as unknown) as RoutineTemplate[];
        } catch (err) {
          console.warn('[useWorkoutQueries] get_hidden_routine_templates RPC warning:', err);
          return [];
        }
      }
      return [];
    },
  });

  const hiddenRoutineNames = useMemo(() => {
    const names = new Set<string>();
    for (const template of hiddenTemplates) {
      if (template?.name) names.add(template.name.trim().toLowerCase());
    }
    return names;
  }, [hiddenTemplates]);

  const availableRoutines = useMemo(() => {
    const seenCustomNames = new Set<string>();
    const dedupedCustom: RoutineTemplate[] = [];
    for (const template of customTemplates) {
      const norm = template.name.trim().toLowerCase();
      if (!seenCustomNames.has(norm)) {
        seenCustomNames.add(norm);
        dedupedCustom.push(template);
      }
    }

    const canUseDefaults = !isCatalogPending;

    const fallbackDefaults = canUseDefaults
      ? DEFAULT_WORKOUT_TEMPLATES.filter(
          (defaultTemplate) =>
            !seenCustomNames.has(defaultTemplate.name.trim().toLowerCase()) &&
            !isDefaultRoutineHidden(
              defaultTemplate.name,
              customTemplates,
              hiddenRoutineNames,
              hasCatalogLoaded,
              targetUserId
            )
        )
      : [];

    return {
      custom: dedupedCustom,
      defaults: fallbackDefaults,
    };
  }, [customTemplates, hasCatalogLoaded, isCatalogPending, hiddenRoutineNames, targetUserId]);

  return {
    exercises,
    exercisesFetched,
    isExercisesError,
    exercisesError,
    benchmarks,
    benchmarksFetched,
    isBenchmarksError,
    benchmarksError,
    customTemplates,
    templatesFetched,
    hasCatalogLoaded,
    isCatalogPending,
    hiddenRoutineNames,
    hiddenTemplates,
    userLogs,
    todaySets,
    logsFetched,
    availableRoutines,
    isLogsError,
    logsError,
    refetchLogs,
    isOnline,
  };
}
