import React from 'react';
import type { Exercise, WorkoutSet } from '../../types/database';
import type { CatalogExercise } from '../../lib/exercises';
import type { UndoToastItem } from '../common/UndoToast';
import type { PendingReviewSet } from './FinishReviewSheet';
import { EditSetSheet } from '../sets/EditSetSheet';
import { RemoveExerciseSheet } from './RemoveExerciseSheet';
import { FinishReviewSheet } from './FinishReviewSheet';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExercisePicker, type ExercisePickerProps } from '../exercises/ExercisePicker';

export interface WorkoutDialogsProps {
  // Edit Set Sheet
  isEditSheetOpen: boolean;
  editingSet: (WorkoutSet & { workout_date?: string; workout_name?: string }) | null;
  exercises: Exercise[];
  targetUserId: string;
  onCloseEditSheet: () => void;
  onSavedEditSet: (set: WorkoutSet) => void;
  onDeleteRequested: (set: WorkoutSet) => void;

  // Remove Exercise Sheet
  removeSheetState: {
    isOpen: boolean;
    exerciseName: string;
    loggedSetsCount: number;
  };
  onCloseRemoveSheet: () => void;
  onConfirmRemoveAndDelete: () => void;
  onKeepSetsAndCollapse: () => void;
  isDeletingSet: boolean;

  // Finish Review Sheet
  isFinishReviewOpen: boolean;
  onCloseFinishReview: () => void;
  pendingReviewSets: PendingReviewSet[];
  onConfirmFinishWithSets: (reviewedSets: PendingReviewSet[]) => void;
  onFinishWithoutSets: () => void;
  isSubmittingFinishReview: boolean;

  // Clear Workout Confirm Dialog
  isClearConfirmOpen: boolean;
  onCancelClearConfirm: () => void;
  onConfirmClearWorkout: () => void;

  // Reload Scheduled Routine Confirm Dialog
  isReloadConfirmOpen: boolean;
  onCancelReloadConfirm: () => void;
  onConfirmReloadRoutine: () => void;

  // Deferred Delete Undo Toasts
  exerciseRemovalToast: UndoToastItem | null;
  deleteToast: UndoToastItem | null;

  // Exercise Picker Sheet
  isExercisePickerOpen: boolean;
  onCloseExercisePicker: () => void;
  onAddExercisesFromPicker: (chosen: CatalogExercise[]) => void;
  activeExerciseNames: string[];
  userLogs?: ExercisePickerProps['userLogs'];
}

export const WorkoutDialogs: React.FC<WorkoutDialogsProps> = ({
  isEditSheetOpen,
  editingSet,
  exercises,
  targetUserId,
  onCloseEditSheet,
  onSavedEditSet,
  onDeleteRequested,
  removeSheetState,
  onCloseRemoveSheet,
  onConfirmRemoveAndDelete,
  onKeepSetsAndCollapse,
  isDeletingSet,
  isFinishReviewOpen,
  onCloseFinishReview,
  pendingReviewSets,
  onConfirmFinishWithSets,
  onFinishWithoutSets,
  isSubmittingFinishReview,
  isClearConfirmOpen,
  onCancelClearConfirm,
  onConfirmClearWorkout,
  isReloadConfirmOpen,
  onCancelReloadConfirm,
  onConfirmReloadRoutine,
  isExercisePickerOpen,
  onCloseExercisePicker,
  onAddExercisesFromPicker,
  activeExerciseNames,
  userLogs,
}) => {
  return (
    <>
      {/* Edit Set Sheet */}
      <EditSetSheet
        isOpen={isEditSheetOpen}
        set={editingSet}
        exercises={exercises}
        targetUserId={targetUserId}
        onClose={onCloseEditSheet}
        onSaved={onSavedEditSet}
        onDeleteRequested={onDeleteRequested}
      />

      {/* Remove Exercise Sheet */}
      <RemoveExerciseSheet
        isOpen={removeSheetState.isOpen}
        onClose={onCloseRemoveSheet}
        exerciseName={removeSheetState.exerciseName}
        loggedSetsCount={removeSheetState.loggedSetsCount}
        onRemoveAndDeleteSets={onConfirmRemoveAndDelete}
        onKeepSetsAndCollapse={onKeepSetsAndCollapse}
        isDeleting={isDeletingSet}
      />

      {/* Finish Review Sheet */}
      <FinishReviewSheet
        isOpen={isFinishReviewOpen}
        onClose={onCloseFinishReview}
        pendingSets={pendingReviewSets}
        onConfirmFinishWithSets={onConfirmFinishWithSets}
        onFinishWithoutSets={onFinishWithoutSets}
        isSubmitting={isSubmittingFinishReview}
      />

      {/* Clear Workout Confirm Dialog */}
      <ConfirmDialog
        isOpen={isClearConfirmOpen}
        onCancel={onCancelClearConfirm}
        onConfirm={onConfirmClearWorkout}
        title="Clear workout?"
        consequence="Logged sets stay in history. All exercises and drafts will be cleared from today's workout."
        confirmLabel="Clear workout"
        cancelLabel="Cancel"
        isDestructive={true}
        testId="clear-workout-dialog"
      />

      {/* Reload Scheduled Routine Confirm Dialog */}
      <ConfirmDialog
        isOpen={isReloadConfirmOpen}
        onCancel={onCancelReloadConfirm}
        onConfirm={onConfirmReloadRoutine}
        title="Reload scheduled routine?"
        consequence="This will discard your customized exercises and any unlogged set drafts."
        confirmLabel="Reload routine"
        cancelLabel="Cancel"
        isDestructive={true}
        testId="reload-routine-dialog"
      />



      {/* Exercise Picker Sheet */}
      <ExercisePicker
        isOpen={isExercisePickerOpen}
        onClose={onCloseExercisePicker}
        onAdd={onAddExercisesFromPicker}
        activeExerciseNames={activeExerciseNames}
        targetUserId={targetUserId}
        userLogs={userLogs}
      />
    </>
  );
};
