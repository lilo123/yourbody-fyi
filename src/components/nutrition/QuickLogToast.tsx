import React, { useEffect } from 'react';
import { useToast } from '../../hooks/useToast';
import { formatCalories } from '../../utils/nutrition';

export interface QuickLogToastItem {
  id?: string;
  variant: 'logged' | 'added' | 'updated';
  dishName: string;
  calories: number;
  onUndo?: () => void | Promise<void>;
}

export interface QuickLogToastProps {
  toast: QuickLogToastItem | null;
  onDismiss: () => void;
  isStaged?: boolean;
  isTimerActive?: boolean;
}

export const QuickLogToast: React.FC<QuickLogToastProps> = ({
  toast,
  onDismiss,
  isStaged = false,
  isTimerActive = false,
}) => {
  const { show, dismiss } = useToast();

  useEffect(() => {
    if (!toast) {
      dismiss();
      return;
    }

    const isAdded = toast.variant === 'added';
    const isUpdated = toast.variant === 'updated';
    const verb = isUpdated ? 'Updated' : isAdded ? 'Added to meal' : 'Logged';
    const dishName = toast.dishName ?? '';
    const formattedKcal = isUpdated
      ? `${formatCalories(toast.calories)} kcal`
      : `+${formatCalories(toast.calories)} kcal`;

    const undoAriaLabel = isUpdated
      ? `Undo update ${dishName}`
      : isAdded
      ? `Undo add ${dishName}`
      : `Undo log ${dishName}`;

    const bottom = isTimerActive ? 148 : isStaged ? 128 : 74;

    show({
      kind: 'undo',
      verb,
      subject: dishName,
      detail: formattedKcal,
      durationMs: 5000,
      onUndo: toast.onUndo ?? (() => {}),
      onDismiss,
      undoAriaLabel,
      offset: bottom,
      testId: 'quick-log-toast',
      subjectTestId: 'toast-dish-text',
      undoBtnTestId: 'toast-undo-btn',
      undoSpanTestId: 'undo-add-favorite-btn',
      children: isAdded ? (
        <span
          data-testid="add-favorite-status-banner"
          className="sr-only"
          aria-hidden="true"
        >
          {`Added ${dishName} to staged meal`}
        </span>
      ) : undefined,
    });
  }, [toast, onDismiss, isStaged, isTimerActive, show, dismiss]);

  return null;
};
