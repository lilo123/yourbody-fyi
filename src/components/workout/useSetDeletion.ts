import { useDeferredDelete } from '../common/useDeferredDelete';
import type { UndoToastItem } from '../common/UndoToast';
import type { WorkoutSet } from '../../types/database';
import { formatSet, type WeightUnit } from '../../utils/weight';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { useToast } from '../../hooks/useToast';

export interface UseSetDeletionOptions {
  onCommitDelete: (setId: string) => Promise<void> | void;
  timeoutMs?: number;
  onError?: (error: unknown, set: WorkoutSet) => void;
  unit?: WeightUnit;
}

export interface UseSetDeletionReturn {
  pendingSet: WorkoutSet | null;
  pendingSetId: string | null;
  scheduleDelete: (set: WorkoutSet) => void;
  undoDelete: () => void;
  flushDelete: () => void;
  toast: UndoToastItem | null;
  isPending: boolean;
}

export function useSetDeletion({
  onCommitDelete,
  timeoutMs = 6000,
  onError,
  unit: propUnit,
}: UseSetDeletionOptions): UseSetDeletionReturn {
  const contextUnit = useWeightUnit();
  const unit = propUnit ?? contextUnit;
  const { pending, schedule, undo, flush } = useDeferredDelete<WorkoutSet>({
    commit: async (set) => {
      if (set.id) {
        await onCommitDelete(set.id);
      }
    },
    durationMs: timeoutMs,
    onError,
  });

  const pendingSet = pending?.item ?? null;
  const pendingSetId = pendingSet?.id ?? null;

  const { show: showToast } = useToast();

  const scheduleDelete = (set: WorkoutSet) => {
    schedule(set, 'Set deleted');
    const setIndex = set.set_index ?? '';
    showToast({
      kind: 'undo',
      verb: 'Set deleted',
      subject: `Set ${setIndex}`.trim(),
      detail: formatSet(set.weight, set.reps, unit),
      durationMs: timeoutMs,
      onUndo: undo,
      onCommit: flush,
      undoAriaLabel: `Undo delete set ${setIndex}`.trim(),
      testId: 'quick-log-toast',
      subjectTestId: 'toast-dish-text',
      undoBtnTestId: 'toast-undo-btn',
      undoSpanTestId: 'undo-add-favorite-btn',
    });
  };

  const toast: UndoToastItem | null = pendingSet
    ? {
        verb: 'Set deleted',
        subject: `Set ${pendingSet.set_index ?? ''}`.trim(),
        detail: formatSet(pendingSet.weight, pendingSet.reps, unit),
        onUndo: undo,
        undoAriaLabel: `Undo delete set ${pendingSet.set_index ?? ''}`.trim(),
      }
    : null;

  return {
    pendingSet,
    pendingSetId,
    scheduleDelete,
    undoDelete: undo,
    flushDelete: flush,
    toast,
    isPending: Boolean(pending),
  };
}
