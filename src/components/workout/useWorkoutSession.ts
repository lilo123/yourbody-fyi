import { useState, useEffect, useMemo, useRef, useCallback, useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import type { WorkoutSet, Exercise, RoutineTemplate } from '../../types/database';
import {
  normalizeDateStr,
  getLocalDateStr,
  getDayOfWeekAbbr,
  DEFAULT_WORKOUT_TEMPLATES,
  DEFAULT_EXERCISES_LIST,
} from '../../utils/ghostSets';
import { workoutSessionStore, type SetDraftInput } from '../../utils/workoutSessionStore';
import {
  isUUID,
  resolveRoutineAndExercises,
  checkIsScheduledRoutineDirty,
  isOwnOrAssignedRoutine,
  shouldHideStarterRoutines,
  isDefaultRoutineHidden,
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
import { enqueueAndAwait, applyPendingToDaySets } from '../../offline';
import { useWorkoutPendingOps } from './useWorkoutPendingOps';
import { useToast } from '../../hooks/useToast';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { convertDraftWeight, type WeightUnit } from '../../utils/weight';

export interface UseWorkoutSessionOptions {
  targetUserId: string;
  exercises: Exercise[];
  exercisesFetched: boolean;
  customTemplates: RoutineTemplate[];
  templatesFetched: boolean;
  userLogs: (WorkoutSet & { workout_date: string; workout_name?: string })[];
  logsFetched: boolean;
  onSessionRoutineChange?: () => void;
  unit?: WeightUnit;
  hasLoadedCatalog?: boolean;
  isCatalogPending?: boolean;
  hiddenRoutineNames?: Set<string> | string[];
}

export function useWorkoutSession({
  targetUserId,
  exercises,
  exercisesFetched,
  customTemplates,
  templatesFetched,
  userLogs,
  logsFetched,
  unit = 'lb',
  hasLoadedCatalog,
  isCatalogPending,
  hiddenRoutineNames,
}: UseWorkoutSessionOptions) {
  const queryClient = useContext(QueryClientContext);
  const { show: showToast } = useToast();
  const isOnline = useOnlineStatus();

  const catalogLoaded = hasLoadedCatalog !== undefined ? hasLoadedCatalog : templatesFetched;
  const catalogPending = isCatalogPending !== undefined ? isCatalogPending : (!catalogLoaded && isOnline);

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

  const [workoutDate, setWorkoutDate] = useState<string>(() => {
    const activeSession = workoutSessionStore.getActiveSession(targetUserId);
    if (activeSession && activeSession.workoutDate) {
      return activeSession.workoutDate;
    }
    return getLocalDateStr(new Date());
  });

  const initialSession = workoutSessionStore.getActiveSession(targetUserId, workoutDate);
  if (initialSession?.weightUnit && initialSession.weightUnit !== unit) {
    for (const draft of Object.values(initialSession.inputDrafts || {})) {
      if (draft && draft.weight !== undefined) {
        draft.weight = convertDraftWeight(draft.weight, initialSession.weightUnit, unit);
      }
    }
    initialSession.weightUnit = unit;
    workoutSessionStore.saveSession(initialSession, false);
  }
  const initialState = getInitialRoutineState(
    initialSession,
    workoutDate,
    customTemplates,
    catalogLoaded,
    catalogPending,
    resolvedHiddenNames,
    targetUserId
  );

  const [activeRoutineName, setActiveRoutineName] = useState<string>(initialState.activeRoutineName);
  const [activeExercises, setActiveExercises] = useState<string[]>(initialState.activeExercises);
  const [targetSetCounts, setTargetSetCounts] = useState<Record<string, number>>(initialState.targetSetCounts);
  const [targetRepCounts, setTargetRepCounts] = useState<Record<string, number>>(initialState.targetRepCounts);
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(initialState.expandedExercises);
  const [inputDrafts, setInputDrafts] = useState<Record<string, SetDraftInput>>(
    () => initialSession?.inputDrafts ?? {}
  );

  const pendingOps = useWorkoutPendingOps(targetUserId);

  const resolvedKeyRef = useRef<string | null>(null);
  const manualSelectionDateRef = useRef<string | null>(null);
  const prevManualSelectionDateRef = useRef<string | null | undefined>(undefined);
  const inFlightRoutineSelectionSeqRef = useRef<number>(0);
  const lastTargetUserRef = useRef<string>(targetUserId);
  const routineSelectionSeqRef = useRef<number>(0);
  const reResolvedPendingDateRef = useRef<string | null>(null);

  const todaySets = useMemo(() => {
    const rawToday = userLogs.filter((s) => normalizeDateStr(s.workout_date) === workoutDate);
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
  }, [userLogs, pendingOps, workoutDate, exercises]);

  const getSetsForExerciseToday = useCallback((exName: string) => {
    return filterSetsForExercise(exName, todaySets, exercises);
  }, [exercises, todaySets]);

  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    if (lastTargetUserRef.current !== targetUserId) {
      lastTargetUserRef.current = targetUserId;
      routineSelectionSeqRef.current++;
      prevManualSelectionDateRef.current = undefined;
      inFlightRoutineSelectionSeqRef.current = 0;
      workoutSessionStore.flushPendingWrites();
      setInputDrafts({});
      setActiveExercises([]);
      setTargetSetCounts({});
      setTargetRepCounts({});
      resolvedKeyRef.current = null;
      manualSelectionDateRef.current = null;
      reResolvedPendingDateRef.current = null;
    }

    if (!templatesFetched || !logsFetched || !exercisesFetched) return;

    if (manualSelectionDateRef.current && manualSelectionDateRef.current !== workoutDate) {
      manualSelectionDateRef.current = null;
    }

    if (manualSelectionDateRef.current === workoutDate) return;

    const hasPendingOpsToday = todaySets.some((s) => (s as any).pending);
    const canReResolveForPendingOps =
      hasPendingOpsToday &&
      reResolvedPendingDateRef.current !== workoutDate &&
      manualSelectionDateRef.current !== workoutDate &&
      (activeRoutineName === 'Rest Day' || activeExercises.length === 0);

    const resolutionKey = `${targetUserId}_${workoutDate}`;
    if (resolvedKeyRef.current === resolutionKey && !canReResolveForPendingOps) return;
    resolvedKeyRef.current = resolutionKey;

    if (canReResolveForPendingOps) {
      reResolvedPendingDateRef.current = workoutDate;

      const resolved = resolveRoutineAndExercises(
        workoutDate,
        todaySets,
        customTemplates,
        exercises,
        [],
        catalogLoaded,
        resolvedHiddenNames,
        targetUserId
      );

      const isToday = workoutDate === getLocalDateStr(new Date());
      if (isToday) {
        workoutSessionStore.updateRoutine(
          targetUserId,
          workoutDate,
          resolved.routineName,
          resolved.exercises,
          resolved.targetSets,
          resolved.targetReps
        );
      }

      setActiveRoutineName(resolved.routineName);
      setActiveExercises(resolved.exercises);
      setTargetSetCounts(resolved.targetSets);
      setTargetRepCounts(resolved.targetReps);
      setInputDrafts({});
      setExpandedExercises(resolved.exercises.length > 0 ? new Set([resolved.exercises[0]]) : new Set());
      return;
    }

    const existingSession = workoutSessionStore.getActiveSession(targetUserId, workoutDate);
    if (existingSession) {
      if (existingSession.weightUnit && existingSession.weightUnit !== unit) {
        for (const draft of Object.values(existingSession.inputDrafts || {})) {
          if (draft && draft.weight !== undefined) {
            draft.weight = convertDraftWeight(draft.weight, existingSession.weightUnit, unit);
          }
        }
        existingSession.weightUnit = unit;
        workoutSessionStore.saveSession(existingSession, false);
      }

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
      exercises,
      [],
      catalogLoaded,
      resolvedHiddenNames,
      targetUserId
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
  }, [workoutDate, targetUserId, templatesFetched, logsFetched, exercisesFetched, customTemplates, todaySets, exercises, getSetsForExerciseToday, activeRoutineName, activeExercises.length, unit, catalogLoaded, resolvedHiddenNames]);

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

  const cancelRoutineSelection = useCallback(() => {
    routineSelectionSeqRef.current++;
    if (prevManualSelectionDateRef.current !== undefined) {
      manualSelectionDateRef.current = prevManualSelectionDateRef.current;
      prevManualSelectionDateRef.current = undefined;
    }
    inFlightRoutineSelectionSeqRef.current = 0;
  }, []);

  const isFirstWorkoutDateRef = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstWorkoutDateRef.current) {
      isFirstWorkoutDateRef.current = false;
      return;
    }
    cancelRoutineSelection();
  }, [workoutDate, cancelRoutineSelection]);

  useEffect(() => {
    return () => {
      routineSelectionSeqRef.current++;
      if (prevManualSelectionDateRef.current !== undefined) {
        manualSelectionDateRef.current = prevManualSelectionDateRef.current;
        prevManualSelectionDateRef.current = undefined;
      }
      inFlightRoutineSelectionSeqRef.current = 0;
    };
  }, []);

  const handleSelectRoutine = async (routineName: string, selectedTemplate?: RoutineTemplate) => {
    const seq = ++routineSelectionSeqRef.current;
    const prevManualDate = prevManualSelectionDateRef.current !== undefined
      ? prevManualSelectionDateRef.current
      : manualSelectionDateRef.current;
    prevManualSelectionDateRef.current = prevManualDate;
    inFlightRoutineSelectionSeqRef.current = seq;
    manualSelectionDateRef.current = workoutDate;

    let resolvedExList: string[] = [];
    let resolvedTargets: Record<string, number> = {};
    let resolvedReps: Record<string, number> = {};

    try {
      if (routineName === 'Rest Day' || (routineName === 'Free Workout' && todaySets.length === 0)) {
        if (seq !== routineSelectionSeqRef.current) {
          if (inFlightRoutineSelectionSeqRef.current === seq) {
            manualSelectionDateRef.current = prevManualDate;
            prevManualSelectionDateRef.current = undefined;
            inFlightRoutineSelectionSeqRef.current = 0;
          }
          return;
        }
        setActiveRoutineName(routineName);
        setActiveExercises([]);
        setTargetSetCounts({});
        setTargetRepCounts({});
        setExpandedExercises(new Set());
      } else {
        const customTpl = selectedTemplate || findMatchingTemplate(customTemplates, routineName);
        const startersHidden = shouldHideStarterRoutines(customTemplates, targetUserId, catalogLoaded);
        const defTpl = startersHidden
          ? undefined
          : findMatchingTemplate(
              DEFAULT_WORKOUT_TEMPLATES.filter(
                (t) => !isDefaultRoutineHidden(t.name, customTemplates, resolvedHiddenNames, catalogLoaded, targetUserId)
              ),
              routineName
            );

        let templateExercises = customTpl?.exercises;
        if (customTpl && templateExercises === undefined) {
          try {
            const detail = await fetchTemplateDetail(customTpl.id, { queryClient, userId: targetUserId });
            if (!detail) {
              throw new Error('Template detail unavailable');
            }
            templateExercises = detail.exercises || [];
          } catch (err) {
            console.error('Failed to fetch template detail for selection:', err);
            if (inFlightRoutineSelectionSeqRef.current === seq) {
              manualSelectionDateRef.current = prevManualDate;
              prevManualSelectionDateRef.current = undefined;
              inFlightRoutineSelectionSeqRef.current = 0;
              if (seq === routineSelectionSeqRef.current && !isOnline) {
                showToast({ message: 'Available when online' });
              }
            }
            return;
          }
        }

        if (seq !== routineSelectionSeqRef.current) {
          if (inFlightRoutineSelectionSeqRef.current === seq) {
            manualSelectionDateRef.current = prevManualDate;
            prevManualSelectionDateRef.current = undefined;
            inFlightRoutineSelectionSeqRef.current = 0;
          }
          return;
        }

        const extracted = extractTemplateDetails(customTpl, defTpl, templateExercises, exercises);
        resolvedExList = extracted.resolvedExList;
        resolvedTargets = extracted.resolvedTargets;
        resolvedReps = extracted.resolvedReps;

        if (todaySets.length > 0) {
          const loggedExercises = Array.from(
            new Set(
              todaySets
                .map(
                  (s) =>
                    s.exercise?.name ||
                    exercises.find((ex) => ex.id === s.exercise_id)?.name ||
                    DEFAULT_EXERCISES_LIST.find((ex) => ex.id === s.exercise_id)?.name ||
                    s.exercise_name ||
                    s.exercise_id
                )
                .filter(Boolean)
            )
          );
          const distinctLoggedNotInBase = loggedExercises.filter(
            (name) =>
              !resolvedExList.some(
                (baseName) => baseName.trim().toLowerCase() === name.trim().toLowerCase()
              )
          );

          if (distinctLoggedNotInBase.length > 0) {
            resolvedExList = [...resolvedExList, ...distinctLoggedNotInBase];
            distinctLoggedNotInBase.forEach((name) => {
              if (targetRepCounts[name]) {
                resolvedReps[name] = targetRepCounts[name];
              }
            });
          }

          resolvedExList.forEach((exName) => {
            const loggedSetsForEx = filterSetsForExercise(exName, todaySets, exercises);
            const currentTarget = resolvedTargets[exName] || targetSetCounts[exName] || 3;
            resolvedTargets[exName] = Math.max(currentTarget, loggedSetsForEx.length);
          });
        }

        setActiveRoutineName(routineName);
        setActiveExercises(resolvedExList);
        setTargetSetCounts(resolvedTargets);
        setTargetRepCounts(resolvedReps);
        if (resolvedExList.length > 0) setExpandedExercises(new Set([resolvedExList[0]]));
        else setExpandedExercises(new Set());
      }

      if (seq !== routineSelectionSeqRef.current) {
        if (inFlightRoutineSelectionSeqRef.current === seq) {
          manualSelectionDateRef.current = prevManualDate;
          prevManualSelectionDateRef.current = undefined;
          inFlightRoutineSelectionSeqRef.current = 0;
        }
        return;
      }

      manualSelectionDateRef.current = workoutDate;
      if (inFlightRoutineSelectionSeqRef.current === seq) {
        prevManualSelectionDateRef.current = undefined;
        inFlightRoutineSelectionSeqRef.current = 0;
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
    } catch (err) {
      if (inFlightRoutineSelectionSeqRef.current === seq) {
        manualSelectionDateRef.current = prevManualDate;
        prevManualSelectionDateRef.current = undefined;
        inFlightRoutineSelectionSeqRef.current = 0;
      }
      throw err;
    }
  };

  const handleReloadScheduledRoutine = async () => {
    const seq = ++routineSelectionSeqRef.current;
    prevManualSelectionDateRef.current = undefined;
    inFlightRoutineSelectionSeqRef.current = 0;
    workoutSessionStore.deleteSession(targetUserId, workoutDate);
    manualSelectionDateRef.current = null;
    resolvedKeyRef.current = null;

    const dayAbbr = getDayOfWeekAbbr(workoutDate);
    const scheduledOwn = customTemplates.find(
      (t) => isOwnOrAssignedRoutine(t, targetUserId) && t.days_of_week?.includes(dayAbbr)
    );
    const scheduledCustom = scheduledOwn || customTemplates.find((t) => t.days_of_week?.includes(dayAbbr));
    let customWithExercises = customTemplates;
    if (scheduledCustom && (!scheduledCustom.exercises || scheduledCustom.exercises.length === 0)) {
      try {
        const detail = await fetchTemplateDetail(scheduledCustom.id, { queryClient, userId: targetUserId });
        if (detail?.exercises) {
          customWithExercises = customTemplates.map((t) =>
            t.id === scheduledCustom.id ? { ...t, exercises: detail.exercises } : t
          );
        }
      } catch (err) {
        console.error('Failed to fetch scheduled template detail on reload:', err);
      }
    }

    if (seq !== routineSelectionSeqRef.current) return;

    const resolved = resolveRoutineAndExercises(
      workoutDate,
      todaySets,
      customWithExercises,
      exercises,
      [],
      catalogLoaded,
      resolvedHiddenNames,
      targetUserId
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
    workoutSessionStore.updateTargetSets(
      targetUserId,
      workoutDate,
      removed.exerciseName,
      removed.targetSetCount
    );
    if (removed.targetRepCount !== undefined) {
      setTargetRepCounts((prev) => ({
        ...prev,
        [removed.exerciseName]: removed.targetRepCount!,
      }));
      const session = workoutSessionStore.getSession(targetUserId, workoutDate);
      if (session) {
        session.targetRepCounts[removed.exerciseName] = removed.targetRepCount;
        workoutSessionStore.saveSession(session, workoutDate === getLocalDateStr(new Date()));
      }
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

    const session = workoutSessionStore.getSession(targetUserId, workoutDate);
    if (session && session.weightUnit !== unit) {
      session.weightUnit = unit;
      workoutSessionStore.saveSession(session, false);
    }
  }, [ensureSession, targetUserId, workoutDate, unit]);

  const prevUnitRef = useRef<WeightUnit>(unit);

  useEffect(() => {
    if (prevUnitRef.current !== unit) {
      const fromUnit = prevUnitRef.current;
      const toUnit = unit;
      prevUnitRef.current = unit;

      setInputDrafts((prev) => {
        let changed = false;
        const next: Record<string, SetDraftInput> = {};
        for (const [key, draft] of Object.entries(prev)) {
          if (!draft || draft.weight === undefined) {
            next[key] = draft;
            continue;
          }
          const convertedWeight = convertDraftWeight(draft.weight, fromUnit, toUnit);
          if (convertedWeight !== draft.weight) {
            changed = true;
            next[key] = { ...draft, weight: convertedWeight };
            const lastUnderscore = key.lastIndexOf('_');
            const exName = lastUnderscore > 0 ? key.slice(0, lastUnderscore) : key;
            const setIndex = lastUnderscore > 0 ? parseInt(key.slice(lastUnderscore + 1), 10) : 1;
            workoutSessionStore.setDraftInput(targetUserId, workoutDate, exName, setIndex, next[key]);
          } else {
            next[key] = draft;
          }
        }
        return changed ? next : prev;
      });

      const session = workoutSessionStore.getSession(targetUserId, workoutDate);
      if (session) {
        session.weightUnit = toUnit;
        workoutSessionStore.saveSession(session, false);
      }
    }
  }, [unit, targetUserId, workoutDate]);

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
      hasLoadedCatalog: catalogLoaded,
      hiddenRoutineNames: resolvedHiddenNames,
      targetUserId,
    });
  }, [workoutDate, activeRoutineName, activeExercises, customTemplates, exercises, inputDrafts, targetSetCounts, targetRepCounts, catalogLoaded, resolvedHiddenNames, targetUserId]);

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
    cancelRoutineSelection,
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
