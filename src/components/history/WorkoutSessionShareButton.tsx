import React, { useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { HistorySession } from './useWorkoutHistory';
import type { Exercise } from '../../types/database';
import type { WeightUnit } from '../../utils/weight';
import { useToast } from '../../hooks/useToast';
import { shareWorkoutStory, type ShareWorkoutStoryDeps } from '../../utils/workoutStoryShare';

export interface WorkoutSessionShareButtonProps {
  session: HistorySession;
  exercises?: Exercise[];
  unit?: WeightUnit;
  deps?: ShareWorkoutStoryDeps;
}

export const WorkoutSessionShareButton: React.FC<WorkoutSessionShareButtonProps> = ({
  session,
  exercises = [],
  unit = 'lb',
  deps,
}) => {
  const { show: showToast } = useToast();
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (isSharing) return;
      setIsSharing(true);
      try {
        await shareWorkoutStory(session, exercises, unit, showToast, deps);
      } finally {
        setIsSharing(false);
      }
    },
    [session, exercises, unit, showToast, isSharing, deps]
  );

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={isSharing}
      aria-label="Share workout"
      data-testid={`share-session-btn-${session.id}`}
      className="min-w-[44px] min-h-[44px] rounded-xl bg-zinc-800/60 hover:bg-cyan-500/20 text-zinc-400 hover:text-cyan-300 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isSharing ? (
        <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
      ) : (
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />
        </svg>
      )}
    </button>
  );
};
