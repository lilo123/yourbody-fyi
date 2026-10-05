import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { WorkoutSet, Exercise, RoutineTemplate } from '../../types/database';
import {
  normalizeDateStr,
  getLocalDateStr,
  getDayOfWeekAbbr,
  DEFAULT_WORKOUT_TEMPLATES,
} from '../../utils/ghostSets';
import { workoutSessionStore, type SetDraftInput } from '../../utils/workoutSessionStore';
import {
  isUUID,
  resolveRoutineAndExercises,
  checkIsScheduledRoutineDirty,
} from './workoutEngineHelpers';
import { fetchTemplateDetail } from './useWorkoutQueries';
import {
  cleanSessionUUIDs,
  findMatchingTemplate,
  extractTemplateDetails,
  getInitialRoutineState,
  filterSetsForExercise,
  sanitizeDraftValue,
} from './useWorkoutSessionHelpers';
import { useWorkoutAccordion } from './useWorkoutAccordion';
import { enqueueAndAwait } from '../../offline';

export interface UseWorkoutSessionOptions {
  targetUserId: string;
  exercises: Exercise[];
  exercisesFetched: boolean;
  customTemplates: RoutineTemplate[];
  templatesFetched: boolean;
  userLogs: (WorkoutSet & { workout_date: string; workout_name?: string })[];
  logsFetched: boolean;
  onSessionRoutineChange?: () => void;
}

export function useWorkoutSession({
  targetUserId,
  exercises,
  exercisesFetched,
  customTemplates,
  templatesFetched,
  userLogs,
  logsFetched,
}: UseWorkoutSessionOptions) {
  const [workoutDate, setWorkoutDate] = useState<string>(() => {
    const activeSession = workoutSessionStore.getActiveSession(targetUserId);
    if (activeSession && activeSession.workoutDate) {
      return activeSession.workoutDate;
    }
    return getLocalDateStr(new Date());
  });

  const initialSession = workoutSessionStore.getActiveSession(targetUserId, workoutDate);
  const initialState = getInitialRoutineState(initialSession, workoutDate);

  const [activeRoutineName, setActiveRoutineName] = useState<string>(initialState.activeRoutineName);
  const [activeExercises, setActiveExercises] = useState<string[]>(initialState.activeExercises);
  const [targetSetCounts, setTargetSetCounts] = useState<Record<string, number>>(initialState.targetSetCounts);
  const [targetRepCounts, setTargetRepCounts] = useState<Record<string, number>>(initialState.targetRepCounts);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(initialState.expandedExercises);
  const [inputDrafts, setInputDrafts] = useState<Record<string, SetDraftInput>>(
    () => initialSession?.inputDrafts ?? {}
  );

  const resolvedKeyRef = useRef<string | null>(null);
  const manualSelectionDateRef = useRef<string | null>(null);
  const lastTargetUserRef = useRef<string>(targetUserId);

  const todaySets = useMemo(() => {
    return userLogs.filter((s) => normalizeDateStr(s.workout_date) === workoutDate);
  }, [userLogs, workoutDate]);

  const getSetsForExerciseToday = useCallback((exName: string) => {
    return filterSetsForExercise(exName, todaySets, exercises);
  }, [exercises, todaySets]);

  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    if (lastTargetUserRef.current !== targetUserId) {
      lastTargetUserRef.current = targetUserId;
      workoutSessionStore.flushPendingWrites();
      setInputDrafts({});
      setActiveExercises([]);
      setTargetSetCounts({});
      setTargetRepCounts({});
      resolvedKeyRef.current = null;
      manualSelectionDateRef.current = null;
    }

    if (!templatesFetched || !logsFetched || !exercisesFetched) return;

    if (manualSelectionDateRef.current && manualSelectionDateRef.current !== workoutDate) {
      manualSelectionDateRef.current = null;
    }

    if (manualSelectionDateRef.current === workoutDate) return;

    const resolutionKey = `${targetUserId}_${workoutDate}`;
    if (resolvedKeyRef.current === resolutionKey) return;
    resolvedKeyRef.current = resolutionKey;

    const existingSession = workoutSessionStore.getActiveSession(targetUserId, workoutDate);
    if (existingSession) {
      const hasUUIDs =
        existingSession.exercises.some(isUUID) ||
        existingSession.expandedExercises.some(isUUID) ||
        Object.keys(existingSession.inputDrafts || {}).some((k) => {
          const idx = k.lastIndexOf('_');
          const prefix = idx > 0 ? k.slice(0, idx) : k;
          return isUUID(prefix);
        });

      let sessionToApply = existingSession;

      if (hasUUIDs) {
        sessionToApply = cleanSessionUUIDs(existingSession, exercises, todaySets);
        workoutSessionStore.saveSession(sessionToApply, true);
      }

      const updatedTargets = { ...sessionToApply.targetSetCounts };
      sessionToApply.exercises.forEach((exName) => {
        const loggedCount = getSetsForExerciseToday(exName).length;
        if ((updatedTargets[exName] || 0) < loggedCount) {
          updatedTargets[exName] = loggedCount;
        }
      });

      setActiveRoutineName(sessionToApply.routineName);
      setActiveExercises(sessionToApply.exercises);
      setTargetSetCounts(updatedTargets);
      setTargetRepCounts(sessionToApply.targetRepCounts);
      setInputDrafts(sessionToApply.inputDrafts || {});
      setExpandedExercises(new Set(sessionToApply.expandedExercises));
      return;
    }

    const resolved = resolveRoutineAndExercises(
      workoutDate,
      todaySets,
      customTemplates,
      exercises
    );

    const isToday = workoutDate === getLocalDateStr(new Date());
    if (isToday) {
      const newSession = workoutSessionStore.getOrInitSession(targetUserId, workoutDate, {
        routineName: resolved.routineName,
        exercises: resolved.exercises,
        targetSetCounts: resolved.targetSets,
        targetRepCounts: resolved.targetReps,
      });
      setActiveRoutineName(newSession.routineName);
      setActiveExercises(newSession.exercises);
      setTargetSetCounts(newSession.targetSetCounts);
      setTargetRepCounts(newSession.targetRepCounts);
      setInputDrafts(newSession.inputDrafts || {});
      setExpandedExercises(new Set(newSession.expandedExercises));
    } else {
      setActiveRoutineName(resolved.routineName);
      setActiveExercises(resolved.exercises);
      setTargetSetCounts(resolved.targetSets);
      setTargetRepCounts(resolved.targetReps);
      setInputDrafts({});
      setExpandedExercises(resolved.exercises.length > 0 ? new Set([resolved.exercises[0]]) : new Set());
    }
  }, [workoutDate, targetUserId, templatesFetched, logsFetched, exercisesFetched, customTemplates, todaySets, exercises, getSetsForExerciseToday]);

  const {
    toggleAccordion,
    collapseExercise,
    collapseCompleted,
    toggleAllAccordions,
  } = useWorkoutAccordion({
    targetUserId,
    workoutDate,
    activeExercises,
    targetSetCounts,
    getSetsForExerciseToday,
    setExpandedExercises,
  });

  const handleSelectRoutine = async (routineName: string, selectedTemplate?: RoutineTemplate) => {
    manualSelectionDateRef.current = workoutDate;

    let resolvedExList: string[] = [];
    let resolvedTargets: Record<string, number> = {};
    let resolvedReps: Record<string, number> = {};

    if (routineName === 'Rest Day' || routineName === 'Free Workout') {
      setActiveRoutineName(routineName);
      setActiveExercises([]);
      setTargetSetCounts({});
      setTargetRepCounts({});
      setExpandedExercises(new Set());
    } else {
      const customTpl = selectedTemplate || findMatchingTemplate(customTemplates, routineName);
      const defTpl = findMatchingTemplate(DEFAULT_WORKOUT_TEMPLATES, routineName);

      let templateExercises = customTpl?.exercises;
      if (customTpl && templateExercises === undefined) {
        try {
          const detail = await fetchTemplateDetail(customTpl.id);
          templateExercises = detail?.exercises || [];
        } catch (err) {
          console.error('Failed to fetch template detail for selection:', err);
          templateExercises = [];
        }
      }

      const extracted = extractTemplateDetails(customTpl, defTpl, templateExercises, exercises);
      resolvedExList = extracted.resolvedExList;
      resolvedTargets = extracted.resolvedTargets;
      resolvedReps = extracted.resolvedReps;

      setActiveRoutineName(routineName);
      setActiveExercises(resolvedExList);
      setTargetSetCounts(resolvedTargets);
      setTargetRepCounts(resolvedReps);
      if (resolvedExList.length > 0) setExpandedExercises(new Set([resolvedExList[0]]));
      else setExpandedExercises(new Set());
    }

    workoutSessionStore.updateRoutine(
      targetUserId,
      workoutDate,
      routineName,
      resolvedExList,
      resolvedTargets,
      resolvedReps
    );

    if (todaySets.length > 0 && todaySets[0].workout_id) {
      const workoutRef = todaySets[0].workout_id;
      enqueueAndAwait({
        userId: targetUserId,
        kind: 'workout.rename',
        payload: {
          workoutRef,
          name: routineName,
        },
      }).catch((err: unknown) => {
        console.error('Failed to update workout name:', err);
      });
    }
  };

  const handleReloadScheduledRoutine = async () => {
    workoutSessionStore.deleteSession(targetUserId, workoutDate);
    manualSelectionDateRef.current = null;
    resolvedKeyRef.current = null;

    const dayAbbr = getDayOfWeekAbbr(workoutDate);
    const scheduledCustom = customTemplates.find((t) => t.days_of_week?.includes(dayAbbr));
    let customWithExercises = customTemplates;
    if (scheduledCustom && (!scheduledCustom.exercises || scheduledCustom.exercises.length === 0)) {
      try {
        const detail = await fetchTemplateDetail(scheduledCustom.id);
        if (detail?.exercises) {
          customWithExercises = customTemplates.map((t) =>
            t.id === scheduledCustom.id ? { ...t, exercises: detail.exercises } : t
          );
        }
      } catch (err) {
        console.error('Failed to fetch scheduled template detail on reload:', err);
      }
    }

    const resolved = resolveRoutineAndExercises(
      workoutDate,
      todaySets,
      customWithExercises,
      exercises
    );

    const isToday = workoutDate === getLocalDateStr(new Date());
    if (isToday) {
      const newSession = workoutSessionStore.getOrInitSession(targetUserId, workoutDate, {
        routineName: resolved.routineName,
        exercises: resolved.exercises,
        targetSetCounts: resolved.targetSets,
        targetRepCounts: resolved.targetReps,
      });
      setActiveRoutineName(newSession.routineName);
      setActiveExercises(newSession.exercises);
      setTargetSetCounts(newSession.targetSetCounts);
      setTargetRepCounts(newSession.targetRepCounts);
      setInputDrafts(newSession.inputDrafts || {});
      setExpandedExercises(new Set(newSession.expandedExercises));
    } else {
      setActiveRoutineName(resolved.routineName);
      setActiveExercises(resolved.exercises);
      setTargetSetCounts(resolved.targetSets);
      setTargetRepCounts(resolved.targetReps);
      setInputDrafts({});
      setExpandedExercises(resolved.exercises.length > 0 ? new Set([resolved.exercises[0]]) : new Set());
    }
  };

  const ensureSession = useCallback(() => {
    manualSelectionDateRef.current = workoutDate;
    let session = workoutSessionStore.getActiveSession(targetUserId, workoutDate);
    if (!session) {
      session = workoutSessionStore.getOrInitSession(targetUserId, workoutDate, {
        routineName: activeRoutineName,
        exercises: activeExercises,
        targetSetCounts,
        targetRepCounts,
      });
    }
    return session;
  }, [targetUserId, workoutDate, activeRoutineName, activeExercises, targetSetCounts, targetRepCounts]);

  const addExercises = useCallback(
    (exercisesToAdd: Array<string | { name: string }>) => {
      if (!exercisesToAdd || exercisesToAdd.length === 0) return;
      ensureSession();

      const names = exercisesToAdd
        .map((e) => (typeof e === 'string' ? e.trim() : e.name?.trim()))
        .filter((n): n is string => Boolean(n));

      if (names.length === 0) return;

      setActiveExercises((prev) => {
        const newNames = names.filter((name) => !prev.includes(name));
        if (newNames.length === 0) return prev;
        const next = [...prev, ...newNames];
        newNames.forEach((name) => {
          workoutSessionStore.addExercise(targetUserId, workoutDate, name, 3);
        });
        return next;
      });

      setTargetSetCounts((prev) => {
        const next = { ...prev };
        names.forEach((name) => {
          if (!next[name]) next[name] = 3;
        });
        return next;
      });

      setExpandedExercises((prev) => {
        const next = new Set(prev);
        names.forEach((name) => next.add(name));
        return next;
      });
    },
    [ensureSession, targetUserId, workoutDate]
  );

  const handleAddExercise = useCallback(
    (exerciseToAdd: string) => {
      if (!exerciseToAdd) return;
      addExercises([exerciseToAdd]);
    },
    [addExercises]
  );

  const moveExercise = useCallback((index: number, direction: number) => {
    ensureSession();
    setActiveExercises((prev) => {
      const newIdx = index + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      const item = copy[index];
      copy[index] = copy[newIdx];
      copy[newIdx] = item;
      workoutSessionStore.reorderExercises(targetUserId, workoutDate, copy);
      return copy;
    });
  }, [ensureSession, targetUserId, workoutDate]);

  const removeExercise = useCallback((index: number) => {
    const exName = activeExercises[index];
    if (!exName) return;
    ensureSession();
    const next = activeExercises.filter((_, i) => i !== index);
    setActiveExercises(next);
    setTargetSetCounts((prev) => {
      const copy = { ...prev };
      delete copy[exName];
      return copy;
    });
    setTargetRepCounts((prev) => {
      const copy = { ...prev };
      delete copy[exName];
      return copy;
    });
    workoutSessionStore.removeExercise(targetUserId, workoutDate, exName);
  }, [activeExercises, ensureSession, targetUserId, workoutDate]);

  const restoreExercise = useCallback((removed: {
    exerciseName: string;
    index: number;
    targetSetCount: number;
    targetRepCount?: number;
    drafts: Record<string, SetDraftInput>;
  }) => {
    ensureSession();
    setActiveExercises((prev) => {
      if (prev.includes(removed.exerciseName)) return prev;
      const next = [...prev];
      const insertIdx = Math.min(Math.max(0, removed.index), next.length);
      next.splice(insertIdx, 0, removed.exerciseName);
      workoutSessionStore.reorderExercises(targetUserId, workoutDate, next);
      return next;
    });
    setTargetSetCounts((prev) => ({
      ...prev,
      [removed.exerciseName]: removed.targetSetCount,
    }));
    if (removed.targetRepCount !== undefined) {
      setTargetRepCounts((prev) => ({
        ...prev,
        [removed.exerciseName]: removed.targetRepCount!,
      }));
    }
    setInputDrafts((prev) => {
      const next = { ...prev, ...removed.drafts };
      Object.entries(removed.drafts).forEach(([k, d]) => {
        const idx = k.lastIndexOf('_');
        const sIdx = idx > 0 ? parseInt(k.slice(idx + 1), 10) : 1;
        workoutSessionStore.setDraftInput(targetUserId, workoutDate, removed.exerciseName, sIdx, d);
      });
      return next;
    });
  }, [ensureSession, targetUserId, workoutDate]);

  const adjustTargetSets = useCallback((exName: string, delta: number) => {
    const minSets = Math.max(1, getSetsForExerciseToday(exName).length);
    ensureSession();
    setTargetSetCounts((prev) => {
      const current = prev[exName] || 3;
      const next = Math.min(20, Math.max(minSets, current + delta));
      workoutSessionStore.updateTargetSets(targetUserId, workoutDate, exName, next);
      return { ...prev, [exName]: next };
    });
  }, [ensureSession, getSetsForExerciseToday, targetUserId, workoutDate]);

  const updateDraft = useCallback((
    exName: string,
    setIndex: number,
    field: 'weight' | 'reps',
    value: string
  ) => {
    const sanitized = sanitizeDraftValue(field, value);
    if (sanitized === null) return;

    const draftKey = `${exName}_${setIndex}`;
    ensureSession();
    setInputDrafts((prev) => {
      const existing = prev[draftKey];
      const updated: SetDraftInput = {
        weight: field === 'weight' ? sanitized : existing?.weight,
        reps: field === 'reps' ? sanitized : existing?.reps,
      } as SetDraftInput;
      workoutSessionStore.setDraftInput(targetUserId, workoutDate, exName, setIndex, updated);
      return {
        ...prev,
        [draftKey]: updated,
      };
    });
  }, [ensureSession, targetUserId, workoutDate]);

  const handleClearWorkout = useCallback(() => {
    setActiveRoutineName('Free Workout');
    setActiveExercises([]);
    setTargetSetCounts({});
    setTargetRepCounts({});
    setInputDrafts({});
    manualSelectionDateRef.current = workoutDate;
    workoutSessionStore.clearWorkout(targetUserId, workoutDate);
  }, [targetUserId, workoutDate]);

  const isScheduledRoutineDirty = useMemo(() => {
    return checkIsScheduledRoutineDirty({
      workoutDate,
      activeRoutineName,
      activeExercises,
      customTemplates,
      exercises,
      inputDrafts,
      targetSetCounts,
      targetRepCounts,
    });
  }, [workoutDate, activeRoutineName, activeExercises, customTemplates, exercises, inputDrafts, targetSetCounts, targetRepCounts]);

  const isWholeWorkoutCompleted =
    activeExercises.length > 0 &&
    activeExercises.every((exName) => getSetsForExerciseToday(exName).length >= (targetSetCounts[exName] || 3));

  useEffect(() => {
    if (!logsFetched || activeExercises.length === 0) return;
    const isToday = workoutDate === getLocalDateStr(new Date());
    if (!isToday) return;

    const session = workoutSessionStore.getSession(targetUserId, workoutDate);
    if (!session) return;

    if (isWholeWorkoutCompleted && todaySets.length > 0) {
      if (!session.completedAt) {
        workoutSessionStore.completeSession(targetUserId, workoutDate);
      }
    } else {
      if (session.completedAt) {
        workoutSessionStore.reopenSession(targetUserId, workoutDate);
      }
    }
  }, [isWholeWorkoutCompleted, logsFetched, activeExercises.length, todaySets.length, workoutDate, targetUserId]);

  // Synchronous teardown on date switch or unmount
  useEffect(() => {
    return () => {
      workoutSessionStore.flushPendingWrites();
    };
  }, [workoutDate, targetUserId]);

  return {
    workoutDate,
    setWorkoutDate,
    activeRoutineName,
    setActiveRoutineName,
    activeExercises,
    setActiveExercises,
    targetSetCounts,
    setTargetSetCounts,
    targetRepCounts,
    setTargetRepCounts,
    expandedExercises,
    setExpandedExercises,
    inputDrafts,
    setInputDrafts,
    todaySets,
    getSetsForExerciseToday,
    toggleAccordion,
    collapseExercise,
    collapseCompleted,
    toggleAllAccordions,
    handleSelectRoutine,
    handleReloadScheduledRoutine,
    handleAddExercise,
    addExercises,
    moveExercise,
    removeExercise,
    adjustTargetSets,
    updateDraft,
    handleClearWorkout,
    restoreExercise,
    isScheduledRoutineDirty,
    isWholeWorkoutCompleted,
  };
}
