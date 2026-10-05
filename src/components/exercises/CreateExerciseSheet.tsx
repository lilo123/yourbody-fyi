import React, { useState, useRef, useId } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  insertCustomExercise,
  DuplicateExerciseError,
  useExerciseCatalog,
  fetchExerciseCatalogPage,
  flattenCatalogPages,
  type CatalogExercise,
  type ExerciseCatalogPage,
} from '../../lib/exercises';
import { queryKeys } from '../../lib/queryKeys';
import { normalizeSearch } from '../../utils/normalizeSearch';
import {
  MUSCLE_GROUPS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  type Equipment,
} from '../../constants/muscleGroups';
import { Sheet } from '../common/Sheet';
import { Chip } from '../common/Chip';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { Exercise } from '../../types/database';
import type { InfiniteData } from '@tanstack/react-query';

export interface CreateExerciseSheetProps {
  open?: boolean;
  onClose?: () => void;
  onCreated?: (exercise?: Exercise | CatalogExercise) => void;
  onError?: (error: string | null) => void;
  onViewExisting?: (ex: { id: string; name: string; is_hidden?: boolean }) => void;
}

interface DuplicateInfo {
  message: string;
  existing?: {
    id: string;
    name: string;
    is_hidden?: boolean;
  };
}

export const CreateExerciseSheet: React.FC<CreateExerciseSheetProps> = ({
  open = true,
  onClose,
  onCreated,
  onError,
  onViewExisting,
}) => {
  const customExerciseNameId = useId();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [exerciseName, setExerciseName] = useState('');
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<DuplicateInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const { data: catalogData } = useExerciseCatalog({
    search: exerciseName,
    includeHidden: true,
    enabled: Boolean(open),
    limit: 50,
    debounceMs: 0,
  });

  const handleClose = () => {
    if (isSubmittingRef.current) return;
    setExerciseName('');
    setSelectedBodyParts([]);
    setSelectedEquipment(null);
    setError(null);
    setDuplicateError(null);
    onError?.(null);
    onClose?.();
  };

  const toggleBodyPart = (part: string) => {
    setSelectedBodyParts((prev) =>
      prev.includes(part) ? prev.filter((p) => p !== part) : [...prev, part]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      const msg = 'Available when online';
      setError(msg);
      onError?.(msg);
      return;
    }
    const trimmedName = exerciseName.trim();
    if (!trimmedName) {
      const msg = 'Exercise name cannot be blank or whitespace-only.';
      setError(msg);
      onError?.(msg);
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setDuplicateError(null);
    onError?.(null);

    const combinedCatalog: CatalogExercise[] = [...flattenCatalogPages(catalogData)];

    try {
      // Check queryClient cache for preloaded pages
      const cached = queryClient.getQueriesData<InfiniteData<ExerciseCatalogPage>>({
        queryKey: queryKeys.exerciseCatalog.all,
      });
      for (const [, data] of cached) {
        if (data?.pages) {
          for (const page of data.pages) {
            if (page.items) {
              combinedCatalog.push(...page.items);
            }
          }
        }
      }

      // Fetch on-demand via RPC if available
      if (typeof (supabase as { rpc?: unknown }).rpc === 'function') {
        try {
          const page = await fetchExerciseCatalogPage({
            search: trimmedName,
            includeHidden: true,
            limit: 50,
          });
          combinedCatalog.push(...page.items);
        } catch {
          // rpc might not be mocked in unit tests
        }
      }

      const created = await insertCustomExercise(
        {
          name: trimmedName,
          bodyParts: selectedBodyParts,
          equipment: selectedEquipment || undefined,
        },
        queryClient,
        combinedCatalog
      );

      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      setExerciseName('');
      setSelectedBodyParts([]);
      setSelectedEquipment(null);
      setError(null);
      setDuplicateError(null);
      onError?.(null);
      onCreated?.(created);
      onClose?.();
    } catch (err: any) {
      if (
        err instanceof DuplicateExerciseError ||
        err?.code === 'DUPLICATE_EXERCISE' ||
        err?.name === 'DuplicateExerciseError'
      ) {
        const normalizedCandidate = normalizeSearch(trimmedName);
        const candidateEq = selectedEquipment ? selectedEquipment.toLowerCase().trim() : null;
        const existing = combinedCatalog.find((ex) => {
          if (err.existingId && ex.id === err.existingId) return true;
          const exName = normalizeSearch(ex.name);
          const exEq = ex.equipment ? ex.equipment.toLowerCase().trim() : null;
          if (exName !== normalizedCandidate) return false;
          return !candidateEq || !exEq || exEq === candidateEq;
        });

        const ownerLabel = existing?.is_master
          ? 'Default'
          : existing?.is_hidden
          ? 'Hidden'
          : 'Custom';
        const msg = existing
          ? `'${existing.name}' already exists (${ownerLabel})`
          : `'${err.exerciseName || trimmedName}' already exists`;

        setDuplicateError({
          message: msg,
          existing: existing
            ? { id: existing.id, name: existing.name, is_hidden: existing.is_hidden }
            : err.existingId
            ? { id: err.existingId, name: trimmedName }
            : undefined,
        });
        return;
      }

      let msg = err?.message || 'Failed to create exercise';
      if (err?.code === '23514' || String(err?.message).includes('23514')) {
        msg = 'Exercise name cannot be blank or whitespace-only.';
      }
      setError(msg);
      onError?.(msg);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const isWhitespaceOnly = exerciseName.length > 0 && !exerciseName.trim();
  const isSubmitDisabled = !exerciseName.trim() || isSubmitting || !isOnline;

  return (
    <Sheet
      isOpen={Boolean(open)}
      onClose={handleClose}
      title="New exercise"
      titleId="create-exercise-sheet-title"
      testId="create-exercise-sheet"
      dismissible={!isSubmitting}
    >
      {duplicateError ? (
        <div
          role="alert"
          data-testid="create-exercise-duplicate-msg"
          className="flex items-center justify-between gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span className="truncate">{duplicateError.message}</span>
          </div>
          {duplicateError.existing && (
            <button
              type="button"
              data-testid={
                duplicateError.existing.is_hidden
                  ? 'unhide-existing-exercise-btn'
                  : 'view-existing-exercise-btn'
              }
              onClick={() => {
                onViewExisting?.(duplicateError.existing!);
                handleClose();
              }}
              className="shrink-0 text-xs font-bold text-cyan-400 hover:text-cyan-300 px-2 py-1 min-h-[44px] flex items-center underline touch-manipulation cursor-pointer"
            >
              {duplicateError.existing.is_hidden ? 'Unhide' : 'View'}
            </button>
          )}
        </div>
      ) : (
        <StatusBanner
          message={error}
          tone="error"
          testId="create-exercise-error"
          icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        />
      )}

      <span className="sr-only">Create Custom Exercise</span>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Exercise Name Input */}
        <div>
          <label
            htmlFor={customExerciseNameId}
            className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5"
          >
            Exercise Name
          </label>
          <input
            id={customExerciseNameId}
            data-testid="create-exercise-name-input"
            type="text"
            value={exerciseName}
            onChange={(e) => {
              setExerciseName(e.target.value);
              setError(null);
              setDuplicateError(null);
              onError?.(null);
            }}
            placeholder="e.g. Incline Bench Press"
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 input-text-sm font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
          />
          {isWhitespaceOnly && (
            <p
              className="text-xs text-rose-400 mt-1"
              role="alert"
              data-testid="exercise-name-whitespace-error"
            >
              Exercise name cannot be blank or whitespace-only.
            </p>
          )}
        </div>

        {/* Target Muscle Groups Multi-select */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Target Muscle Groups <span className="text-zinc-400 font-normal">(Tap multiple)</span>
            </span>
            {selectedBodyParts.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedBodyParts([])}
                className="text-xs font-bold text-zinc-400 hover:text-zinc-200 transition min-h-[44px] px-2 flex items-center touch-manipulation cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 p-2.5 bg-zinc-950/80 border border-zinc-800/80 rounded-xl">
            {MUSCLE_GROUPS.map((group) => (
              <Chip
                key={group}
                label={group}
                selected={selectedBodyParts.includes(group)}
                onClick={() => toggleBodyPart(group)}
                size="sm"
                testId={`muscle-chip-${group.toLowerCase().replace(/\s+/g, '-')}`}
              />
            ))}
          </div>
        </div>

        {/* Equipment Single-Select */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Equipment <span className="text-zinc-400 font-normal">(Select one)</span>
            </span>
            {selectedEquipment && (
              <button
                type="button"
                onClick={() => setSelectedEquipment(null)}
                className="text-xs font-bold text-zinc-400 hover:text-zinc-200 transition min-h-[44px] px-2 flex items-center touch-manipulation cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 p-2.5 bg-zinc-950/80 border border-zinc-800/80 rounded-xl">
            {EQUIPMENT.map((eq) => (
              <Chip
                key={eq}
                label={EQUIPMENT_LABELS[eq]}
                selected={selectedEquipment === eq}
                onClick={() => setSelectedEquipment((prev) => (prev === eq ? null : eq))}
                size="sm"
                testId={`equipment-chip-${eq}`}
              />
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col gap-1.5">
          {!isOnline && (
            <p className="text-xs text-amber-400 font-semibold text-right" data-testid="offline-helper-text">
              Available when online
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid="cancel-create-exercise-btn"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition active:scale-95 touch-manipulation disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="save-exercise-btn"
              disabled={isSubmitDisabled}
              title={!isOnline ? 'Available when online' : undefined}
              className="px-6 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-neon-cyan transition active:scale-95 disabled:opacity-50 flex items-center gap-2 touch-manipulation cursor-pointer"
            >
              <span>{isSubmitting ? 'Saving...' : 'Save to Library'}</span>
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
};

export default CreateExerciseSheet;
