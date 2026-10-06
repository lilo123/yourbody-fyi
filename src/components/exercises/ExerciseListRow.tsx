import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Archive, EyeOff, RotateCcw } from 'lucide-react';
import type { Exercise } from '../../types/database';
import type { CatalogExercise } from '../../lib/exercises';
import { Tag } from '../common/Tag';
import { getEquipmentLabel } from '../../constants/muscleGroups';

export type ExerciseRowItem = CatalogExercise | (Exercise & {
  equipment?: string | null;
  body_parts?: string[] | null;
  is_hidden?: boolean;
});

export interface ExerciseListRowProps {
  exercise: ExerciseRowItem;
  currentUserId?: string | null;
  isCoach?: boolean;
  athleteFirstName?: string;
  onEdit?: (exercise: ExerciseRowItem) => void;
  onArchive?: (exercise: ExerciseRowItem) => void;
  onDelete?: (exercise: ExerciseRowItem) => void; // backwards-compatible alias for onArchive
  onRestore?: (exercise: ExerciseRowItem) => void;
  onHide?: (exercise: ExerciseRowItem) => void;
  onUnhide?: (exercise: ExerciseRowItem) => void;
  isActionPending?: boolean;
}

export const ExerciseListRow: React.FC<ExerciseListRowProps> = ({
  exercise: ex,
  currentUserId,
  isCoach = false,
  athleteFirstName,
  onEdit,
  onArchive,
  onDelete,
  onRestore,
  onHide,
  onUnhide,
  isActionPending = false,
}) => {
  const [clickedAction, setClickedAction] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const handleAction = (type: string, fn?: (exercise: ExerciseRowItem) => void) => {
    if (isActionPending || clickedAction) return;
    setClickedAction(type);
    try {
      fn?.(ex);
    } finally {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setClickedAction(null);
      }, 300);
    }
  };

  const isHidden = Boolean(ex.is_hidden);
  const isArchived = Boolean(ex.is_archived);

  // Masters show no Edit/Archive for anyone; only own non-master rows are editable/archivable
  const isOwnRow = Boolean(currentUserId) && ex.user_id === currentUserId;
  const canEdit = !ex.is_master && !isArchived && !isHidden && isOwnRow && Boolean(onEdit);
  const canArchive = !ex.is_master && !isArchived && !isHidden && isOwnRow && (Boolean(onArchive) || Boolean(onDelete));
  const canHide = ex.is_master && !isArchived && !isHidden && Boolean(currentUserId) && Boolean(onHide);
  const canRestore = isArchived && !ex.is_master && isOwnRow && Boolean(onRestore);
  const canUnhide = isHidden && Boolean(currentUserId) && Boolean(onUnhide);

  // Owner pills: Default / You / <athlete first name> / From coach
  let ownerPill: React.ReactNode = null;
  if (ex.is_master) {
    ownerPill = <Tag label="Default" tone="info" testId={`tag-default-${ex.id}`} />;
  } else if (isOwnRow) {
    ownerPill = <Tag label="You" tone="neutral" testId={`tag-you-${ex.id}`} />;
  } else if (isCoach && !isOwnRow) {
    ownerPill = <Tag label={athleteFirstName || 'Athlete'} tone="info" testId={`tag-athlete-${ex.id}`} />;
  } else if (!isCoach && !isOwnRow) {
    ownerPill = <Tag label="From coach" tone="info" testId={`tag-coach-${ex.id}`} />;
  }

  const equipment = ex.equipment && typeof ex.equipment === 'string' ? ex.equipment : null;
  const equipmentLabel = equipment ? getEquipmentLabel(equipment) : null;
  const bodyParts = ex.body_parts && Array.isArray(ex.body_parts) ? ex.body_parts : null;
  const bodyPartText =
    bodyParts && bodyParts.length > 0
      ? bodyParts.join(' · ')
      : null;

  return (
    <div
      data-testid={`exercise-row-${ex.id}`}
      className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 flex justify-between items-center text-sm font-medium min-w-0 gap-3"
    >
      <div className="min-w-0 flex-1">
        <div className="text-zinc-100 flex items-center gap-2 min-w-0 flex-wrap">
          {/* First span contains exercise name per exercise-catalog locator contract */}
          <span className="truncate">{ex.name}</span>
          {ownerPill}
          {isArchived && <Tag label="Archived" tone="warning" testId={`tag-archived-${ex.id}`} />}
          {isHidden && <Tag label="Hidden" tone="neutral" testId={`tag-hidden-${ex.id}`} />}
        </div>
        <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1.5 flex-wrap min-w-0">
          {bodyPartText && (
            <div data-testid="exercise-row-subtitle" className="text-xs text-zinc-400 inline">
              {bodyPartText}
            </div>
          )}
          {bodyPartText && equipmentLabel && (
            <span className="text-zinc-600" aria-hidden="true">
              ·
            </span>
          )}
          {equipmentLabel && <span>{equipmentLabel}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {canEdit && (
          <button
            type="button"
            onClick={() => handleAction('edit', onEdit)}
            data-testid={`edit-exercise-${ex.id}`}
            disabled={isActionPending || Boolean(clickedAction)}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-cyan-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
            title="Edit Exercise"
            aria-label={`Edit ${ex.name}`}
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}

        {canArchive && (
          <button
            type="button"
            onClick={() => handleAction('archive', onArchive || onDelete)}
            data-testid={`archive-exercise-${ex.id}`}
            disabled={isActionPending || Boolean(clickedAction)}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-rose-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
            title="Archive exercise"
            aria-label={`Archive ${ex.name}`}
          >
            <Archive className="w-4 h-4" />
          </button>
        )}

        {canHide && (
          <button
            type="button"
            onClick={() => handleAction('hide', onHide)}
            data-testid={`hide-exercise-${ex.id}`}
            disabled={isActionPending || Boolean(clickedAction)}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-amber-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
            title="Hide exercise"
            aria-label={`Hide ${ex.name}`}
          >
            <EyeOff className="w-4 h-4" />
          </button>
        )}

        {canRestore && (
          <button
            type="button"
            onClick={() => handleAction('restore', onRestore)}
            data-testid={`restore-exercise-${ex.id}`}
            disabled={isActionPending || Boolean(clickedAction)}
            className="px-2.5 py-1 min-h-[44px] min-w-[44px] flex items-center justify-center gap-1 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition touch-manipulation cursor-pointer disabled:opacity-50"
            title="Restore exercise"
            aria-label={`Restore ${ex.name}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore</span>
          </button>
        )}

        {canUnhide && (
          <button
            type="button"
            onClick={() => handleAction('unhide', onUnhide)}
            data-testid={`unhide-exercise-${ex.id}`}
            disabled={isActionPending || Boolean(clickedAction)}
            className="px-2.5 py-1 min-h-[44px] min-w-[44px] flex items-center justify-center gap-1 text-xs font-semibold rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition touch-manipulation cursor-pointer disabled:opacity-50"
            title="Unhide exercise"
            aria-label={`Unhide ${ex.name}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Unhide</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ExerciseListRow;
