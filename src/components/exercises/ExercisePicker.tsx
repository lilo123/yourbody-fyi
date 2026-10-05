import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, X, AlertCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from '../common/Sheet';
import { Button } from '../common/Button';
import { StatusBanner } from '../common/StatusBanner';
import { Skeleton } from '../common/Skeleton';
import {
  useExerciseCatalog,
  flattenCatalogPages,
  insertCustomExercise,
  type CatalogExercise,
} from '../../lib/exercises';
import { matchesExerciseSearch } from '../../utils/normalizeSearch';
import { PickerFilterChips } from './picker/PickerFilterChips';
import { CreateExerciseRow } from './picker/CreateExerciseRow';
import { ExerciseSectionList } from './picker/ExerciseSectionList';
import { useRecentFrequentExercises } from './picker/useRecentFrequentExercises';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export interface ExercisePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (exercises: CatalogExercise[]) => void;
  activeExerciseNames?: string[];
  targetUserId?: string;
  userLogs?: Array<{
    exercise_name?: string;
    exercise_id?: string;
    workout_date?: string;
    created_at?: string;
  }>;
  title?: string;
  testId?: string;
}

export const ExercisePicker: React.FC<ExercisePickerProps> = ({
  isOpen,
  onClose,
  onAdd,
  activeExerciseNames = [],
  targetUserId,
  userLogs,
  title = 'Add Exercises',
  testId = 'exercise-picker-sheet',
}) => {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [selectedExercises, setSelectedExercises] = useState<Map<string, CatalogExercise>>(new Map());
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSearchQuery('');
      setSelectedMuscleGroup(null);
      setSelectedEquipment(null);
      setSelectedExercises(new Map());
      setCreateError(null);
      setIsCreating(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const {
    data: catalogData,
    isLoading: isCatalogLoading,
    isError: isCatalogError,
    error: catalogError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useExerciseCatalog({
    search: searchQuery,
    equipment: selectedEquipment,
    enabled: isOpen,
    limit: 50,
  });

  const allCatalogExercises = useMemo(() => {
    const flattened = flattenCatalogPages(catalogData);
    if (!isOnline && flattened.length === 0) {
      const cached =
        (targetUserId &&
          queryClient.getQueryData<CatalogExercise[]>([
            'exercise_catalog',
            'offline_all',
            targetUserId,
          ])) ||
        queryClient.getQueryData<CatalogExercise[]>(['exercise_catalog', 'offline_all']) ||
        queryClient.getQueryData<CatalogExercise[]>(['exercises', 'workout']) ||
        [];
      return cached;
    }
    return flattened;
  }, [catalogData, isOnline, targetUserId, queryClient]);

  const { recentNames, frequentNames } = useRecentFrequentExercises(targetUserId, userLogs);

  const activeNamesSet = useMemo(() => {
    return new Set(activeExerciseNames.map((n) => n.toLowerCase().trim()));
  }, [activeExerciseNames]);

  const isExerciseInWorkout = useCallback(
    (name: string) => activeNamesSet.has(name.toLowerCase().trim()),
    [activeNamesSet]
  );

  useEffect(() => {
    if (!isOpen || typeof IntersectionObserver === 'undefined') return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [isOpen, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filteredCatalog = useMemo(() => {
    return allCatalogExercises.filter((ex) =>
      matchesExerciseSearch(ex, searchQuery, selectedMuscleGroup, selectedEquipment)
    );
  }, [allCatalogExercises, searchQuery, selectedMuscleGroup, selectedEquipment]);

  const isBrowsingMode = !searchQuery.trim() && !selectedMuscleGroup && !selectedEquipment;

  const exerciseMapByName = useMemo(() => {
    const map = new Map<string, CatalogExercise>();
    for (const ex of allCatalogExercises) {
      const lower = ex.name.toLowerCase().trim();
      if (!map.has(lower)) {
        map.set(lower, ex);
      }
    }
    return map;
  }, [allCatalogExercises]);

  const recentList = useMemo(() => {
    if (!isBrowsingMode) return [];
    return recentNames
      .map((name) => exerciseMapByName.get(name.toLowerCase().trim()))
      .filter((ex): ex is CatalogExercise => Boolean(ex));
  }, [isBrowsingMode, recentNames, exerciseMapByName]);

  const frequentList = useMemo(() => {
    if (!isBrowsingMode) return [];
    return frequentNames
      .map((name) => exerciseMapByName.get(name.toLowerCase().trim()))
      .filter((ex): ex is CatalogExercise => Boolean(ex));
  }, [isBrowsingMode, frequentNames, exerciseMapByName]);

  const handleToggleSelect = useCallback((exercise: CatalogExercise) => {
    setSelectedExercises((prev) => {
      const next = new Map(prev);
      if (next.has(exercise.id)) {
        next.delete(exercise.id);
      } else {
        next.set(exercise.id, exercise);
      }
      return next;
    });
  }, []);

  const handleCreateExercise = async (candidateName: string) => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const created = await insertCustomExercise(
        {
          name: candidateName,
          bodyParts: selectedMuscleGroup && selectedMuscleGroup !== 'all' ? [selectedMuscleGroup] : undefined,
          equipment: selectedEquipment && selectedEquipment !== 'all' ? selectedEquipment : undefined,
          targetUserId,
        },
        queryClient,
        allCatalogExercises
      );

      handleToggleSelect(created);
      setSearchQuery('');
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create custom exercise');
    } finally {
      setIsCreating(false);
    }
  };

  const selectedCount = selectedExercises.size;

  const handleConfirmAdd = () => {
    if (selectedCount === 0) return;
    onAdd(Array.from(selectedExercises.values()));
    onClose();
  };

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      testId={testId}
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-400 font-medium">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Tap exercises to select'}
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleConfirmAdd}
            disabled={selectedCount === 0}
            testId="picker-confirm-add-btn"
            className="min-w-[140px]"
          >
            {selectedCount <= 1 ? 'Add Exercise' : `Add ${selectedCount} Exercises`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Search Input (Autofocus, 16px font per STD-CMP-5) */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
            <Search className="w-4 h-4" aria-hidden="true" />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search exercises, e.g. bench, rdl"
            aria-label="Search exercises"
            data-testid="exercise-search-input"
            className="w-full pl-10 pr-10 py-2.5 bg-zinc-950 border border-border-interactive text-white rounded-xl text-[16px] placeholder-zinc-500 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear exercise search"
              data-testid="clear-search-btn"
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-200 cursor-pointer min-h-[44px] min-w-[44px] justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Chips (Body parts & Equipment) */}
        <PickerFilterChips
          selectedMuscleGroup={selectedMuscleGroup}
          onSelectMuscleGroup={setSelectedMuscleGroup}
          selectedEquipment={selectedEquipment}
          onSelectEquipment={setSelectedEquipment}
        />

        {createError && (
          <StatusBanner
            title="Could not create exercise"
            message={createError}
            tone="error"
            icon={<AlertCircle className="w-4 h-4 text-rose-400" aria-hidden="true" />}
          />
        )}

        {!isOnline && (
          <StatusBanner
            message="Offline — showing saved catalog"
            tone="info"
            testId="offline-catalog-banner"
          />
        )}

        {isCatalogError && isOnline && (
          <StatusBanner
            title="Failed to load catalog"
            message={
              catalogError instanceof Error
                ? catalogError.message
                : 'Unable to reach the exercise catalog.'
            }
            tone="error"
          />
        )}

        {isCatalogLoading && allCatalogExercises.length === 0 ? (
          <div className="space-y-3 pt-2">
            <Skeleton variant="card" count={4} testId="catalog-skeleton" />
          </div>
        ) : (
          <div className="space-y-4">
            {searchQuery.trim().length > 0 && (
              <CreateExerciseRow
                query={searchQuery}
                selectedMuscleGroup={selectedMuscleGroup}
                selectedEquipment={selectedEquipment}
                catalog={allCatalogExercises}
                onCreate={handleCreateExercise}
                isCreating={isCreating}
                isOnline={isOnline}
              />
            )}

            <ExerciseSectionList
              isBrowsingMode={isBrowsingMode}
              searchQuery={searchQuery}
              recentList={recentList}
              frequentList={frequentList}
              filteredCatalog={filteredCatalog}
              selectedExercises={selectedExercises}
              isExerciseInWorkout={isExerciseInWorkout}
              onToggleSelect={handleToggleSelect}
              sentinelRef={sentinelRef}
              hasNextPage={Boolean(hasNextPage)}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
};

export default ExercisePicker;
