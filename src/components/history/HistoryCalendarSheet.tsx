import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Sheet } from '../common/Sheet';
import { supabase } from '../../lib/supabase';
import { useWorkoutPendingOps } from '../workout/useWorkoutPendingOps';

export interface HistoryCalendarSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  timeZone?: string;
  sessionDates: string[]; // (loaded civil dates: 'YYYY-MM-DD')
  onSelectDate: (civilDate: string) => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAY_HEADERS = [
  { short: 'Su', full: 'Sunday' },
  { short: 'Mo', full: 'Monday' },
  { short: 'Tu', full: 'Tuesday' },
  { short: 'We', full: 'Wednesday' },
  { short: 'Th', full: 'Thursday' },
  { short: 'Fr', full: 'Friday' },
  { short: 'Sa', full: 'Saturday' },
];

export const HistoryCalendarSheet: React.FC<HistoryCalendarSheetProps> = ({
  open,
  onClose,
  userId,
  timeZone: _timeZone,
  sessionDates,
  onSelectDate,
}) => {
  const [viewYear, setViewYear] = useState<number>(() => {
    if (sessionDates.length > 0 && sessionDates[0]) {
      const parts = sessionDates[0].split('-');
      if (parts.length === 3) return parseInt(parts[0], 10);
    }
    return new Date().getFullYear();
  });

  const [viewMonth, setViewMonth] = useState<number>(() => {
    if (sessionDates.length > 0 && sessionDates[0]) {
      const parts = sessionDates[0].split('-');
      if (parts.length === 3) return parseInt(parts[1], 10) - 1;
    }
    return new Date().getMonth();
  });

  const [focusedDay, setFocusedDay] = useState<number>(1);
  const dayButtonRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Month bounds for lightweight Supabase query
  const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const nextMonthYear = viewMonth === 11 ? viewYear + 1 : viewYear;
  const nextMonthNum = viewMonth === 11 ? 1 : viewMonth + 2;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonthNum).padStart(2, '0')}-01`;

  // Lightweight month query for workout dates
  const { data: monthWorkouts } = useQuery({
    queryKey: ['workout_sets', userId, 'calendar_month', monthStart],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('workouts')
        .select('workout_date')
        .eq('user_id', userId)
        .gte('workout_date', monthStart)
        .lt('workout_date', nextMonthStart)
        .limit(62);

      if (error) throw error;
      return (data || []) as unknown as { workout_date: string }[];
    },
    enabled: open && Boolean(userId),
  });

  const pendingOps = useWorkoutPendingOps(userId);

  // Union of sessionDates, queried workout dates, and pending outbox ops
  const workoutDatesSet = useMemo(() => {
    const set = new Set<string>();
    for (const d of sessionDates) {
      if (d) set.add(d);
    }
    if (monthWorkouts) {
      for (const w of monthWorkouts) {
        if (w.workout_date) set.add(w.workout_date);
      }
    }
    for (const op of pendingOps) {
      if (op.kind === 'workout.ensure' && op.payload.workout_date) {
        set.add(op.payload.workout_date);
      } else if (op.kind === 'set.create') {
        const d = op.payload.created_at?.slice(0, 10);
        if (d) set.add(d);
      }
    }
    return set;
  }, [sessionDates, monthWorkouts, pendingOps]);

  const handlePrevMonth = () => {
    setFocusedDay(1);
    setViewMonth((prev) => {
      if (prev === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setFocusedDay(1);
    setViewMonth((prev) => {
      if (prev === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalWeeks = Math.ceil((firstDayOfWeek + daysInMonth) / 7);

  const focusDay = useCallback(
    (day: number) => {
      const clamped = Math.max(1, Math.min(daysInMonth, day));
      setFocusedDay(clamped);
      const btn = dayButtonRefs.current.get(clamped);
      if (btn) {
        btn.focus();
      }
    },
    [daysInMonth]
  );

  const handleKeyDown = (e: React.KeyboardEvent, day: number) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        focusDay(day - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusDay(day + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusDay(day - 7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusDay(day + 7);
        break;
      case 'Home':
        e.preventDefault();
        focusDay(1);
        break;
      case 'End':
        e.preventDefault();
        focusDay(daysInMonth);
        break;
      default:
        break;
    }
  };

  const handleSelectDay = (dateStr: string, hasWorkout: boolean) => {
    if (!hasWorkout) return;
    onSelectDate(dateStr);
    onClose();
  };

  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  return (
    <Sheet
      isOpen={open}
      onClose={onClose}
      title="Workout Calendar"
      testId="history-calendar-sheet"
    >
      <div className="space-y-4">
        {/* Month Header and Navigation */}
        <div className="flex items-center justify-between px-1">
          <h3
            data-testid="calendar-month-heading"
            className="text-sm font-bold text-white tracking-wider"
          >
            {monthLabel}
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              data-testid="calendar-prev-month-btn"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              data-testid="calendar-next-month-btn"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Calendar Grid Table */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-3">
          <table
            aria-label={`${monthLabel} workout calendar`}
            className="w-full border-collapse table-fixed"
          >
            <thead>
              <tr className="border-b border-zinc-800/60 text-center font-bold text-xs text-zinc-400">
                {DAY_HEADERS.map((dh) => (
                  <th key={dh.short} scope="col" aria-label={dh.full} className="py-1 font-bold">
                    {dh.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: totalWeeks }).map((_, weekIdx) => (
                <tr key={weekIdx}>
                  {Array.from({ length: 7 }).map((_, dayOfWeekIdx) => {
                    const cellIdx = weekIdx * 7 + dayOfWeekIdx;
                    const day = cellIdx - firstDayOfWeek + 1;

                    if (day < 1 || day > daysInMonth) {
                      return (
                        <td key={dayOfWeekIdx} aria-hidden="true" className="p-0.5 text-center min-h-[44px] min-w-[44px]">
                          <span className="invisible">0</span>
                        </td>
                      );
                    }

                    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const hasWorkout = workoutDatesSet.has(dateStr);
                    const dayName = DAY_HEADERS[dayOfWeekIdx].full;
                    const ariaLabel = `${dayName}, ${MONTH_NAMES[viewMonth]} ${day}, ${viewYear}${hasWorkout ? ', workout logged' : ''}`;
                    const isFocused = day === focusedDay;

                    return (
                      <td key={dayOfWeekIdx} className="p-0.5 text-center">
                        <button
                          ref={(node) => {
                            if (node) {
                              dayButtonRefs.current.set(day, node);
                            } else {
                              dayButtonRefs.current.delete(day);
                            }
                          }}
                          type="button"
                          disabled={!hasWorkout}
                          aria-disabled={!hasWorkout}
                          aria-label={ariaLabel}
                          tabIndex={isFocused ? 0 : -1}
                          data-date={dateStr}
                          data-has-workout={hasWorkout ? 'true' : 'false'}
                          onClick={() => handleSelectDay(dateStr, hasWorkout)}
                          onKeyDown={(e) => handleKeyDown(e, day)}
                          className={`min-h-[44px] min-w-[44px] w-full rounded-xl flex flex-col items-center justify-center text-xs tabular-nums transition touch-manipulation select-none relative ${
                            hasWorkout
                              ? 'bg-zinc-800/80 hover:bg-cyan-500/20 text-white font-bold border border-zinc-700/80 hover:border-cyan-400 active:scale-95 cursor-pointer'
                              : 'text-zinc-600 border border-transparent opacity-40 cursor-not-allowed'
                          } ${isFocused ? 'ring-2 ring-cyan-400' : ''}`}
                        >
                          <span>{day}</span>
                          {hasWorkout ? (
                            <span
                              data-testid={`workout-dot-${dateStr}`}
                              className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-0.5 shrink-0"
                            />
                          ) : (
                            <span className="w-1.5 h-1.5 mt-0.5 shrink-0" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Sheet>
  );
};
