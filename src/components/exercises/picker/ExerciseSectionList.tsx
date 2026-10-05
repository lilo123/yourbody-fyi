import React from 'react';
import { Dumbbell } from 'lucide-react';
import { Button } from '../../common/Button';
import { ExerciseRow } from './ExerciseRow';
import type { CatalogExercise } from '../../../lib/exercises';

export interface ExerciseSectionListProps {
  isBrowsingMode: boolean;
  searchQuery: string;
  recentList: CatalogExercise[];
  frequentList: CatalogExercise[];
  filteredCatalog: CatalogExercise[];
  selectedExercises: Map<string, CatalogExercise>;
  isExerciseInWorkout: (name: string) => boolean;
  onToggleSelect: (exercise: CatalogExercise) => void;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export const ExerciseSectionList: React.FC<ExerciseSectionListProps> = ({
  isBrowsingMode,
  searchQuery,
  recentList,
  frequentList,
  filteredCatalog,
  selectedExercises,
  isExerciseInWorkout,
  onToggleSelect,
  sentinelRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}) => {
  return (
    <div className="space-y-6 pt-1">
      {/* Browsing mode: Recent section */}
      {isBrowsingMode && recentList.length > 0 && (
        <section aria-labelledby="heading-recent-exercises" className="space-y-2">
          <h3
            id="heading-recent-exercises"
            className="text-xs font-bold uppercase tracking-wider text-zinc-400"
          >
            Recent
          </h3>
          <div className="space-y-2">
            {recentList.map((ex) => (
              <ExerciseRow
                key={`recent-${ex.id}`}
                exercise={ex}
                isSelected={selectedExercises.has(ex.id)}
                isInWorkout={isExerciseInWorkout(ex.name)}
                onToggle={onToggleSelect}
              />
            ))}
          </div>
        </section>
      )}

      {/* Browsing mode: Frequent section */}
      {isBrowsingMode && frequentList.length > 0 && (
        <section aria-labelledby="heading-frequent-exercises" className="space-y-2">
          <h3
            id="heading-frequent-exercises"
            className="text-xs font-bold uppercase tracking-wider text-zinc-400"
          >
            Frequent
          </h3>
          <div className="space-y-2">
            {frequentList.map((ex) => (
              <ExerciseRow
                key={`frequent-${ex.id}`}
                exercise={ex}
                isSelected={selectedExercises.has(ex.id)}
                isInWorkout={isExerciseInWorkout(ex.name)}
                onToggle={onToggleSelect}
              />
            ))}
          </div>
        </section>
      )}

      {/* All / Filtered exercises section */}
      <section aria-labelledby="heading-all-exercises" className="space-y-2">
        <h3
          id="heading-all-exercises"
          className="text-xs font-bold uppercase tracking-wider text-zinc-400"
        >
          {isBrowsingMode ? 'All Exercises' : `Exercises (${filteredCatalog.length})`}
        </h3>

        {filteredCatalog.length === 0 && !searchQuery.trim() ? (
          <div className="text-center py-8 text-zinc-400 space-y-2">
            <Dumbbell className="w-8 h-8 mx-auto text-zinc-600" />
            <p className="text-sm">No exercises found.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCatalog.map((ex) => (
              <ExerciseRow
                key={ex.id}
                exercise={ex}
                isSelected={selectedExercises.has(ex.id)}
                isInWorkout={isExerciseInWorkout(ex.name)}
                onToggle={onToggleSelect}
              />
            ))}
          </div>
        )}
      </section>

      {/* Infinite Scroll Sentinel and Load More */}
      <div ref={sentinelRef} className="py-2 text-center">
        {isFetchingNextPage ? (
          <p className="text-xs text-zinc-400 animate-pulse">
            Loading more exercises...
          </p>
        ) : hasNextPage ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={fetchNextPage}
            testId="picker-load-more-btn"
            className="w-full"
          >
            Load More Exercises
          </Button>
        ) : null}
      </div>
    </div>
  );
};
