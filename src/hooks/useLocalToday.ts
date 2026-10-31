import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getLocalDateStr } from '../utils/date';

export interface UseLocalTodayOptions {
  /** Optional callback invoked when date automatically rolls over at midnight */
  onRollOver?: (newDate: string, previousDate: string) => void;
}

/**
 * Manages the current local date (YYYY-MM-DD), automatically advancing it across
 * local midnight when the user is viewing "today" and the app becomes visible
 * or a periodic timer triggers.
 *
 * If the user explicitly selected a different date (e.g. past or future), that selection
 * is preserved and will not be overwritten by midnight rollover.
 */
export function useLocalToday(
  initialDate?: string,
  options?: UseLocalTodayOptions
): [string, Dispatch<SetStateAction<string>>] {
  const [selectedDate, setSelectedDate] = useState<string>(() => initialDate ?? getLocalDateStr(new Date()));
  const lastSyncedTodayRef = useRef<string>(getLocalDateStr(new Date()));
  const onRollOverRef = useRef(options?.onRollOver);
  onRollOverRef.current = options?.onRollOver;

  useEffect(() => {
    const checkDateRoll = () => {
      const currentToday = getLocalDateStr(new Date());
      const previousToday = lastSyncedTodayRef.current;
      if (currentToday !== previousToday) {
        lastSyncedTodayRef.current = currentToday;
        setSelectedDate((prevDate) => {
          if (prevDate === previousToday) {
            onRollOverRef.current?.(currentToday, previousToday);
            return currentToday;
          }
          return prevDate;
        });
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        checkDateRoll();
      }
    };

    const handleFocus = () => {
      checkDateRoll();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }

    const intervalId = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        checkDateRoll();
      }
    }, 60_000);

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
      clearInterval(intervalId);
    };
  }, []);

  return [selectedDate, setSelectedDate];
}
