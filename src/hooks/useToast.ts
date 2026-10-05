import { useContext, useEffect } from 'react';
import { ToastContext } from '../context/ToastContextTypes';
import type { ToastContextValue } from '../context/ToastContextTypes';

export { ToastProvider } from '../context/ToastContext';
export type {
  ToastKind,
  ToastAction,
  ToastOptions,
  ActiveToast,
  ToastContextValue,
} from '../context/ToastContextTypes';

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: () => {},
      dismiss: () => {},
      activeToast: null,
      offset: undefined,
      setOffset: () => {},
    };
  }
  return ctx;
}

export function useToastOffset(offsetVal: number | undefined) {
  const { setOffset } = useToast();
  useEffect(() => {
    setOffset(offsetVal);
    return () => {
      setOffset(undefined);
    };
  }, [offsetVal, setOffset]);
}
