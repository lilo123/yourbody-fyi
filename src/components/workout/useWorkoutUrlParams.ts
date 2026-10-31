import { useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { RoutineTemplate } from '../../types/database';
import { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';
import { isDefaultRoutineHidden } from './workoutEngineHelpers';

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
  hasLoadedCatalog?: boolean;
  hiddenRoutineNames?: Set<string> | string[];
}

export function useWorkoutUrlParams({
  customTemplates,
  templatesFetched,
  onSelectRoutine,
  workoutDate,
  onDateChange,
  targetUserId,
  hasLoadedCatalog,
  hiddenRoutineNames,
}: UseWorkoutUrlParamsOptions) {
  const queryClient = useContext(QueryClientContext);
  const isCatalogLoaded = hasLoadedCatalog !== undefined ? hasLoadedCatalog : templatesFetched;
  const dateParamAppliedRef = useRef(false);
  const routineParamAppliedRef = useRef<string | null>(null);
  const lastTargetUserRef = useRef(targetUserId);

  const resolvedHiddenNames = useMemo(() => {
    if (hiddenRoutineNames) {
      if (hiddenRoutineNames instanceof Set) {
        return new Set(Array.from(hiddenRoutineNames).map((name) => name.trim().toLowerCase()));
      }
      return new Set(hiddenRoutineNames.map((name) => name.trim().toLowerCase()));
    }
    const cached = queryClient?.getQueryData<RoutineTemplate[]>(['routine_templates', targetUserId, 'hidden']);
    if (cached && Array.isArray(cached)) {
      return new Set(cached.map((template) => template.name?.trim().toLowerCase()).filter(Boolean));
    }
    return new Set<string>();
  }, [hiddenRoutineNames, queryClient, targetUserId]);

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
    if (!isCatalogLoaded) return;

    const searchParams = getSearchParams();
    const routineParam = searchParams.get('routine');
    if (!routineParam) return;

    if (routineParamAppliedRef.current === routineParam) return;
    routineParamAppliedRef.current = routineParam;

    const trimmed = routineParam.trim();
    const matchedCustom =
      customTemplates.find((template) => template.id.toLowerCase() === trimmed.toLowerCase()) ||
      customTemplates.find((template) => template.name.toLowerCase() === trimmed.toLowerCase());

    if (matchedCustom) {
      onSelectRoutine(matchedCustom.name, matchedCustom);
      return;
    }

    if (!isDefaultRoutineHidden(trimmed, customTemplates, resolvedHiddenNames, isCatalogLoaded)) {
      const matchedDefault = DEFAULT_WORKOUT_TEMPLATES.find(
        (defaultTemplate) => defaultTemplate.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (matchedDefault) {
        onSelectRoutine(matchedDefault.name);
      }
    }
  }, [getSearchParams, isCatalogLoaded, customTemplates, onSelectRoutine, resolvedHiddenNames]);

  return {
    syncDateToUrl,
  };
}
