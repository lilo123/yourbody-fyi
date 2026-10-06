import React, { useState, useRef, useId } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import { Sheet } from '../common/Sheet';
import { Chip } from '../common/Chip';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  MUSCLE_GROUPS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  type Equipment,
} from '../../constants/muscleGroups';
import {
  fetchExerciseCatalogPage,
  type CatalogExercise,
  type ExerciseCatalogPage,
} from '../../lib/exercises';
import { queryKeys } from '../../lib/queryKeys';
import { normalizeSearch } from '../../utils/normalizeSearch';
import type { Exercise } from '../../types/database';
import type { InfiniteData } from '@tanstack/react-query';

export interface EditExerciseSheetProps {
  isOpen: boolean;
  exercise: (Exercise & { equipment?: string | null }) | CatalogExercise | null;
  targetUserId?: string;
  onClose: () => void;
  onSuccess?: () => void;
  onSaved?: () => void;
  onViewExisting?: (ex: { id: string; name: string; is_hidden?: boolean }) => void;
}

export type EditExerciseModalProps = EditExerciseSheetProps;

interface DuplicateInfo {
  message: string;
  existing?: {
    id: string;
    name: string;
    is_hidden?: boolean;
  };
}

export const EditExerciseSheet: React.FC<EditExerciseSheetProps> = ({
  isOpen,
  exercise,
  targetUserId,
  onClose,
  onSuccess,
  onSaved,
  onViewExisting,
}) => {
  const exerciseNameId = useId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [name, setName] = useState('');
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<DuplicateInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Synchronize state on prop change during render (no setState in useEffect)
  const [prevExerciseKey, setPrevExerciseKey] = useState<string | null>(null);
  const currentExerciseKey = isOpen && exercise ? `${exercise.id}:${isOpen}` : null;
  if (currentExerciseKey !== prevExerciseKey) {
    setPrevExerciseKey(currentExerciseKey);
    if (isOpen && exercise) {
      setName(exercise.name || '');
      const exBodyParts = ('body_parts' in exercise && Array.isArray((exercise as CatalogExercise).body_parts))
        ? (exercise as CatalogExercise).body_parts
        : null;
      if (exBodyParts && exBodyParts.length > 0) {
        setSelectedBodyParts(exBodyParts);
      } else {
        setSelectedBodyParts([]);
      }
      setSelectedEquipment((exercise.equipment as Equipment) || null);
      setError(null);
      setDuplicateError(null);
    }
  }

  if (!isOpen || !exercise) return null;

  const toggleBodyPart = (part: string) => {
    setSelectedBodyParts((prev) =>
      prev.includes(part) ? prev.filter((p) => p !== part) : [...prev, part]
    );
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isOnline) {
      setError('Available when online');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Exercise name cannot be blank.');
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setDuplicateError(null);

    const candidateEquipment = selectedEquipment ? selectedEquipment.toLowerCase().trim() : null;
    const isNameChanged = normalizeSearch(trimmedName) !== normalizeSearch(exercise.name);
    const prevEq = exercise.equipment
      ? exercise.equipment.toLowerCase().trim()
      : null;
    const isEquipmentChanged = candidateEquipment !== prevEq;

    const combinedCatalog: CatalogExercise[] = [];

    try {
      // Duplicate check on rename / equipment change
      if (isNameChanged || isEquipmentChanged) {
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

        if (typeof (supabase as { rpc?: unknown }).rpc === 'function') {
          try {
            const page = await fetchExerciseCatalogPage({
              search: trimmedName,
              includeHidden: true,
              limit: 50,
            });
            combinedCatalog.push(...page.items);
          } catch {
            // rpc might not be mocked
          }
        }

        const normalizedCandidate = normalizeSearch(trimmedName);
        const duplicate = combinedCatalog.find((ex) => {
          if (ex.id === exercise.id) return false;
          const exName = normalizeSearch(ex.name);
          const exEq = ex.equipment ? ex.equipment.toLowerCase().trim() : null;
          if (exName !== normalizedCandidate) return false;
          return !candidateEquipment || !exEq || exEq === candidateEquipment;
        });

        if (duplicate) {
          const ownerLabel = duplicate.is_master
            ? 'Default'
            : duplicate.is_hidden
            ? 'Hidden'
            : 'Custom';
          setDuplicateError({
            message: `'${duplicate.name}' already exists (${ownerLabel})`,
            existing: { id: duplicate.id, name: duplicate.name, is_hidden: duplicate.is_hidden },
          });
          return; // No update happens
        }
      }

      const { data, error: updErr } = await supabase
        .from('exercises')
        .update({
          name: trimmedName,
          body_parts: selectedBodyParts.length > 0 ? selectedBodyParts : null,
          equipment: candidateEquipment,
        } as any)
        .eq('id', exercise.id)
        .select();

      if (updErr) throw updErr;
      if (!data || data.length === 0) {
        throw new Error(
          'Exercise could not be updated. You may not have permission to modify this exercise.'
        );
      }

      // In-place cascade sync to active workout session drafts
      const userIdsToSync = new Set<string>();
      if (targetUserId) userIdsToSync.add(targetUserId);
      if (user?.id) userIdsToSync.add(user.id);
      userIdsToSync.forEach((uid) => {
        workoutSessionStore.renameExercise(uid, exercise.name, trimmedName);
      });

      await queryClient.invalidateQueries({ queryKey: ['exercises'] });
      await queryClient.invalidateQueries({ queryKey: ['routine_templates'] });
      await queryClient.invalidateQueries({ queryKey: ['workout_sets'] });
      await queryClient.invalidateQueries({ queryKey: ['exercise_stats'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.exerciseCatalog.all });

      if (onSuccess) onSuccess();
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      if (
        err?.code === '23505' ||
        err?.status === 409 ||
        err?.message === 'duplicate_exercise_name' ||
        err?.message?.includes('duplicate') ||
        err?.message?.includes('unique')
      ) {
        const detailId = err?.details || err?.detail;
        const normalizedCandidate = normalizeSearch(trimmedName);
        const existing = combinedCatalog.find(
          (ex) => (detailId && ex.id === detailId) || normalizeSearch(ex.name) === normalizedCandidate
        );
        const ownerLabel = existing?.is_master
          ? 'Default'
          : existing?.is_hidden
          ? 'Hidden'
          : 'Custom';
        setDuplicateError({
          message: existing
            ? `'${existing.name}' already exists (${ownerLabel})`
            : `'${trimmedName}' already exists`,
          existing: existing
            ? { id: existing.id, name: existing.name, is_hidden: existing.is_hidden }
            : typeof detailId === 'string' && detailId.length > 0
            ? { id: detailId, name: trimmedName }
            : undefined,
        });
        return;
      }
      let msg = err?.message || 'Failed to update exercise.';
      if (err?.code === '23503' || String(err?.message).includes('23503')) {
        msg = 'Cannot update exercise because other records reference it.';
      } else if (err?.code === '23514' || String(err?.message).includes('23514')) {
        msg = 'Exercise name cannot be blank or whitespace-only.';
      }
      setError(msg);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const isWhitespaceOnly = name.length > 0 && !name.trim();
  const isSubmitDisabled = !name.trim() || isSubmitting || !isOnline;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Exercise"
      titleId="edit-exercise-modal-title"
      testId="edit-exercise-modal"
      dismissible={!isSubmitting}
    >
      {duplicateError ? (
        <div
          role="alert"
          data-testid="edit-exercise-duplicate-msg"
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
                onClose();
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
          testId="edit-exercise-error"
          icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        />
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Exercise Name Input */}
        <div className="space-y-1.5">
          <label
            htmlFor={exerciseNameId}
            className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5"
          >
            Exercise Name
          </label>
          <input
            id={exerciseNameId}
            type="text"
            data-testid="edit-exercise-name-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
              setDuplicateError(null);
            }}
            placeholder="e.g. Incline Bench Press"
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 input-text-sm font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
          />
          {isWhitespaceOnly && (
            <p
              className="text-xs text-rose-400 mt-1"
              role="alert"
              data-testid="edit-exercise-name-whitespace-error"
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
            {Array.from(new Set([...MUSCLE_GROUPS, ...selectedBodyParts])).map((part) => (
              <Chip
                key={part}
                label={part}
                selected={selectedBodyParts.includes(part)}
                onClick={() => toggleBodyPart(part)}
                size="sm"
                testId={`muscle-chip-${part.toLowerCase().replace(/\s+/g, '-')}`}
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
              data-testid="cancel-exercise-btn"
              onClick={onClose}
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
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
};

export const EditExerciseModal = EditExerciseSheet;
export default EditExerciseSheet;
