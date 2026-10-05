import { useMemo } from 'react';
import type { HistorySession, HistorySet } from './useWorkoutHistory';
import type { Exercise } from '../../types/database';
import {
  cleanSearchText,
  expandSearchAliases,
  matchesExerciseSearch,
  parseBodyPartTokens,
} from '../../utils/normalizeSearch';

export interface UseHistorySessionFilterResult {
  filtered: HistorySession[];
  isFiltering: boolean;
  matchCount: number;
}

/**
 * useHistorySessionFilter (H43, D-P5b-6)
 *
 * Pure hook to filter workout sessions in History By-Session view.
 *
 * Filtering behavior:
 * 1. Query matching:
 *    - Matches normalized session name (e.g. 'Push Day Benchmark')
 *    - Matches exercise names in loaded sets (via sessionSetsMap or session.sets)
 *    - Supports acronym/alias expansion (e.g. 'rdl', 'ohp', 'bp')
 *
 * 2. Category matching:
 *    - Category matches exercise body parts (e.g. 'Chest', 'Legs', 'Back')
 *    - LIMITATION DOCUMENTATION:
 *      In History By-Session view, sessions are paginated with lightweight session headers.
 *      Full set details are loaded on-demand (when expanded or auto-expanded).
 *      Therefore, exercise body part filtering can only inspect sessions whose sets have been
 *      loaded into `sessionSetsMap` or `session.sets`. For sessions whose sets have not yet been
 *      fetched, the category filter checks whether the session name itself contains the target
 *      category token (e.g. 'Leg Day' matches 'Legs'); if not, the unloaded session is excluded.
 */
export function useHistorySessionFilter(
  sessions: HistorySession[],
  sessionSetsMap: Record<string, HistorySet[]> = {},
  query: string = '',
  category: string = 'All',
  exercises?: Exercise[]
): UseHistorySessionFilterResult {
  const cleanQuery = cleanSearchText(query);
  const isCategoryActive = Boolean(category && category.trim().toLowerCase() !== 'all');
  const isQueryActive = Boolean(cleanQuery.length > 0);
  const isFiltering = isQueryActive || isCategoryActive;

  const filtered = useMemo(() => {
    if (!isFiltering) {
      return sessions;
    }

    const expandedQuery = expandSearchAliases(query);
    const targetCategory = category.trim().toLowerCase();
    const singularCategory = targetCategory.endsWith('s')
      ? targetCategory.slice(0, -1)
      : targetCategory;

    return sessions.filter((session) => {
      const sets = sessionSetsMap[session.id] || session.sets || [];

      // 1. Category filter
      if (isCategoryActive) {
        if (sets.length > 0) {
          const hasCategorySet = sets.some((set) => {
            const foundExercise = exercises?.find(
              (e) =>
                e.id === set.exercise_id ||
                e.name.toLowerCase() === (set.exercise_name || '').toLowerCase()
            );
            const bodyParts =
              set.exercise?.body_parts ||
              foundExercise?.body_parts ||
              (set as { body_parts?: string[] }).body_parts;

            if (!bodyParts || bodyParts.length === 0) return false;
            const tokens = parseBodyPartTokens(bodyParts).map((t) => t.toLowerCase());
            return (
              tokens.includes(targetCategory) ||
              tokens.includes(singularCategory) ||
              bodyParts.some(
                (p) =>
                  p.toLowerCase() === targetCategory ||
                  p.toLowerCase().includes(singularCategory)
              )
            );
          });

          if (!hasCategorySet) {
            return false;
          }
        } else {
          // Unloaded sets limitation: check if session name mentions the category
          const sNameClean = cleanSearchText(session.name);
          const nameMatches =
            sNameClean.includes(targetCategory) || sNameClean.includes(singularCategory);
          if (!nameMatches) {
            return false;
          }
        }
      }

      // 2. Query filter
      if (isQueryActive) {
        const sNameClean = cleanSearchText(session.name);
        const nameMatches =
          sNameClean.includes(cleanQuery) ||
          (expandedQuery.length > 0 && sNameClean.includes(expandedQuery));

        if (nameMatches) {
          return true;
        }

        // Check exercise names in loaded sets
        if (sets.length > 0) {
          const exerciseMatches = sets.some((set) => {
            const exName =
              set.exercise_name ||
              set.exercise?.name ||
              exercises?.find((e) => e.id === set.exercise_id)?.name;

            if (!exName) return false;
            return matchesExerciseSearch({ name: exName }, query);
          });

          if (exerciseMatches) {
            return true;
          }
        }

        return false;
      }

      return true;
    });
  }, [sessions, sessionSetsMap, query, category, exercises, isFiltering, isQueryActive, isCategoryActive, cleanQuery]);

  return {
    filtered,
    isFiltering,
    matchCount: filtered.length,
  };
}
