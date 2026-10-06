import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../../lib/queryKeys';

interface ExerciseLogEntry {
  exercise_name?: string;
  exercise_id?: string;
  workout_date?: string;
  created_at?: string;
}

export interface RecentFrequentData {
  recentNames: string[];
  frequentNames: string[];
  isLoading: boolean;
}

/**
 * Derives Recent and Frequent exercise names from existing workout logs
 * And/or the get_exercise_stats RPC.
 */
export function useRecentFrequentExercises(
  targetUserId?: string,
  userLogs?: ExerciseLogEntry[]
): RecentFrequentData {
  // Query exercise stats v2 / all-time stats if available
  const statsQuery = useQuery({
    queryKey: queryKeys.exerciseStats.byUser(targetUserId),
    enabled: Boolean(targetUserId) && (!userLogs || userLogs.length === 0),
    queryFn: async () => {
      if (!targetUserId || typeof supabase.rpc !== 'function') return [];
      const { data, error } = await supabase.rpc('get_exercise_stats', {
        p_user_id: targetUserId,
      });
      if (error) {
        console.warn('Failed to load exercise stats for picker:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    // 1. If userLogs is provided from current session context
    if (userLogs && userLogs.length > 0) {
      const recentList: string[] = [];
      const countMap: Record<string, number> = {};

      // Sort logs newest first
      const sortedLogs = [...userLogs].sort((a, b) => {
        const dateA = a.workout_date || a.created_at || '';
        const dateB = b.workout_date || b.created_at || '';
        return dateB.localeCompare(dateA);
      });

      for (const log of sortedLogs) {
        const name = (log.exercise_name || '').trim();
        if (!name) continue;
        if (!recentList.includes(name)) {
          recentList.push(name);
        }
        countMap[name] = (countMap[name] || 0) + 1;
      }

      const frequentList = Object.entries(countMap)
        .sort(([, countA], [, countB]) => countB - countA)
        .map(([name]) => name);

      return {
        recentNames: recentList.slice(0, 10),
        frequentNames: frequentList.slice(0, 10),
        isLoading: false,
      };
    }

    // 2. From get_exercise_stats RPC
    const statsData = statsQuery.data as any[];
    if (statsData && statsData.length > 0) {
      const frequentList = [...statsData]
        .sort((a, b) => (Number(b.set_count) || 0) - (Number(a.set_count) || 0))
        .map((row) => (row.exercise_name || '').trim())
        .filter(Boolean);

      const recentList = [...statsData]
        .sort((a, b) => {
          const dateA = a.recent_sets?.[0]?.workout_date || a.pr_date || '';
          const dateB = b.recent_sets?.[0]?.workout_date || b.pr_date || '';
          return String(dateB).localeCompare(String(dateA));
        })
        .map((row) => (row.exercise_name || '').trim())
        .filter(Boolean);

      return {
        recentNames: Array.from(new Set(recentList)).slice(0, 10),
        frequentNames: Array.from(new Set(frequentList)).slice(0, 10),
        isLoading: false,
      };
    }

    return {
      recentNames: [],
      frequentNames: [],
      isLoading: statsQuery.isLoading,
    };
  }, [userLogs, statsQuery.data, statsQuery.isLoading]);
}
