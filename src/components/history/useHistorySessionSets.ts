import { useState, useEffect, useCallback, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { fetchSessionSets, type HistorySession, type HistorySet } from './useWorkoutHistory';
import { useWorkoutPendingOps } from '../workout/useWorkoutPendingOps';
import type { WorkoutSet } from '../../types/database';

export interface UseHistorySessionSetsOptions {
  targetUserId: string;
  sessions: HistorySession[];
  queryClient: QueryClient;
}

function normalizeCachedSet(set: WorkoutSet | HistorySet, sessionId: string): HistorySet {
  return {
    ...set,
    id: set.id || '',
    workout_id: set.workout_id || sessionId,
    exercise_id: set.exercise_id,
    weight: Number(set.weight) || 0,
    reps: Number(set.reps) || 0,
    set_index: set.set_index ?? 0,
    set_type: (set.set_type as WorkoutSet['set_type']) || 'working',
    rpe: set.rpe ?? null,
    workout_date: set.workout_date || '',
    workout_name: set.workout_name || '',
    created_at: set.created_at || '',
  };
}

function findCachedSessionSets(
  queryClient: QueryClient,
  sessionId: string,
  session?: HistorySession,
  targetUserId?: string,
  sessionDate?: string
): HistorySet[] | null {
  const direct = queryClient.getQueryData<HistorySet[]>(['session_sets', sessionId]);
  if (direct && Array.isArray(direct)) {
    if (direct.length > 0 || session?.set_count === 0) {
      return direct;
    }
  }

  if (session?.sets && session.sets.length > 0) {
    const matching = session.sets.filter((set) => !set.workout_id || set.workout_id === sessionId);
    if (matching.length > 0) {
      return matching.map((set) => normalizeCachedSet(set, sessionId));
    }
  }

  if (targetUserId) {
    const ninetySets = queryClient.getQueryData<WorkoutSet[]>(['workout_sets', targetUserId, '90d']);
    if (ninetySets && Array.isArray(ninetySets)) {
      const matching = ninetySets.filter((set) => set.workout_id === sessionId);
      if (matching.length > 0) {
        return matching.map((set) => normalizeCachedSet(set, sessionId));
      }
    }

    if (sessionDate) {
      const dateSets = queryClient.getQueryData<WorkoutSet[]>(['workout_sets', targetUserId, sessionDate]);
      if (dateSets && Array.isArray(dateSets)) {
        const matching = dateSets.filter((set) => set.workout_id === sessionId);
        if (matching.length > 0) {
          return matching.map((set) => normalizeCachedSet(set, sessionId));
        }
      }
    }

    const allWorkoutQueries = queryClient.getQueriesData<unknown>({
      queryKey: ['workout_sets', targetUserId],
    });
    for (const [, queryData] of allWorkoutQueries) {
      if (Array.isArray(queryData)) {
        const matching = queryData.filter((set: any) => set && set.workout_id === sessionId);
        if (matching.length > 0) {
          return matching.map((set) => normalizeCachedSet(set, sessionId));
        }
      }
    }
  }

  return null;
}

export function useHistorySessionSets({
  targetUserId,
  sessions,
  queryClient,
}: UseHistorySessionSetsOptions) {
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
  const [loadingSessionIds, setLoadingSessionIds] = useState<Set<string>>(new Set());
  const [sessionErrorIds, setSessionErrorIds] = useState<Set<string>>(new Set());
  const [sessionSetsMap, setSessionSetsMap] = useState<Record<string, HistorySet[]>>({});
  const lastAutoExpandedUserIdRef = useRef<string | null>(null);
  const pendingOps = useWorkoutPendingOps(targetUserId);

  // Reset expansion/sets maps when targetUserId changes
  const [prevUserId, setPrevUserId] = useState(targetUserId);
  if (prevUserId !== targetUserId) {
    setPrevUserId(targetUserId);
    setSessionSetsMap({});
    setExpandedSessionIds(new Set());
    setLoadingSessionIds(new Set());
    setSessionErrorIds(new Set());
  }

  // Per-session set-fetch error handling & offline pending overlay
  const loadSetsForSession = useCallback(async (sessionId: string) => {
    setSessionErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setLoadingSessionIds((prev) => new Set(prev).add(sessionId));

    try {
      const session = sessions.find((s) => s.id === sessionId);
      const sessionDate =
        session?.civil_date ||
        session?.workout_date ||
        (session?.date ? String(session.date).split('T')[0] : '');

      const workoutRefDateMap = new Map<string, string>();
      for (const op of pendingOps) {
        if (op.kind === 'workout.ensure') {
          workoutRefDateMap.set(op.payload.clientWorkoutId, op.payload.workout_date);
        }
      }

      const isOfflineOnly = sessionId.startsWith('offline-');

      let rawSets: HistorySet[] = [];

      if (!isOfflineOnly) {
        let fetchFailed = false;
        let fetchError: unknown = null;

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          fetchFailed = true;
          fetchError = new Error('Offline');
        } else {
          try {
            rawSets = await queryClient.fetchQuery({
              queryKey: ['session_sets', sessionId],
              queryFn: () => fetchSessionSets(sessionId),
              staleTime: 1000 * 60 * 5,
            });
          } catch (err) {
            fetchFailed = true;
            fetchError = err;
          }
        }

        if (fetchFailed) {
          const cachedSets = findCachedSessionSets(
            queryClient,
            sessionId,
            session,
            targetUserId,
            sessionDate
          );
          if (cachedSets) {
            rawSets = cachedSets;
          } else {
            throw fetchError;
          }
        }
      }

      // Overlay pending operations for this session
      const sessionPendingSets: HistorySet[] = [];
      const updatedSets = new Map<string, any>();
      const deletedSetIds = new Set<string>();

      for (const op of pendingOps) {
        if (op.kind === 'set.create') {
          const matchesRef = op.payload.workoutRef === sessionId;
          const opDate =
            workoutRefDateMap.get(op.payload.workoutRef) || op.payload.created_at?.slice(0, 10);
          const matchesDate = Boolean(sessionDate && opDate === sessionDate);
          if (matchesRef || matchesDate) {
            sessionPendingSets.push({
              id: op.payload.id,
              workout_id: sessionId,
              exercise_id: op.payload.exercise_id,
              weight: Number(op.payload.weight) || 0,
              reps: Number(op.payload.reps) || 0,
              set_index: op.payload.set_index ?? sessionPendingSets.length,
              set_type: (op.payload.set_type as WorkoutSet['set_type']) || 'working',
              rpe: op.payload.rpe ?? null,
              workout_date: sessionDate,
              workout_name: session?.name || 'Workout Session',
              created_at: op.payload.created_at || new Date().toISOString(),
            });
          }
        } else if (op.kind === 'set.batchCreate') {
          const { workoutRef, sets } = op.payload;
          const matchesRef = workoutRef === sessionId;
          for (const s of sets) {
            const opDate =
              workoutRefDateMap.get(workoutRef) || s.created_at?.slice(0, 10);
            const matchesDate = Boolean(sessionDate && opDate === sessionDate);
            if (matchesRef || matchesDate) {
              sessionPendingSets.push({
                id: s.id,
                workout_id: sessionId,
                exercise_id: s.exercise_id,
                weight: Number(s.weight) || 0,
                reps: Number(s.reps) || 0,
                set_index: s.set_index ?? sessionPendingSets.length,
                set_type: (s.set_type as WorkoutSet['set_type']) || 'working',
                rpe: s.rpe ?? null,
                workout_date: sessionDate,
                workout_name: session?.name || 'Workout Session',
                created_at: s.created_at || new Date().toISOString(),
              });
            }
          }
        } else if (op.kind === 'set.update') {
          updatedSets.set(op.payload.id, op.payload.patch);
        } else if (op.kind === 'set.delete') {
          deletedSetIds.add(op.payload.id);
        }
      }

      const rawSetIds = new Set(rawSets.map((s) => s.id));
      const nonDuplicatePending = sessionPendingSets.filter((s) => !rawSetIds.has(s.id));
      let combined = [...rawSets, ...nonDuplicatePending].filter((s) => !s.id || !deletedSetIds.has(s.id));
      combined = combined.map((s) => {
        const patch = s.id ? updatedSets.get(s.id) : undefined;
        if (!patch) return s;
        return {
          ...s,
          ...(patch.weight !== undefined ? { weight: Number(patch.weight) || 0 } : {}),
          ...(patch.reps !== undefined ? { reps: Number(patch.reps) || 0 } : {}),
          ...(patch.set_type !== undefined ? { set_type: patch.set_type } : {}),
          ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
        };
      });

      combined = combined.filter((s) => !s.set_type || s.set_type === 'working');
      combined.sort((a, b) => {
        const idxDiff = (a.set_index ?? 0) - (b.set_index ?? 0);
        if (idxDiff !== 0) return idxDiff;
        const timeDiff = (a.created_at || '').localeCompare(b.created_at || '');
        if (timeDiff !== 0) return timeDiff;
        return (a.id || '').localeCompare(b.id || '');
      });

      let catalogExercises =
        queryClient.getQueryData<Array<{ id?: string; name?: string }>>(['exercises', 'workout']) ||
        queryClient.getQueryData<Array<{ id?: string; name?: string }>>(['exercises']);

      if (!catalogExercises) {
        // Pre-existing race: on initial mount of HistoryView, auto-expansion of the newest session
        // triggers loadSetsForSession while the ['exercises'] query is in flight. Awaiting it prevents
        // un-enriched sets from rendering duplicate "Unknown Exercise" React keys that corrupt DOM reconciliation.
        // Both ['exercises'] (HistoryView) and ['exercises', 'workout'] (Active Workout) return Exercise[]
        // containing { id, name, ... }.
        const queryState = queryClient.getQueryState(['exercises']);
        if (queryState?.fetchStatus === 'fetching') {
          try {
            const fetched = await queryClient.fetchQuery<Array<{ id?: string; name?: string }>>({
              queryKey: ['exercises'],
              staleTime: 5 * 60 * 1000,
            });
            if (fetched && Array.isArray(fetched) && fetched.length > 0) {
              catalogExercises = fetched;
            }
          } catch (catalogErr) {
            // Explicit error handling: if catalog query fails, gracefully proceed with fallback exercise_id rather than failing session load
            console.warn('[useHistorySessionSets] In-flight catalog query fetch failed during enrichment:', catalogErr);
          }
        }
      }
      const ninetySets = queryClient.getQueryData<
        Array<{ id?: string; exercise_id?: string; exercise_name?: string }>
      >(['workout_sets', targetUserId, '90d']);

      const enrichedSets: HistorySet[] = combined.map((s) => {
        let exName = s.exercise_name || (s as { exercise?: { name?: string } }).exercise?.name;
        if (!exName && s.exercise_id) {
          const found = catalogExercises?.find((e) => e.id === s.exercise_id);
          if (found?.name) {
            exName = found.name;
          } else if (targetUserId) {
            const cached = ninetySets?.find((c) => c.exercise_id === s.exercise_id || c.id === s.id);
            if (cached?.exercise_name) {
              exName = cached.exercise_name;
            }
          }
        }
        return {
          ...s,
          exercise_name: exName || s.exercise_id,
          workout_date: sessionDate,
          workout_name: session?.name || 'Workout Session',
        };
      });
      setSessionSetsMap((prev) => ({ ...prev, [sessionId]: enrichedSets }));
    } catch (err) {
      console.error('Failed to load sets for session:', err);
      setSessionErrorIds((prev) => new Set(prev).add(sessionId));
    } finally {
      setLoadingSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }, [queryClient, sessions, targetUserId, pendingOps]);

  const handleToggleExpand = useCallback((sessionId: string) => {
    const willExpand = !expandedSessionIds.has(sessionId);
    setExpandedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
    if (willExpand) {
      void loadSetsForSession(sessionId);
    }
  }, [expandedSessionIds, loadSetsForSession]);

  // Auto-expand budget logic
  useEffect(() => {
    if (lastAutoExpandedUserIdRef.current === targetUserId || !sessions || sessions.length === 0) return;
    lastAutoExpandedUserIdRef.current = targetUserId;

    const toExpand: string[] = [];
    let accumulatedSets = 0;

    for (const session of sessions) {
      if (toExpand.length >= 2) break;
      const count = session.set_count ?? session.sets?.length ?? 0;
      if (accumulatedSets + count <= 100) {
        toExpand.push(session.id);
        accumulatedSets += count;
      } else {
        break;
      }
    }

    if (toExpand.length > 0) {
      queueMicrotask(() => {
        setExpandedSessionIds(new Set(toExpand));
        toExpand.forEach((sessionId) => {
          void loadSetsForSession(sessionId);
        });
      });
    }
  }, [targetUserId, sessions, loadSetsForSession]);

  return {
    expandedSessionIds,
    loadingSessionIds,
    sessionErrorIds,
    sessionSetsMap,
    setSessionSetsMap,
    loadSetsForSession,
    handleToggleExpand,
  };
}
