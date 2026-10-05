import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { WorkoutSet, Exercise, SetType } from "../../types/database";
import { resolveExerciseLabel } from "../../utils/exerciseLabel";
import { Trash2, AlertCircle } from "lucide-react";
import { Sheet } from "../common/Sheet";
import { Button } from "../common/Button";
import { StatusBanner } from "../common/StatusBanner";
import { invalidateWorkoutDerived } from "../../lib/invalidate";
import { updateSet } from "../../lib/sets";
import { weightUnitLabel, toDisplayWeight, resolveWeightInput } from "../../utils/weight";
import { useWeightUnit } from "../../hooks/useWeightUnit";

export interface EditSetSheetProps {
  isOpen: boolean;
  set: (WorkoutSet & { workout_date?: string; workout_name?: string }) | null;
  exercises: Exercise[];
  targetUserId?: string;
  onClose: () => void;                          // Esc / Cancel / ✕ — no data change, host keeps its rows
  onSaved: (updated: WorkoutSet) => void;       // after a successful UPDATE; host closes + patches its state
  onDeleteRequested: (set: WorkoutSet) => void; // sheet never DELETEs; host closes and schedules useDeferredDelete (6s UndoToast)
  testId?: string;
}

interface EditSetFormProps {
  set: WorkoutSet & { workout_date?: string; workout_name?: string };
  exercises: Exercise[];
  targetUserId?: string;
  onClose: () => void;
  onSaved: (updated: WorkoutSet) => void;
  onDeleteRequested: (set: WorkoutSet) => void;
  testId?: string;
}

const SET_TYPES: { label: string; value: SetType }[] = [
  { label: "Working Set", value: "working" },
  { label: "Warmup Set", value: "warmup" },
  { label: "Drop Set", value: "drop" },
];

const EditSetForm: React.FC<EditSetFormProps> = ({
  set,
  exercises,
  targetUserId,
  onClose,
  onSaved,
  onDeleteRequested,
  testId = "edit-set-sheet",
}) => {
  const queryClient = useQueryClient();
  const unit = useWeightUnit();

  const initialExerciseId = (() => {
    const directMatch = exercises.find((e) => e.id === set.exercise_id);
    if (directMatch) return directMatch.id;
    const nameMatch = exercises.find(
      (e) => e.name.toLowerCase() === (set.exercise_name || set.exercise_id).toLowerCase()
    );
    return nameMatch ? nameMatch.id : set.exercise_id || (exercises[0]?.id ?? "");
  })();

  const initialWeight = set.weight !== undefined && set.weight !== null ? String(toDisplayWeight(set.weight, unit)) : "";
  const initialReps = set.reps !== undefined && set.reps !== null ? String(set.reps) : "";
  const initialRpe = set.rpe !== undefined && set.rpe !== null ? String(set.rpe) : "";
  const initialSetType: SetType = set.set_type || "working";

  const [selectedExerciseId, setSelectedExerciseId] = useState(initialExerciseId);
  const [weight, setWeight] = useState(initialWeight);
  const [reps, setReps] = useState(initialReps);
  const [rpe, setRpe] = useState(initialRpe);
  const [setType, setSetType] = useState<SetType>(initialSetType);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDirty =
    selectedExerciseId !== initialExerciseId ||
    weight !== initialWeight ||
    reps !== initialReps ||
    rpe !== initialRpe ||
    setType !== initialSetType;

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      exercise_id: string;
      weight: number;
      reps: number;
      rpe: number | null;
      set_type: SetType;
    }) => {
      const { id, ...updates } = payload;
      const expected = {
        exercise_id: set.exercise_id,
        weight: set.weight,
        reps: set.reps,
        set_type: (set.set_type as any) || "working",
        rpe: set.rpe ?? null,
      };
      return await updateSet(
        supabase,
        id,
        {
          workoutId: set.workout_id,
          exerciseId: updates.exercise_id,
          weight: updates.weight,
          reps: updates.reps,
          rpe: updates.rpe,
          setType: updates.set_type,
        },
        expected,
        targetUserId
      );
    },
    onSuccess: async (data, variables) => {
      await invalidateWorkoutDerived(queryClient, targetUserId);
      const updatedRow = (Array.isArray(data) ? data[0] : data) as WorkoutSet | undefined;
      const savedRow: WorkoutSet = {
        ...set,
        ...variables,
        ...(updatedRow || {}),
        workout_id: updatedRow?.workout_id || set.workout_id,
      };
      onSaved(savedRow);
    },
    onError: (err: any) => {
      setErrorMessage(err?.message || "Failed to update set. Please try again.");
    },
  });

  const handleWeightChange = (val: string) => {
    const sanitized = val.replace(",", ".");
    if (sanitized === "" || /^\d*\.?\d*$/.test(sanitized)) {
      setWeight(sanitized);
    }
  };

  const handleRepsChange = (val: string) => {
    if (val === "" || /^\d*$/.test(val)) {
      setReps(val);
    }
  };

  const handleRpeChange = (val: string) => {
    const sanitized = val.replace(",", ".");
    if (sanitized === "" || /^\d*\.?\d*$/.test(sanitized)) {
      setRpe(sanitized);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedExerciseId) {
      setErrorMessage("Please select an exercise.");
      return;
    }

    if (weight.trim() === "") {
      setErrorMessage("Please enter a weight (0 for bodyweight).");
      return;
    }

    const resolvedWeight = resolveWeightInput(weight, unit, set.weight);
    if (resolvedWeight === null || !Number.isFinite(resolvedWeight) || resolvedWeight < 0) {
      setErrorMessage("Weight must be 0 or greater (0 for bodyweight).");
      return;
    }

    if (reps.trim() === "") {
      setErrorMessage("Please enter reps.");
      return;
    }

    const repsVal = Number(reps.trim());
    if (!Number.isFinite(repsVal) || repsVal <= 0 || !Number.isInteger(repsVal)) {
      setErrorMessage("Reps must be an integer greater than 0.");
      return;
    }

    let rpeVal: number | null = null;
    if (rpe.trim() !== "") {
      const parsedRpe = Number(rpe.trim());
      if (!Number.isFinite(parsedRpe) || parsedRpe < 1 || parsedRpe > 10) {
        setErrorMessage("RPE must be between 1 and 10.");
        return;
      }
      rpeVal = parsedRpe;
    }

    if (!set.id) {
      setErrorMessage("Cannot update set: missing set ID.");
      return;
    }

    updateMutation.mutate({
      id: set.id,
      exercise_id: selectedExerciseId,
      weight: resolvedWeight,
      reps: repsVal,
      rpe: rpeVal,
      set_type: setType,
    });
  };

  const handleDelete = () => {
    if (!set.id) return;
    onDeleteRequested(set);
  };

  const isPending = updateMutation.isPending;

  return (
    <Sheet
      isOpen={true}
      onClose={onClose}
      title="Edit Workout Set"
      testId={testId}
      dismissible={!isPending}
    >
      <StatusBanner
        message={errorMessage}
        tone="error"
        icon={<AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Exercise Selector */}
        <div>
          <label
            htmlFor="edit-set-exercise"
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
          >
            Exercise
          </label>
          <select
            id="edit-set-exercise"
            data-testid="edit-set-exercise-select"
            value={selectedExerciseId}
            onChange={(e) => setSelectedExerciseId(e.target.value)}
            disabled={isPending}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl px-3 py-2.5 min-h-[44px] text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none truncate"
          >
            {!exercises.some((ex) => ex.id === selectedExerciseId) && selectedExerciseId && (
              <option value={selectedExerciseId}>
                {resolveExerciseLabel(set.exercise_name || set.exercise_id)}
              </option>
            )}
            {exercises.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name} {ex.body_parts && ex.body_parts.length > 0 ? `(${ex.body_parts.join(' · ')})` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Set Type */}
        <div>
          <label
            htmlFor="edit-set-type"
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
          >
            Set Type
          </label>
          <select
            id="edit-set-type"
            data-testid="edit-set-type-select"
            value={setType}
            onChange={(e) => setSetType(e.target.value as SetType)}
            disabled={isPending}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl px-3 py-2.5 min-h-[44px] text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none"
          >
            {SET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Weight & Reps Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="edit-set-weight"
              className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
            >
              Weight ({weightUnitLabel(unit)})
            </label>
            <input
              id="edit-set-weight"
              data-testid="edit-set-weight-input"
              type="text"
              inputMode="decimal"
              min="0"
              value={weight}
              onChange={(e) => handleWeightChange(e.target.value)}
              placeholder="0 for BW"
              disabled={isPending}
              className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl px-3 py-2.5 min-h-[44px] text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            />
            <span className="text-xs text-zinc-400 mt-1 block">0 = Bodyweight</span>
          </div>

          <div>
            <label
              htmlFor="edit-set-reps"
              className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
            >
              Reps
            </label>
            <input
              id="edit-set-reps"
              data-testid="edit-set-reps-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min="1"
              value={reps}
              onChange={(e) => handleRepsChange(e.target.value)}
              placeholder="Reps"
              disabled={isPending}
              className="w-full bg-zinc-950 border border-border-interactive text-cyan-300 rounded-xl px-3 py-2.5 min-h-[44px] text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            />
            <span className="text-xs text-zinc-400 mt-1 block">Min: 1</span>
          </div>
        </div>

        {/* Optional RPE */}
        <div>
          <label
            htmlFor="edit-set-rpe"
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5"
          >
            RPE (Optional, 1–10)
          </label>
          <input
            id="edit-set-rpe"
            data-testid="edit-set-rpe-input"
            type="text"
            inputMode="decimal"
            value={rpe}
            onChange={(e) => handleRpeChange(e.target.value)}
            placeholder="e.g. 8.5"
            disabled={isPending}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl px-3 py-2.5 min-h-[44px] h-11 text-base tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none"
          />
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center gap-3">
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={handleDelete}
            disabled={isPending || !set.id}
            testId="delete-set-btn"
            leftIcon={<Trash2 className="w-4 h-4 text-rose-400" aria-hidden="true" />}
            className="flex-1"
          >
            <span data-testid="edit-set-sheet-delete">Delete Set</span>
          </Button>

          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isPending}
            disabled={!isDirty || isPending}
            testId="save-set-btn"
            className="flex-1"
          >
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
};

export const EditSetSheet: React.FC<EditSetSheetProps> = (props) => {
  if (!props.isOpen || !props.set) return null;
  return (
    <EditSetForm
      key={props.set.id || "current-set"}
      set={props.set}
      exercises={props.exercises}
      targetUserId={props.targetUserId}
      onClose={props.onClose}
      onSaved={props.onSaved}
      onDeleteRequested={props.onDeleteRequested}
      testId={props.testId ?? "edit-set-sheet"}
    />
  );
};

export default EditSetSheet;
