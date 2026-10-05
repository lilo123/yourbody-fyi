import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { Exercise, RoutineTemplate } from "../../types/database";
import { restTimerStore } from "../../utils/restTimerStore";
import { workoutSessionStore } from "../../utils/workoutSessionStore";
import { queryKeys } from "../../lib/queryKeys";
import { invalidateWorkoutDerived } from "../../lib/invalidate";
import {
  getOrCreateWorkout,
  insertSet,
  batchInsertSets,
  deleteSet,
} from "../../lib/sets";
import { newId } from "../../offline";
import { isUUID } from "./workoutEngineHelpers";

export interface ExerciseCardError {
  message: string;
  onRetry?: () => void;
}

export interface UseWorkoutMutationsOptions {
  targetUserId: string;
  workoutDate: string;
  activeRoutineName: string;
  exercises: Exercise[];
  customTemplates?: RoutineTemplate[];
  autoRestTimer: boolean;
  setMutationError?: (err: string | null) => void;
  onDraftSuccess?: (variables: {
    exerciseName?: string;
    exerciseId?: string;
    setIndex: number;
  }) => void;
}

export function useWorkoutMutations({
  targetUserId,
  workoutDate,
  activeRoutineName,
  exercises,
  customTemplates,
  autoRestTimer,
  setMutationError: externalSetMutationError,
  onDraftSuccess,
}: UseWorkoutMutationsOptions) {
  const queryClient = useQueryClient();

  const [pageMutationError, setPageMutationError] = useState<string | null>(null);
  const [exerciseErrors, setExerciseErrors] = useState<Record<string, ExerciseCardError>>({});

  const setMutationError = useCallback((err: string | null) => {
    setPageMutationError(err);
    if (externalSetMutationError) {
      externalSetMutationError(err);
    }
  }, [externalSetMutationError]);

  const clearMutationError = useCallback(() => {
    setPageMutationError(null);
    if (externalSetMutationError) {
      externalSetMutationError(null);
    }
  }, [externalSetMutationError]);

  const setExerciseError = useCallback((exerciseName: string, message: string, onRetry?: () => void) => {
    setExerciseErrors((prev) => ({
      ...prev,
      [exerciseName]: { message, onRetry },
    }));
  }, []);

  const clearExerciseError = useCallback((exerciseName: string) => {
    setExerciseErrors((prev) => {
      if (!prev[exerciseName]) return prev;
      const next = { ...prev };
      delete next[exerciseName];
      return next;
    });
  }, []);

  const resolveUserId = async (): Promise<string> => {
    if (targetUserId) return targetUserId;
    const { data: authData } = await supabase.auth.getUser();
    const resolved = authData?.user?.id || "";
    if (!resolved) throw new Error("Authenticated user required to log workout");
    return resolved;
  };

  const resolveExerciseId = async (exerciseIdentifier: string): Promise<string> => {
    if (!exerciseIdentifier) {
      throw new Error("Exercise identifier required");
    }
    if (isUUID(exerciseIdentifier)) {
      return exerciseIdentifier;
    }
    const norm = exerciseIdentifier.trim().toLowerCase();
    const matchedEx = exercises.find(
      (e) => e.id === exerciseIdentifier || e.name.trim().toLowerCase() === norm
    );
    if (matchedEx?.id) {
      return matchedEx.id;
    }

    // 1. Prefer exercise id carried by routine/template items when present
    const templatesToCheck = customTemplates
      ? [
          ...customTemplates.filter((t) => t.name.trim().toLowerCase() === activeRoutineName.trim().toLowerCase()),
          ...customTemplates.filter((t) => t.name.trim().toLowerCase() !== activeRoutineName.trim().toLowerCase()),
        ]
      : [];

    for (const tpl of templatesToCheck) {
      if (Array.isArray(tpl.exercises)) {
        for (const item of tpl.exercises) {
          const itemName = item.exercise?.name || (item as any).exercise_name;
          if (
            itemName &&
            itemName.trim().toLowerCase() === norm &&
            item.exercise_id &&
            isUUID(item.exercise_id)
          ) {
            return item.exercise_id;
          }
        }
      }
    }

    // 2. Single scoped lookup against exercises table (visible to user, is_archived=false, case-insensitive exact name)
    try {
      const { data, error } = await supabase
        .from("exercises")
        .select("id, name")
        .eq("is_archived", false)
        .ilike("name", exerciseIdentifier.trim())
        .limit(1)
        .maybeSingle();

      if (!error && data?.id && isUUID(data.id)) {
        return data.id;
      }
    } catch {
      // Fall through to error
    }

    throw new Error(`Exercise "${exerciseIdentifier}" cannot be resolved to a valid UUID.`);
  };

  const logSetMutation = useMutation({
    mutationFn: async (payload: {
      exerciseName?: string;
      exerciseId?: string;
      weight: number;
      reps: number;
      setIndex: number;
      setType?: "working" | "warmup" | "drop";
      rpe?: number | null;
    }) => {
      const effectiveUserId = await resolveUserId();
      const exerciseId = payload.exerciseId && isUUID(payload.exerciseId)
        ? payload.exerciseId
        : await resolveExerciseId(payload.exerciseName || "");

      const workoutId = await getOrCreateWorkout(
        supabase,
        effectiveUserId,
        workoutDate,
        activeRoutineName
      );

      const setId = newId();
      const loggedSet = await insertSet(
        supabase,
        workoutId,
        {
          id: setId,
          exerciseId,
          weight: payload.weight,
          reps: payload.reps,
          setIndex: payload.setIndex,
          setType: payload.setType || "working",
          rpe: payload.rpe ?? null,
          workoutDate,
          targetUserId: effectiveUserId,
        }
      );

      return loggedSet;
    },
    onMutate: async (newSetPayload) => {
      if (newSetPayload.exerciseName) {
        clearExerciseError(newSetPayload.exerciseName);
      }
      const effectiveUserId = targetUserId || "";
      const dateKey = queryKeys.workoutSets.byDate(effectiveUserId, workoutDate);
      const ninetyKey = queryKeys.workoutSets.recent90d(effectiveUserId);
      const workoutsKey = queryKeys.workouts.byDate(effectiveUserId, workoutDate);

      await queryClient.cancelQueries({ queryKey: dateKey });
      await queryClient.cancelQueries({ queryKey: ninetyKey });
      await queryClient.cancelQueries({ queryKey: workoutsKey });

      const prevDateData = queryClient.getQueryData(dateKey);
      const prevNinetyData = queryClient.getQueryData(ninetyKey);
      const prevWorkoutsData = queryClient.getQueryData(workoutsKey);

      return { prevDateData, prevNinetyData, prevWorkoutsData, dateKey, ninetyKey, workoutsKey };
    },
    onError: (err: unknown, _vars, context) => {
      if (context?.dateKey && context.prevDateData !== undefined) {
        queryClient.setQueryData(context.dateKey, context.prevDateData);
      }
      if (context?.ninetyKey && context.prevNinetyData !== undefined) {
        queryClient.setQueryData(context.ninetyKey, context.prevNinetyData);
      }
      if (context?.workoutsKey && context.prevWorkoutsData !== undefined) {
        queryClient.setQueryData(context.workoutsKey, context.prevWorkoutsData);
      }
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || "Failed to log set. Please try again.";
      if (_vars?.exerciseName) {
        setExerciseError(_vars.exerciseName, message, () => {
          logSetMutation.mutate(_vars);
        });
      } else {
        setMutationError(message);
      }
    },
    onSuccess: (_data, variables, context) => {
      if (_data && context?.dateKey) {
        queryClient.setQueryData(context.dateKey, (old: any) => {
          const arr = Array.isArray(old) ? old : [];
          if (arr.some((s: any) => s.id === _data.id)) return arr;
          return [...arr, _data];
        });
      }
      if (variables.exerciseName) {
        clearExerciseError(variables.exerciseName);
      }
      const effectiveUserId = targetUserId || "";
      const exId = variables.exerciseId || (variables.exerciseName ? exercises.find(e => e.name.toLowerCase() === variables.exerciseName?.toLowerCase())?.id : "");
      if (exId) {
        workoutSessionStore.clearDraft(effectiveUserId, workoutDate, exId, variables.setIndex);
      }
      if (variables.exerciseName) {
        workoutSessionStore.clearDraft(effectiveUserId, workoutDate, variables.exerciseName, variables.setIndex);
      }
      if (onDraftSuccess) {
        onDraftSuccess(variables);
      }
      if (autoRestTimer) {
        restTimerStore.start(90);
      }
    },
    onSettled: async () => {
      await invalidateWorkoutDerived(queryClient, targetUserId);
    },
  });

  const batchLogSetsMutation = useMutation({
    mutationFn: async (
      setsToLog: {
        exerciseName?: string;
        exerciseId?: string;
        weight: number;
        reps: number;
        setIndex: number;
        setType?: "working" | "warmup" | "drop";
        rpe?: number | null;
      }[]
    ) => {
      if (setsToLog.length === 0) return [];
      const effectiveUserId = await resolveUserId();

      const workoutId = await getOrCreateWorkout(
        supabase,
        effectiveUserId,
        workoutDate,
        activeRoutineName
      );

      const payloads = await Promise.all(
        setsToLog.map(async (s) => {
          const exerciseId = s.exerciseId && isUUID(s.exerciseId)
            ? s.exerciseId
            : await resolveExerciseId(s.exerciseName || "");
          return {
            id: newId(),
            exerciseId,
            weight: s.weight,
            reps: s.reps,
            setIndex: s.setIndex,
            setType: s.setType || "working",
            rpe: s.rpe ?? null,
            workoutDate,
            targetUserId: effectiveUserId,
          };
        })
      );

      return await batchInsertSets(supabase, workoutId, payloads, effectiveUserId);
    },
    onSuccess: (_data, variables) => {
      if (Array.isArray(_data)) {
        const dateKey = ['workout_sets', targetUserId, workoutDate];
        queryClient.setQueryData(dateKey, (old: any) => {
          const arr = Array.isArray(old) ? old : [];
          const existingIds = new Set(arr.map((s: any) => s.id));
          const newSets = _data.filter((s: any) => !existingIds.has(s.id));
          return [...arr, ...newSets];
        });
      }
      const effectiveUserId = targetUserId || "";
      for (const s of variables) {
        const exId = s.exerciseId || (s.exerciseName ? exercises.find(e => e.name.toLowerCase() === s.exerciseName?.toLowerCase())?.id : "");
        if (exId) {
          workoutSessionStore.clearDraft(effectiveUserId, workoutDate, exId, s.setIndex);
        }
        if (s.exerciseName) {
          workoutSessionStore.clearDraft(effectiveUserId, workoutDate, s.exerciseName, s.setIndex);
          clearExerciseError(s.exerciseName);
        }
        if (onDraftSuccess) {
          onDraftSuccess(s);
        }
      }
      if (autoRestTimer) {
        restTimerStore.start(90);
      }
    },
    onError: (err: unknown, variables) => {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || "Failed to log sets. Please try again.";
      const affectedName = variables?.[0]?.exerciseName;
      if (affectedName) {
        setExerciseError(affectedName, message, () => {
          batchLogSetsMutation.mutate(variables);
        });
      } else {
        setMutationError(message);
      }
    },
    onSettled: async () => {
      await invalidateWorkoutDerived(queryClient, targetUserId);
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      await deleteSet(supabase, setId);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || "Failed to delete set. Please try again.";
      setMutationError(message);
    },
    onSettled: async () => {
      await invalidateWorkoutDerived(queryClient, targetUserId);
    },
  });

  return {
    logSetMutation,
    batchLogSetsMutation,
    deleteSetMutation,
    resolveExerciseId,
    mutationError: pageMutationError,
    clearMutationError,
    exerciseErrors,
    clearExerciseError,
    setExerciseError,
    setMutationError,
  };
}
