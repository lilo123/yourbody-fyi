import { useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOverlaidNutritionLogs } from '../../offline';
import type { Exercise, NutritionLog } from '../../types/database';
import { DEFAULT_EXERCISES_LIST } from '../../utils/ghostSets';
import { roundTo1Decimal } from '../../utils/nutrition';
import { itemsForPersist, normalizeItems, sumItems, type NutritionItem } from '../../utils/itemModel';
import {
  setCachedLogItems,
  deleteCachedLogItems,
  rehydrateLogWithCachedItems,
} from '../nutrition/useNutritionData';
import { getLocalDateStr, normalizeDateStr } from '../../utils/date';
import { fetchAllVisibleExercises, EXERCISE_SUMMARY_PROJECTION } from '../../lib/exercises';

export {
  fetchSessionSets,
  useExerciseStats,
  HISTORY_PAGE_SIZE,
  type HistorySet,
  type HistorySession,
  type RawExerciseStat,
} from './useWorkoutHistory';

export function addDaysCivil(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useHistoryData(targetUserId: string, onMutationError?: (msg: string) => void, timeZone?: string) {
  const queryClient = useQueryClient();

  // Fetch exercises
  const {
    data: exercises = DEFAULT_EXERCISES_LIST,
    isError: isExercisesError,
    error: exercisesError,
    refetch: refetchExercises,
  } = useQuery({
    queryKey: ['exercises'],
    queryFn: async () => {
      const data = await fetchAllVisibleExercises<Exercise>(EXERCISE_SUMMARY_PROJECTION);
      if (!data || data.length === 0) return DEFAULT_EXERCISES_LIST;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch nutrition logs for target user via 14-day window infinite query
  const {
    data: nutritionData,
    isPending: isNutritionPending,
    isError: isNutritionLogsError,
    error: nutritionLogsError,
    isFetchingNextPage: isLoadingMoreNutrition,
    fetchNextPage: loadMoreNutrition,
    hasNextPage: hasMoreNutrition,
    refetch: refetchNutritionLogs,
  } = useInfiniteQuery({
    queryKey: timeZone
      ? ['nutrition_logs', targetUserId, 'history_window', timeZone]
      : ['nutrition_logs', targetUserId, 'history_window'],
    enabled: Boolean(targetUserId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!targetUserId) return { logs: [], nextCursor: undefined };
      const todayInUserTz = timeZone ? (normalizeDateStr(new Date(), timeZone) || getLocalDateStr()) : getLocalDateStr();
      const windowEnd = pageParam || todayInUserTz;
      const windowStart = addDaysCivil(windowEnd, -13);

      const { data, error } = await supabase
        .from('nutrition_logs')
        .select(
          'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components'
        )
        .eq('user_id', targetUserId)
        .gte('logged_date', windowStart)
        .lte('logged_date', windowEnd)
        .order('logged_date', { ascending: false })
        .order('logged_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      const logs = (data ? (data as NutritionLog[]) : []).map(rehydrateLogWithCachedItems);

      // Probe whether an older row exists before windowStart
      const { data: olderRows, error: probeError } = await supabase
        .from('nutrition_logs')
        .select('logged_date')
        .eq('user_id', targetUserId)
        .lt('logged_date', windowStart)
        .order('logged_date', { ascending: false })
        .limit(1);

      if (probeError) throw probeError;

      const hasOlder = Boolean(olderRows && olderRows.length > 0);
      const nextCursor = hasOlder ? addDaysCivil(windowStart, -1) : undefined;

      return { logs, nextCursor };
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor,
  });

  const rawNutritionLogs = useMemo(() => {
    return nutritionData?.pages.flatMap((page) => page.logs) ?? [];
  }, [nutritionData]);

  const nutritionLogs = useOverlaidNutritionLogs(rawNutritionLogs, {
    userId: targetUserId,
  });

  // Delete nutrition log mutation
  const deleteMealMutation = useMutation({
    mutationFn: async (logId: string) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Available when online');
      }
      deleteCachedLogItems(logId);
      const { error } = await supabase.from('nutrition_logs').delete().eq('id', logId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutrition_logs', targetUserId] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || 'Failed to delete meal log. Please try again.';
      onMutationError?.(message);
    },
  });

  // Whole-dish rescale mutation
  const scaleMealMutation = useMutation({
    mutationFn: async ({ log, items }: { log: NutritionLog; items?: NutritionItem[] }) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Available when online');
      }
      let activeItems = items;
      if (!activeItems || activeItems.length === 0) {
        if (log.items && Array.isArray(log.items) && log.items.length > 0) {
          activeItems = normalizeItems(log.items) || [];
        } else {
          // payload-gate: detail-fetch — refetch-before-write inside scaleMealMutation
          const { data: fullLog, error: fetchErr } = await supabase
            .from('nutrition_logs')
            .select('id, items, calories, protein, carbs, fat, fiber')
            .eq('id', log.id)
            .maybeSingle();
          if (fetchErr) throw fetchErr;
          if (fullLog?.items) {
            activeItems = normalizeItems(fullLog.items) || [];
          }
        }
      }

      if (!activeItems || activeItems.length === 0) {
        throw new Error('Cannot rescale a meal without component items');
      }

      const totals = sumItems(activeItems);
      if (totals.calories === 0 && Number(log.calories) > 0) {
        throw new Error('Refusing to persist zero macros for non-zero meal: data loss prevented');
      }

      const { error } = await supabase
        .from('nutrition_logs')
        .update({
          items: itemsForPersist(activeItems),
          calories: Math.max(0, roundTo1Decimal(totals.calories)),
          protein: Math.max(0, roundTo1Decimal(totals.protein)),
          carbs: Math.max(0, roundTo1Decimal(totals.carbs)),
          fat: Math.max(0, roundTo1Decimal(totals.fat)),
          fiber: Math.max(0, roundTo1Decimal(totals.fiber)),
        })
        .eq('id', log.id);
      if (error) throw error;
      setCachedLogItems(log.id, activeItems);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nutrition_logs', targetUserId] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || 'Failed to rescale meal. Please try again.';
      onMutationError?.(message);
    },
  });

  return {
    exercises,
    nutritionLogs,
    hasMoreNutrition: Boolean(hasMoreNutrition),
    loadMoreNutrition,
    isNutritionPending,
    isLoadingMoreNutrition,
    deleteMealMutation,
    scaleMealMutation,
    isNutritionLogsError,
    nutritionLogsError,
    refetchNutritionLogs,
    isExercisesError,
    exercisesError,
    refetchExercises,
  };
}


export function formatNutritionDayHeader(
  dateStr: string,
  mealsCount: number
): { title: string; subtitle: string } {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const dt = new Date(year, month - 1, day);
  const weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdaysFull = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const weekdayShort = weekdaysShort[dt.getDay()] || "";
  const weekdayFull = weekdaysFull[dt.getDay()] || "";
  const monthName = months[month - 1] || monthStr;

  const currentYear = new Date().getFullYear();
  const yearSuffix = year !== currentYear ? `, ${year}` : "";

  const title = `${weekdayShort}, ${monthName} ${day}${yearSuffix}`;
  const mealWord = mealsCount === 1 ? "meal" : "meals";
  const subtitle = `${weekdayFull} · ${mealsCount} ${mealWord} logged`;

  return { title, subtitle };
}
