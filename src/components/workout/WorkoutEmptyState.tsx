import React from 'react';
import { Dumbbell } from 'lucide-react';
import { Button } from '../common/Button';

export interface WorkoutEmptyStateProps {
  onOpenRoutineModal: () => void;
  onAddExerciseClick: () => void;
}

export const WorkoutEmptyState: React.FC<WorkoutEmptyStateProps> = ({
  onOpenRoutineModal,
  onAddExerciseClick,
}) => {
  return (
    <div className="bg-zinc-900/90 rounded-2xl shadow-xl p-8 text-center border border-dashed border-zinc-800 text-white space-y-4">
      <Dumbbell className="w-10 h-10 text-zinc-600 mx-auto mb-1" />
      <div>
        <p className="text-white font-bold text-base mb-1">No exercises in today's workout yet</p>
        <p className="text-xs text-zinc-400">Select a routine above or add an exercise below to start logging.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={onOpenRoutineModal}
          testId="empty-choose-routine-btn"
          className="min-h-[44px]"
        >
          Choose routine
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onAddExerciseClick}
          testId="empty-add-exercise-btn"
          className="min-h-[44px]"
        >
          Add exercise
        </Button>
      </div>
    </div>
  );
};
