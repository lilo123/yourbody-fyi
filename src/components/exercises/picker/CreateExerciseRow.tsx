import React from 'react';
import { Plus, AlertCircle, Loader2 } from 'lucide-react';
import { normalizeSearch } from '../../../utils/normalizeSearch';
import { getEquipmentLabel } from '../../../constants/muscleGroups';
import type { CatalogExercise } from '../../../lib/exercises';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';

export interface CreateExerciseRowProps {
  query: string;
  selectedMuscleGroup: string | null;
  selectedEquipment: string | null;
  catalog: CatalogExercise[];
  onCreate: (name: string) => void;
  isCreating: boolean;
  isOnline?: boolean;
}

export const CreateExerciseRow: React.FC<CreateExerciseRowProps> = ({
  query,
  selectedMuscleGroup,
  selectedEquipment,
  catalog,
  onCreate,
  isCreating,
  isOnline: isOnlineProp,
}) => {
  const onlineHook = useOnlineStatus();
  const isOnline = isOnlineProp !== undefined ? isOnlineProp : onlineHook;
  const trimmed = query.trim();
  if (!trimmed) return null;

  const normalizedQuery = normalizeSearch(trimmed);
  const normalizedEq =
    selectedEquipment && selectedEquipment !== 'all'
      ? selectedEquipment.toLowerCase().trim()
      : null;

  // L35: duplicate check against visible catalog (normalized name, equipment)
  const isDuplicate = catalog.some((ex) => {
    const existingName = normalizeSearch(ex.name);
    const existingEq = ex.equipment ? ex.equipment.toLowerCase().trim() : null;
    const sameName = existingName === normalizedQuery;
    if (!sameName) return false;
    return !normalizedEq || !existingEq || existingEq === normalizedEq;
  });

  const equipmentLabel = getEquipmentLabel(selectedEquipment);
  const categoryLabel = selectedMuscleGroup && selectedMuscleGroup !== 'all' ? selectedMuscleGroup : null;
  const metaDetail = [categoryLabel, equipmentLabel].filter(Boolean).join(' · ');

  if (isDuplicate) {
    return (
      <output
        aria-live="polite"
        data-testid="create-exercise-duplicate-msg"
        className="flex items-center gap-2 p-3 min-h-[44px] rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs"
      >
        <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="truncate">
          An exercise named &ldquo;{trimmed}&rdquo;{equipmentLabel ? ` (${equipmentLabel})` : ''} already exists.
        </span>
      </output>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onCreate(trimmed)}
      disabled={isCreating || !isOnline}
      data-testid="create-exercise-btn"
      className="w-full flex items-center justify-between gap-3 p-3 min-h-[44px] rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 active:scale-[0.99] border border-dashed border-cyan-500/40 text-cyan-300 transition select-none touch-manipulation cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-center gap-2.5 truncate">
        {isCreating ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-cyan-400" aria-hidden="true" />
        ) : (
          <Plus className="w-4 h-4 shrink-0 text-cyan-400" aria-hidden="true" />
        )}
        <div className="text-left truncate">
          <span className="text-sm font-semibold truncate">
            Create &ldquo;{trimmed}&rdquo;
          </span>
          {!isOnline ? (
            <p className="text-xs text-zinc-400 truncate" data-testid="create-exercise-offline-helper">
              Available when online
            </p>
          ) : metaDetail ? (
            <p className="text-xs text-cyan-400/80 truncate">
              {metaDetail}
            </p>
          ) : null}
        </div>
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 px-2 py-1 rounded-lg bg-cyan-500/20 shrink-0">
        New
      </span>
    </button>
  );
};
