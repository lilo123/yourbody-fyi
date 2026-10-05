import React from 'react';
import { Sheet } from '../common/Sheet';
import { Button } from '../common/Button';

export interface RemoveExerciseSheetProps {
  isOpen: boolean;
  onClose: () => void;
  exerciseName: string;
  loggedSetsCount: number;
  onRemoveAndDeleteSets: () => void;
  onKeepSetsAndCollapse: () => void;
  isDeleting?: boolean;
}

export const RemoveExerciseSheet: React.FC<RemoveExerciseSheetProps> = ({
  isOpen,
  onClose,
  exerciseName,
  loggedSetsCount,
  onRemoveAndDeleteSets,
  onKeepSetsAndCollapse,
  isDeleting = false,
}) => {
  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Remove Exercise"
      testId="remove-exercise-sheet"
      className="max-w-md"
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-white">
            &ldquo;{exerciseName}&rdquo; has {loggedSetsCount} logged set{loggedSetsCount === 1 ? '' : 's'}.
          </p>
          <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
            Removing this exercise will delete its logged sets from today&apos;s workout history. If you want to keep the logged sets in your history, you can collapse the card instead.
          </p>
        </div>

        <div className="space-y-2.5 pt-2">
          <Button
            type="button"
            variant="destructive"
            size="md"
            isLoading={isDeleting}
            onClick={onRemoveAndDeleteSets}
            testId="remove-delete-sets-btn"
            className="w-full min-h-[44px]"
          >
            Remove &amp; delete {loggedSetsCount} logged set{loggedSetsCount === 1 ? '' : 's'}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isDeleting}
            onClick={onKeepSetsAndCollapse}
            testId="keep-sets-collapse-btn"
            className="w-full min-h-[44px]"
          >
            Keep sets, collapse card
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isDeleting}
            onClick={onClose}
            testId="remove-exercise-cancel-btn"
            className="w-full min-h-[44px]"
          >
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
};
