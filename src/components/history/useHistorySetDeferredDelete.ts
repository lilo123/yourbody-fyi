import React, { useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { WorkoutSet, Exercise } from "../../types/database";
import { useDeferredDelete } from "../common/useDeferredDelete";
import { invalidateWorkoutDerived } from "../../lib/invalidate";
import type { UndoToastItem } from "../common/UndoToast";
import type { HistorySet } from "./useHistoryData";
import { useWeightUnit } from "../../hooks/useWeightUnit";
import { formatSet } from "../../utils/weight";
import { useToast } from "../../hooks/useToast";

export interface UseHistorySetDeferredDeleteOptions {
  targetUserId?: string;
  exercises: Exercise[];
  sessions: any[];
  displayedSessions: any[];
  sessionSetsMap: Record<string, HistorySet[]>;
  setSessionSetsMap: React.Dispatch<React.SetStateAction<Record<string, HistorySet[]>>>;
  setEditingSet: (set: (WorkoutSet & { workout_date?: string; workout_name?: string }) | null) => void;
  setMutationError: (msg: string | null) => void;
}

export function useHistorySetDeferredDelete({
  targetUserId,
  exercises,
  sessions,
  displayedSessions,
  sessionSetsMap,
  setSessionSetsMap,
  setEditingSet,
  setMutationError,
}: UseHistorySetDeferredDeleteOptions) {
  const queryClient = useQueryClient();
  const unit = useWeightUnit();

  const { show: showToast } = useToast();
  const { pending, schedule, undo, flush } = useDeferredDelete<WorkoutSet>({
    commit: async (item) => {
      if (!item.id) return;
      const { error } = await supabase.from("sets").delete().eq("id", item.id);
      if (error) {
        setMutationError(error.message || "Failed to delete set.");
        throw error;
      }
      await invalidateWorkoutDerived(queryClient, targetUserId);
      const workoutId = item.workout_id;
      if (workoutId) {
        setSessionSetsMap((prev) => {
          if (!prev[workoutId]) return prev;
          return {
            ...prev,
            [workoutId]: prev[workoutId].filter((s) => s.id !== item.id),
          };
        });
      }
    },
    durationMs: 6000,
    onError: (err: unknown) => {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || "Failed to delete set.";
      setMutationError(msg);
    },
  });

  const handleDeleteSetRequested = useCallback(
    (set: WorkoutSet) => {
      setEditingSet(null);
      const label = set.exercise_name || "Workout set";
      schedule(set, label);
      showToast({
        kind: 'undo',
        verb: 'Set deleted',
        subject: label,
        detail: formatSet(set.weight, set.reps, unit),
        durationMs: 6000,
        onUndo: undo,
        onCommit: flush,
        undoAriaLabel: `Undo delete ${label}`,
        testId: 'quick-log-toast',
      });
    },
    [schedule, setEditingSet, showToast, unit, undo, flush]
  );

  const handleSetSaved = useCallback(
    (updated: WorkoutSet) => {
      const workoutId = updated.workout_id;
      if (workoutId) {
        setSessionSetsMap((prev) => {
          const existing = prev[workoutId] || sessions.find((s) => s.id === workoutId)?.sets || [];
          const nextSets = existing.map((s) =>
            s.id === updated.id
              ? {
                  ...s,
                  ...updated,
                  exercise_name:
                    exercises.find((e) => e.id === updated.exercise_id)?.name ||
                    s.exercise_name,
                }
              : s
          );
          return { ...prev, [workoutId]: nextSets };
        });
      }
      setEditingSet(null);
    },
    [exercises, sessions, setEditingSet, setSessionSetsMap]
  );

  const displayedSessionsWithSets = useMemo(() => {
    const pendingId = pending?.item.id;
    return displayedSessions.map((s) => {
      const rawSets = sessionSetsMap[s.id] || s.sets || [];
      const sets = pendingId ? rawSets.filter((item) => item.id !== pendingId) : rawSets;
      return {
        ...s,
        sets,
      };
    });
  }, [displayedSessions, sessionSetsMap, pending]);

  const toastItem: UndoToastItem | null = useMemo(() => {
    if (!pending) return null;
    const set = pending.item;
    const name = set.exercise_name || "Workout set";
    const detail = formatSet(set.weight, set.reps, unit);
    return {
      verb: "Set deleted",
      subject: name,
      detail,
      onUndo: undo,
      undoAriaLabel: `Undo delete ${name}`,
    };
  }, [pending, undo, unit]);

  return {
    pendingDelete: pending,
    handleDeleteSetRequested,
    handleSetSaved,
    displayedSessionsWithSets,
    flushDelete: flush,
    toastItem,
  };
}
