import { useEffect, useRef, useCallback } from 'react';
import type { RoutineTemplate } from '../../types/database';
import { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';

export function isValidCivilDate(str: string | null): boolean {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const parts = str.split('-').map(Number);
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export interface UseWorkoutUrlParamsOptions {
  customTemplates: RoutineTemplate[];
  templatesFetched: boolean;
  onSelectRoutine: (routineName: string, template?: RoutineTemplate) => void;
  workoutDate: string;
  onDateChange: (newDate: string) => void;
  targetUserId?: string;
}

export function useWorkoutUrlParams({
  customTemplates,
  templatesFetched,
  onSelectRoutine,
  workoutDate,
  onDateChange,
  targetUserId,
}: UseWorkoutUrlParamsOptions) {
  const dateParamAppliedRef = useRef(false);
  const routineParamAppliedRef = useRef<string | null>(null);
  const lastTargetUserRef = useRef(targetUserId);

  useEffect(() => {
    if (lastTargetUserRef.current !== targetUserId) {
      lastTargetUserRef.current = targetUserId;
      dateParamAppliedRef.current = false;
      routineParamAppliedRef.current = null;
    }
  }, [targetUserId]);

  const getSearchParams = useCallback(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  // 1. Initial / mount date handling
  useEffect(() => {
    if (dateParamAppliedRef.current) return;
    dateParamAppliedRef.current = true;

    const searchParams = getSearchParams();
    const dateParam = searchParams.get('date');
    if (dateParam && isValidCivilDate(dateParam)) {
      if (dateParam !== workoutDate) {
        onDateChange(dateParam);
      }
    }
  }, [getSearchParams, workoutDate, onDateChange]);

  // 2. Synchronize date param when workoutDate changes
  const syncDateToUrl = useCallback((newDate: string) => {
    if (!isValidCivilDate(newDate)) return;
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('date') !== newDate) {
        url.searchParams.set('date', newDate);
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    } catch {
      // In non-browser environments
    }
  }, []);

  // 3. Routine param handling
  useEffect(() => {
    if (!templatesFetched) return;

    const searchParams = getSearchParams();
    const routineParam = searchParams.get('routine');
    if (!routineParam) return;

    if (routineParamAppliedRef.current === routineParam) return;
    routineParamAppliedRef.current = routineParam;

    const trimmed = routineParam.trim();
    const matchedCustom =
      customTemplates.find((t) => t.id.toLowerCase() === trimmed.toLowerCase()) ||
      customTemplates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());

    if (matchedCustom) {
      onSelectRoutine(matchedCustom.name, matchedCustom);
      return;
    }

    const matchedDefault = DEFAULT_WORKOUT_TEMPLATES.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );

    if (matchedDefault) {
      onSelectRoutine(matchedDefault.name);
    }
  }, [getSearchParams, templatesFetched, customTemplates, onSelectRoutine]);

  return {
    syncDateToUrl,
  };
}
