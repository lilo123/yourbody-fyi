import React from 'react';
import { Check } from 'lucide-react';
import { Tag } from '../../common/Tag';
import { getEquipmentLabel } from '../../../constants/muscleGroups';
import type { CatalogExercise } from '../../../lib/exercises';

export interface ExerciseRowProps {
  exercise: CatalogExercise;
  isSelected: boolean;
  isInWorkout: boolean;
  onToggle: (exercise: CatalogExercise) => void;
}

export const ExerciseRow: React.FC<ExerciseRowProps> = ({
  exercise,
  isSelected,
  isInWorkout,
  onToggle,
}) => {
  const bodyPartStr =
    exercise.body_parts && exercise.body_parts.length > 0
      ? exercise.body_parts.join(', ')
      : '';

  const equipmentStr = getEquipmentLabel(exercise.equipment);
  const subtitleParts = [bodyPartStr, equipmentStr].filter(Boolean);
  const subtitle = subtitleParts.join(' · ');

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-disabled={isInWorkout}
      disabled={isInWorkout}
      onClick={() => onToggle(exercise)}
      data-testid={`exercise-row-${exercise.id}`}
      className={`w-full text-left flex items-center justify-between gap-3 p-3 min-h-[44px] rounded-xl border transition-all select-none touch-manipulation cursor-pointer ${
        isInWorkout
          ? 'bg-zinc-900/40 border-zinc-800/40 opacity-60 cursor-not-allowed'
          : isSelected
          ? 'bg-cyan-500/10 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.12)]'
          : 'bg-zinc-900/80 hover:bg-zinc-800/80 border-zinc-800/80 hover:border-zinc-700'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate">
            {exercise.name}
          </span>
          {exercise.is_master && (
            <span className="text-xs uppercase font-bold tracking-wider text-zinc-300 px-1.5 py-0.5 rounded bg-zinc-800/60 border border-zinc-700/40 shrink-0">
              Default
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-zinc-400 truncate mt-0.5">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isInWorkout ? (
          <Tag tone="neutral" label="In workout" testId={`in-workout-tag-${exercise.id}`} />
        ) : (
          <div
            className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-cyan-500 border-cyan-400 text-zinc-950'
                : 'border-zinc-700 bg-zinc-950/60'
            }`}
          >
            {isSelected && <Check className="w-4 h-4 stroke-[3]" aria-hidden="true" />}
          </div>
        )}
      </div>
    </button>
  );
};
