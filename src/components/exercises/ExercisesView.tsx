import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarPlus, AlertCircle, RotateCcw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { Exercise } from '../../types/database';
import { fetchAllVisibleExercises, EXERCISE_LIBRARY_PROJECTION } from '../../lib/exercises';
import { StatusBanner } from '../common/StatusBanner';
import { SegmentedTabs } from '../common/SegmentedTabs';
import { ExerciseListTab } from './ExerciseListTab';
import { TemplateListTab } from './TemplateListTab';

export const ExercisesView: React.FC = () => {
  const { user } = useAuth();
  const targetUserId = user?.id || '';

  const [activeTab, setActiveTab] = useState<'exercises' | 'templates'>('exercises');
  const [catalogErrorState, setCatalogErrorState] = useState<{
    isError: boolean;
    error: unknown;
    refetch: () => void;
  } | null>(null);

  // Queries
  const {
    data: exercises = [],
    isError: isExercisesError,
    error: exercisesError,
    refetch: refetchExercises,
  } = useQuery({
    queryKey: ['exercises', 'library', user?.id],
    queryFn: async () => {
      return fetchAllVisibleExercises<Exercise>(EXERCISE_LIBRARY_PROJECTION, {
        isArchived: false,
        userId: user?.id,
      });
    },
  });



  const handleCatalogError = useCallback(
    (isError: boolean, error: unknown, refetch: () => void) => {
      setCatalogErrorState(isError ? { isError, error, refetch } : null);
    },
    []
  );

  const isReadError =
    activeTab === 'exercises' && (catalogErrorState?.isError || isExercisesError);

  const readError =
    activeTab === 'exercises'
      ? catalogErrorState?.error || exercisesError
      : null;

  const handleRetryExercises = () => {
    void refetchExercises();
    if (catalogErrorState?.refetch) {
      catalogErrorState.refetch();
    }
  };

  return (
    <div className="space-y-6 pb-[max(env(safe-area-inset-bottom),2rem)] animate-fade-in">
      {/* Sub-tabs with SegmentedTabs primitive */}
      <SegmentedTabs
        tabs={[
          { id: 'exercises', label: 'Exercises', icon: <BookOpen className="w-4 h-4" /> },
          { id: 'templates', label: 'Templates', icon: <CalendarPlus className="w-4 h-4" /> },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel="Library sections"
        className="mb-4"
      />

      {/* Read Error Banner */}
      <StatusBanner
        title={
          isReadError
            ? 'Failed to load exercises'
            : null
        }
        message={
          isReadError
            ? readError instanceof Error
              ? readError.message
              : typeof readError === 'string'
              ? readError
              : (readError as { message?: string })?.message || 'Unable to load exercise data. Please try again.'
            : null
        }
        tone="error"
        testId="exercises-read-error"
        className="mb-4"
        icon={<AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={handleRetryExercises}
            data-testid="retry-exercises-btn"
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Retry</span>
          </button>
        }
      />

      {activeTab === 'exercises' && (
        <ExerciseListTab
          exercises={exercises}
          isReadError={isExercisesError}
          targetUserId={targetUserId}
          currentUserId={user?.id}
          onCatalogError={handleCatalogError}
        />
      )}

      {activeTab === 'templates' && (
        <TemplateListTab
          exercises={exercises}
          targetUserId={targetUserId}
        />
      )}
    </div>
  );
};

export default ExercisesView;
