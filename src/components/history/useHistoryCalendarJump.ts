import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { HistorySession } from './useWorkoutHistory';
import { normalizeDateStr } from '../../utils/ghostSets';

export function getSessionCivilDate(s: HistorySession): string {
  return s.civil_date || s.workout_date || (s.date ? normalizeDateStr(s.date) : '');
}

export interface UseHistoryCalendarJumpOptions {
  sessions: HistorySession[];
  hasMore: boolean;
  isLoadingMore: boolean;
  isSessionsPending?: boolean;
  loadMore: () => void;
  setTimeRange: (range: 'all' | '90d' | '30d' | '1y') => void;
  targetUserId?: string;
}

export interface UseHistoryCalendarJumpResult {
  isCalendarOpen: boolean;
  setIsCalendarOpen: (open: boolean) => void;
  highlightDate?: string;
  setHighlightDate: (date: string | undefined) => void;
  jumpStatusMessage: string | null;
  setJumpStatusMessage: (msg: string | null) => void;
  handleSelectDate: (civilDate: string) => void;
  sessionDates: string[];
}

/**
 * useHistoryCalendarJump (H29, D-P5b-5)
 *
 * Coordinates jumping to a target date from HistoryCalendarSheet:
 * 1. Sets timeRange to 'all'.
 * 2. If the date is already in loaded sessions, immediately highlights it.
 * 3. Otherwise, reacts to `sessions` updates by repeatedly calling `loadMore`
 *    until the date is found (up to 10 pages).
 * 4. If not found after 10 pages or when !hasMore, shows a StatusBanner info
 *    message: "Load older sessions to reach <date>".
 */
export function useHistoryCalendarJump({
  sessions,
  hasMore,
  isLoadingMore,
  isSessionsPending = false,
  loadMore,
  setTimeRange,
  targetUserId,
}: UseHistoryCalendarJumpOptions): UseHistoryCalendarJumpResult {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | undefined>(undefined);
  const [jumpStatusMessage, setJumpStatusMessage] = useState<string | null>(null);
  const pagesLoadedRef = useRef(0);

  // Reset state during render when targetUserId changes
  const [prevUserId, setPrevUserId] = useState(targetUserId);
  if (prevUserId !== targetUserId) {
    setPrevUserId(targetUserId);
    setTargetDate(null);
    setHighlightDate(undefined);
    setJumpStatusMessage(null);
  }

  useEffect(() => {
    pagesLoadedRef.current = 0;
  }, [targetUserId]);

  // H29: Clear highlight after use so the ring indicator does not persist indefinitely
  useEffect(() => {
    if (!highlightDate) return;
    const timer = setTimeout(() => {
      setHighlightDate(undefined);
    }, 2500);
    return () => clearTimeout(timer);
  }, [highlightDate]);

  const handleSelectDate = useCallback(
    (civilDate: string) => {
      setTimeRange('all');
      setJumpStatusMessage(null);
      setIsCalendarOpen(false);

      const found = sessions.some((s) => getSessionCivilDate(s) === civilDate);
      if (found) {
        setHighlightDate(civilDate);
        setTargetDate(null);
        pagesLoadedRef.current = 0;
      } else {
        setHighlightDate(undefined);
        setTargetDate(civilDate);
        pagesLoadedRef.current = 0;
      }
    },
    [sessions, setTimeRange]
  );

  // Reaction effect: checks new pages of sessions as they load
  useEffect(() => {
    if (!targetDate) return;
    if (isSessionsPending) return;

    const found = sessions.some((s) => getSessionCivilDate(s) === targetDate);
    if (found) {
      queueMicrotask(() => {
        setHighlightDate(targetDate);
        setTargetDate(null);
        pagesLoadedRef.current = 0;
      });
      return;
    }

    if (!hasMore || pagesLoadedRef.current >= 10) {
      queueMicrotask(() => {
        setJumpStatusMessage(`Load older sessions to reach ${targetDate}`);
        setTargetDate(null);
        pagesLoadedRef.current = 0;
      });
      return;
    }

    if (!isLoadingMore) {
      pagesLoadedRef.current += 1;
      loadMore();
    }
  }, [targetDate, sessions, hasMore, isLoadingMore, isSessionsPending, loadMore]);

  const sessionDates = useMemo(() => {
    const dates = new Set<string>();
    for (const s of sessions) {
      const d = getSessionCivilDate(s);
      if (d) dates.add(d);
    }
    return Array.from(dates);
  }, [sessions]);

  return {
    isCalendarOpen,
    setIsCalendarOpen,
    highlightDate,
    setHighlightDate,
    jumpStatusMessage,
    setJumpStatusMessage,
    handleSelectDate,
    sessionDates,
  };
}
