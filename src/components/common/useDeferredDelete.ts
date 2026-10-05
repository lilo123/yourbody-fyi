import { useState, useRef, useEffect, useCallback } from 'react';

export interface PendingDelete<T> {
  item: T;
  label: string;
}

export interface UseDeferredDeleteOptions<T> {
  commit: (item: T) => Promise<void> | void;
  durationMs?: number;
  onError?: (error: unknown, item: T) => void;
}

export interface UseDeferredDeleteReturn<T> {
  pending: PendingDelete<T> | null;
  schedule: (item: T, label: string) => void;
  undo: () => void;
  flush: () => void;
}

export function useDeferredDelete<T>({
  commit,
  durationMs = 6000,
  onError,
}: UseDeferredDeleteOptions<T>): UseDeferredDeleteReturn<T> {
  const [pending, setPending] = useState<PendingDelete<T> | null>(null);

  const commitRef = useRef(commit);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    commitRef.current = commit;
    onErrorRef.current = onError;
  });

  const pendingRef = useRef<PendingDelete<T> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeCommit = (item: T) => {
    try {
      const res = commitRef.current(item);
      if (res && typeof res.catch === 'function') {
        res.catch((err: unknown) => {
          onErrorRef.current?.(err, item);
        });
      }
    } catch (err: unknown) {
      onErrorRef.current?.(err, item);
    }
  };

  const flush = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    pendingRef.current = null;
    setPending(null);

    executeCommit(current.item);
  }, []);

  const undo = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    setPending(null);
  }, []);

  const schedule = useCallback(
    (item: T, label: string) => {
      // If one is already pending, flush (commit) the previous first
      if (pendingRef.current) {
        flush();
      }

      const nextPending = { item, label };
      pendingRef.current = nextPending;
      setPending(nextPending);

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const toCommit = pendingRef.current;
        if (toCommit) {
          pendingRef.current = null;
          setPending(null);
          executeCommit(toCommit.item);
        }
      }, durationMs);
    },
    [durationMs, flush]
  );

  useEffect(() => {
    const handlePageHide = () => {
      flush();
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flush();
    };
  }, [flush]);

  return {
    pending,
    schedule,
    undo,
    flush,
  };
}
