import { useContext } from 'react';
import { AuthContext } from '../../context/AuthContextTypes';
import type { PrMode } from '../../lib/prComparator';
import { useMemo, useCallback } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useQuery,
} from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { queryKeys } from '../../lib/queryKeys';
import { invalidateWorkoutDerived } from '../../lib/invalidate';
import type { WorkoutSet } from '../../types/database';
import { getTimelineDaysAgoStr } from '../../utils/timelineGrouping';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { applyPendingToHistory } from '../../offline';
import { useWorkoutPendingOps } from '../workout/useWorkoutPendingOps';

export interface HistorySet extends WorkoutSet {
  workout_date: string;
  workout_name: string;
  exercise_name?: string;
}

export interface HistorySession {
  id: string;
  date: string;
  workout_date?: string;
  civil_date?: string;
  name: string;
  set_count: number;
  total_volume: number;
  sets?: HistorySet[];
}

export interface RawExerciseStat {
  exercise_id: string;
  exercise_name?: string;
  set_count: number;
  max_weight: number;
  pr_reps: number;
  pr_date?: string | null;
  pr_e1rm?: number | null;
  recent_sets: any;
}

export const HISTORY_PAGE_SIZE = 30;

interface SessionSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  weight: number | null;
  reps: number | null;
  set_index: number | null;
  created_at: string;
  rpe: number | null;
  set_type: string | null;
}

export async function fetchSessionSets(workoutId: string): Promise<HistorySet[]> {
  // detail-fetch — user expands a session card
  const { data, error } = await supabase
    .from('sets')
    .select('id, workout_id, exercise_id, weight, reps, set_index, created_at, rpe, set_type')
    .eq('workout_id', workoutId)
    .order('set_index', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(500);

  if (error) throw error;
  if (!data) return [];

  if (data.length === 500) {
    console.warn(
      `[useHistoryData] fetchSessionSets query reached cap of 500 rows; older historical sets may be truncated.`
    );
  }

  return ((data || []) as unknown as SessionSetRow[])
    .filter((s) => !s.set_type || s.set_type === 'working')
    .map((s): HistorySet => ({
      id: s.id,
      workout_id: s.workout_id,
      exercise_id: s.exercise_id,
      weight: Number(s.weight) || 0,
      reps: Number(s.reps) || 0,
      set_index: s.set_index ?? 0,
      set_type: (s.set_type as WorkoutSet['set_type']) || 'working',
      rpe: s.rpe ?? null,
      workout_date: '',
      workout_name: '',
      created_at: s.created_at,
    }));
}

export function useExerciseStats(targetUserId: string, enabled: boolean, mode?: PrMode) {
  const auth = useContext(AuthContext);
  const prMode: PrMode = mode || (auth?.profile?.pr_mode === 'e1rm' ? 'e1rm' : 'weight');
  return useQuery({
    queryKey: ['exercise_stats', targetUserId, prMode],
    enabled: Boolean(targetUserId) && enabled,
    queryFn: async () => {
      if (!targetUserId || typeof supabase.rpc !== 'function') return [];
      const rpcParams: Record<string, any> = { p_user_id: targetUserId };
      if (prMode && prMode !== 'weight') {
        rpcParams.p_pr_mode = prMode;
      }
      const { data, error } = await (supabase as any).rpc('get_exercise_stats', rpcParams);
      if (error) throw error;
      return (data || []) as RawExerciseStat[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type HistoryRange = '30d' | '90d' | '1y' | 'all';

export function computeHistorySince(range: HistoryRange, timeZone?: string): string | null {
  if (range === 'all') return null;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  return getTimelineDaysAgoStr(days, timeZone);
}

export interface ExerciseHistorySet {
  workout_id: string;
  civil_date: string;
  workout_name: string;
  set_id: string;
  set_index: number;
  weight: number;
  reps: number;
  rpe?: number | null;
  created_at: string;
  total_sessions: number;
}

export interface FetchExerciseHistoryOptions {
  since?: string | null;
  before?: string | null;
  limit?: number;
}

type RpcCaller = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export interface ExerciseHistoryRow {
  workout_id: string;
  civil_date: string;
  workout_name: string;
  set_id: string;
  set_index: number | null;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  created_at: string;
  total_sessions: number | null;
}

export interface HistorySessionV2Row {
  id: string;
  date: string;
  civil_date?: string;
  workout_date?: string;
  name?: string;
  set_count: number | null;
  total_volume: number | null;
  total_count: number | null;
}

export async function fetchExerciseHistoryPage(
  userId: string,
  exerciseId: string,
  options: FetchExerciseHistoryOptions = {}
): Promise<ExerciseHistorySet[]> {
  const { since = null, before = null, limit = 10 } = options;
  const { data, error } = await (supabase.rpc as unknown as RpcCaller)('get_exercise_history', {
    p_user_id: userId,
    p_exercise_id: exerciseId,
    p_since: since,
    p_before: before,
    p_limit: limit,
  });

  if (error) throw error as Error;
  if (!data) return [];
  return (data as ExerciseHistoryRow[]).map((row) => ({
    workout_id: row.workout_id,
    civil_date: row.civil_date,
    workout_name: row.workout_name,
    set_id: row.set_id,
    set_index: Number(row.set_index) || 0,
    weight: Number(row.weight) || 0,
    reps: Number(row.reps) || 0,
    rpe: row.rpe != null ? Number(row.rpe) : null,
    created_at: row.created_at,
    total_sessions: Number(row.total_sessions) || 0,
  }));
}

export interface HistoryCursor {
  before_date: string;
  before_id: string;
}

export interface HistoryPage {
  sessions: HistorySession[];
  totalCount: number;
}

export interface UseWorkoutHistoryResult {
  sessions: (HistorySession & { pending?: boolean })[];
  totalCount: number | null;
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
  loadMoreError: Error | null;
  isSessionsPending: boolean;
  isSessionsError: boolean;
  sessionsError: unknown;
  refetchSessions: () => Promise<unknown>;
  deleteSession: (workoutId: string) => Promise<void>;
  isDeletingSession: boolean;
  canDelete: boolean;
  isOnline: boolean;
}

export function useWorkoutHistory(
  targetUserId: string,
  range: HistoryRange,
  userTimeZone?: string
): UseWorkoutHistoryResult {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const pendingOps = useWorkoutPendingOps(targetUserId);

  const since = useMemo(() => computeHistorySince(range, userTimeZone), [range, userTimeZone]);

  const {
    data,
    error,
    isPending,
    isError,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.workoutSets.historyV2(targetUserId, range, since),
    enabled: Boolean(targetUserId),
    initialPageParam: null as HistoryCursor | null,
    queryFn: async ({ pageParam }) => {
      if (!targetUserId) return { sessions: [], totalCount: 0 };
      const { data: rows, error: rpcError } = await (supabase.rpc as unknown as RpcCaller)('get_history_sessions_v2', {
        p_user_id: targetUserId,
        p_since: since,
        p_before_date: pageParam?.before_date ?? null,
        p_before_id: pageParam?.before_id ?? null,
        p_limit: HISTORY_PAGE_SIZE,
      });

      if (rpcError) throw rpcError as Error;
      const rawRows = (rows || []) as HistorySessionV2Row[];
      const totalCount = rawRows.length > 0 ? Number(rawRows[0].total_count) || 0 : 0;
      const pageSessions: HistorySession[] = rawRows.map((row) => ({
        id: row.id,
        date: row.date,
        workout_date: row.civil_date || row.workout_date || (row.date ? String(row.date).split('T')[0] : ''),
        civil_date: row.civil_date || row.workout_date || (row.date ? String(row.date).split('T')[0] : ''),
        name: row.name || 'Workout Session',
        set_count: Number(row.set_count) || 0,
        total_volume: Number(row.total_volume) || 0,
        sets: [],
      }));

      return { sessions: pageSessions, totalCount };
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.sessions.length === 0) return undefined;
      if (lastPage.sessions.length < HISTORY_PAGE_SIZE) return undefined;
      const loaded = allPages.reduce((acc, p) => acc + p.sessions.length, 0);
      const totalCount = lastPage.totalCount;
      if (loaded >= totalCount) return undefined;
      const last = lastPage.sessions[lastPage.sessions.length - 1];
      const before_date = last.civil_date || (last.date ? String(last.date).split('T')[0] : '');
      return {
        before_date,
        before_id: last.id,
      };
    },
  });

  const rawSessions = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.sessions);
  }, [data]);

  const sessions = useMemo(() => {
    return applyPendingToHistory(rawSessions, pendingOps);
  }, [rawSessions, pendingOps]);

  const totalCount = useMemo(() => {
    if (!data?.pages || data.pages.length === 0) {
      return sessions.length > 0 ? sessions.length : null;
    }
    if (data.pages[0]?.sessions.length === 0) {
      return sessions.length;
    }
    const lastPage = data.pages[data.pages.length - 1];
    const serverTotal = lastPage?.totalCount ?? 0;
    return Math.max(serverTotal, sessions.length);
  }, [data, sessions]);

  const hasMore = Boolean(hasNextPage);

  const loadMore = useCallback(() => {
    if (hasMore && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasMore, isFetchingNextPage, fetchNextPage]);

  const isInitialError = isError && (!data?.pages || data.pages.length === 0);
  const isLoadMoreError = isError && Boolean(data?.pages && data.pages.length > 0);

  const deleteMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      if (!targetUserId) throw new Error('Cannot delete session without user id');
      const session = sessions.find((s) => s.id === workoutId);
      const sessionDate =
        session?.workout_date ||
        session?.civil_date ||
        (session?.date ? String(session.date).split('T')[0] : '');

      const { error: delError } = await supabase
        .from('workouts')
        .delete()
        .eq('id', workoutId)
        .eq('user_id', targetUserId);

      if (delError) throw delError;

      if (sessionDate && typeof localStorage !== 'undefined') {
        try {
          localStorage.removeItem(`yourbody_client_workout_${targetUserId}_${sessionDate}`);
        } catch {}
      }

      await invalidateWorkoutDerived(queryClient, targetUserId);
    },
  });

  const deleteSession = useCallback(
    async (workoutId: string) => {
      if (!isOnline) return;
      await deleteMutation.mutateAsync(workoutId);
    },
    [isOnline, deleteMutation]
  );

  return {
    sessions,
    totalCount,
    hasMore,
    loadMore,
    isLoadingMore: isFetchingNextPage,
    loadMoreError: isLoadMoreError ? (error as Error) : null,
    isSessionsPending: Boolean(targetUserId) && isPending,
    isSessionsError: isInitialError,
    sessionsError: isInitialError ? error : null,
    refetchSessions: refetch,
    deleteSession,
    isDeletingSession: deleteMutation.isPending,
    canDelete: isOnline,
    isOnline,
  };
}
