import React from 'react';
import { AlertCircle, Layers, ChevronDown, Timer, Trash2 } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { IconButton } from '../common/IconButton';
import { restTimerStore } from '../../utils/restTimerStore';
import { workoutSessionStore } from '../../utils/workoutSessionStore';

export interface WorkoutHeaderProps {
  mutationError: string | null;
  onClearMutationError: () => void;
  activeRoutineName: string;
  onOpenRoutineModal: () => void;
  workoutDate: string;
  onDateChange: (date: string) => void;
  onClearWorkout: () => void;
}

export const WorkoutHeader: React.FC<WorkoutHeaderProps> = ({
  mutationError,
  onClearMutationError,
  activeRoutineName,
  onOpenRoutineModal,
  workoutDate,
  onDateChange,
  onClearWorkout,
}) => {
  return (
    <>
      {/* Mutation Error Notification */}
      <StatusBanner
        message={mutationError}
        tone="error"
        icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          <IconButton
            variant="ghost"
            size="md"
            aria-label="Dismiss error"
            onClick={onClearMutationError}
            className="text-rose-400 hover:text-white"
          >
            ✕
          </IconButton>
        }
      />

      {/* Routine & Date Control Banner */}
      <div className="bg-gradient-to-b from-zinc-900 to-zinc-900/80 border border-zinc-800/80 rounded-2xl p-3 sm:p-4 shadow-xl overflow-hidden">
        <h2 className="sr-only">Workout session</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 shrink-0">
              Routine:
            </span>
            <button
              type="button"
              onClick={onOpenRoutineModal}
              className="bg-zinc-800/90 hover:bg-zinc-700/80 border border-border-interactive hover:border-cyan-500/50 text-white text-xs font-bold px-3 h-11 min-h-[44px] min-w-[44px] rounded-xl flex items-center gap-2 transition-all shadow-sm cursor-pointer touch-manipulation"
              data-testid="routine-select-btn"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[110px] sm:max-w-[200px]">{activeRoutineName}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400 ml-0.5 shrink-0" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => restTimerStore.toggleHeaderTimer()}
              className="bg-zinc-800/90 hover:bg-zinc-700/80 border border-border-interactive hover:border-cyan-500/50 text-cyan-300 text-xs font-bold px-3 h-11 min-h-[44px] min-w-[44px] rounded-xl flex items-center gap-1.5 transition-all shadow-sm touch-manipulation shrink-0 cursor-pointer"
              title="Rest Timer"
              data-testid="rest-timer-btn"
            >
              <Timer className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
              <span>Rest Timer</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 shrink-0">
                Date:
              </span>
              <input
                type="date"
                aria-label="Workout date"
                value={workoutDate}
                onChange={(e) => {
                  workoutSessionStore.flushPendingWrites();
                  onDateChange(e.target.value);
                }}
                className="date-pill bg-zinc-950 border border-border-interactive text-cyan-400 rounded-xl px-2 h-11 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none shadow-inner cursor-pointer touch-manipulation max-w-[145px] sm:max-w-none"
                data-testid="workout-date-input"
              />
            </div>
            <button
              type="button"
              onClick={onClearWorkout}
              className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold px-3 h-11 min-h-[44px] min-w-[44px] rounded-xl text-xs transition flex items-center gap-1.5 shadow-[0_0_10px_rgba(244,63,94,0.15)] active:scale-95 touch-manipulation cursor-pointer shrink-0"
              title="Clear Workout"
              aria-label="Clear workout"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
