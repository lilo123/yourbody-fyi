import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ToastContext } from './ToastContextTypes';
import type {
  ToastKind,
  ActiveToast,
  ToastOptions,
  ToastContextValue,
} from './ToastContextTypes';

let nextToastId = 1;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeToast, setActiveToast] = useState<ActiveToast | null>(null);
  const [offset, setOffset] = useState<number | undefined>(undefined);

  const activeToastRef = useRef<ActiveToast | null>(null);

  // Keep activeToastRef in sync
  useEffect(() => {
    activeToastRef.current = activeToast;
  }, [activeToast]);

  const commitActiveToast = useCallback((toast: ActiveToast | null) => {
    if (toast && toast.kind === 'undo' && !toast.committed) {
      toast.committed = true;
      try {
        void toast.onCommit?.();
      } catch (err) {
        console.error('Error committing undo toast:', err);
      }
    }
  }, []);

  // Flush and commit any pending undo toast on unmount (STD-FB-1)
  useEffect(() => {
    return () => {
      commitActiveToast(activeToastRef.current);
    };
  }, [commitActiveToast]);

  const dismiss = useCallback(() => {
    const current = activeToastRef.current;
    if (current) {
      commitActiveToast(current);
      current.onDismiss?.();
    }
    activeToastRef.current = null;
    setActiveToast(null);
  }, [commitActiveToast]);

  const show = useCallback(
    (options: ToastOptions) => {
      const current = activeToastRef.current;
      if (current) {
        // Commits replaced undo toast exactly like expiry
        commitActiveToast(current);
        current.onDismiss?.();
      }

      const kind: ToastKind =
        options.kind ??
        (options.action?.label === 'Undo' || options.onUndo ? 'undo' : 'success');
      const durationMs = options.durationMs ?? (kind === 'undo' ? 6000 : 4000);

      const verb = options.verb ?? '';
      const subject = options.subject ?? options.message ?? '';
      const detail = options.detail;
      const onAction = options.action?.onAction ?? options.onUndo;
      const label = options.action?.label ?? options.undoLabel ?? 'Undo';
      const ariaLabel = options.action?.ariaLabel ?? options.undoAriaLabel;

      const record: ActiveToast = {
        id: `toast-${nextToastId++}`,
        kind,
        durationMs,
        onCommit: options.onCommit,
        onDismiss: options.onDismiss,
        committed: false,
        testId: options.testId,
        subjectTestId: options.subjectTestId,
        undoBtnTestId: options.undoBtnTestId,
        undoSpanTestId: options.undoSpanTestId,
        children: options.children,
        offset: options.offset,
        item: {
          id: options.verb ? undefined : options.message,
          verb,
          subject,
          detail,
          undoLabel: label,
          undoAriaLabel: ariaLabel,
          onUndo: onAction
            ? async () => {
                // If action is clicked, it was undone; do NOT commit
                record.committed = true;
                try {
                  await onAction();
                } finally {
                  record.onDismiss?.();
                  if (activeToastRef.current?.id === record.id) {
                    activeToastRef.current = null;
                    setActiveToast(null);
                  }
                }
              }
            : undefined,
        },
      };

      activeToastRef.current = record;
      setActiveToast(record);
    },
    [commitActiveToast]
  );

  const value: ToastContextValue = {
    show,
    dismiss,
    activeToast,
    offset,
    setOffset,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
};
