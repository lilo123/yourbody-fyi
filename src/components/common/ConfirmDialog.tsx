import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AccessibleModal } from './AccessibleModal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  consequence: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  testId?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  consequence,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = true,
  isLoading = false,
  testId,
}) => {
  const titleId = useId();

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onCancel}
      titleId={titleId}
      testId={testId}
      className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-zinc-800 p-5 space-y-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        {isDestructive && (
          <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-400" aria-hidden="true" />
          </div>
        )}
        <div className="space-y-1.5 min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-bold text-white">
            {title}
          </h2>
          <div className="text-xs text-zinc-400 font-normal leading-relaxed">
            {consequence}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={isLoading}
          onClick={onCancel}
          testId={testId ? `${testId}-cancel` : 'confirm-dialog-cancel'}
          className="flex-1"
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={isDestructive ? 'destructive' : 'primary'}
          size="md"
          isLoading={isLoading}
          onClick={onConfirm}
          testId={testId ? `${testId}-confirm` : 'confirm-dialog-confirm'}
          className="flex-1"
        >
          {confirmLabel}
        </Button>
      </div>
    </AccessibleModal>
  );
};
