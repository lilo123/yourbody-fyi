import React, { createContext } from 'react';
import type { UndoToastItem } from '../components/common/UndoToast';

export type ToastKind = 'success' | 'info' | 'undo';

export interface ToastAction {
  label: string;
  onAction: () => void | Promise<void>;
  ariaLabel?: string;
  testId?: string;
}

export interface ToastOptions {
  message?: string;
  kind?: ToastKind;
  action?: ToastAction;
  durationMs?: number;
  verb?: string;
  subject?: string;
  detail?: string;
  testId?: string;
  subjectTestId?: string;
  undoBtnTestId?: string;
  undoSpanTestId?: string;
  children?: React.ReactNode;
  onCommit?: () => void | Promise<void>;
  onDismiss?: () => void;
  onUndo?: () => void | Promise<void>;
  undoLabel?: string;
  undoAriaLabel?: string;
  offset?: number;
}

export interface ActiveToast {
  id: string;
  kind: ToastKind;
  item: UndoToastItem;
  durationMs: number;
  onCommit?: () => void | Promise<void>;
  onDismiss?: () => void;
  committed: boolean;
  testId?: string;
  subjectTestId?: string;
  undoBtnTestId?: string;
  undoSpanTestId?: string;
  children?: React.ReactNode;
  offset?: number;
}

export interface ToastContextValue {
  show: (options: ToastOptions) => void;
  dismiss: () => void;
  activeToast: ActiveToast | null;
  offset: number | undefined;
  setOffset: React.Dispatch<React.SetStateAction<number | undefined>>;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
