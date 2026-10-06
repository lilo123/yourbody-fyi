import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { WorkoutSet, NutritionLog, Exercise } from '../../types/database';
import { AlertCircle, Shield, RotateCcw } from 'lucide-react';
import { EditMealSheet } from '../nutrition/EditMealSheet';
import { EditSetSheet } from '../sets/EditSetSheet';
import { useHistorySetDeferredDelete } from './useHistorySetDeferredDelete';
import { useHistoryMealDeferredDelete } from './useHistoryMealDeferredDelete';
import { useHistorySessionFilter } from './useHistorySessionFilter';
import { useHistoryCalendarJump } from './useHistoryCalendarJump';
import { useHistorySessionSets } from './useHistorySessionSets';
import { HistoryCalendarSheet } from './HistoryCalendarSheet';
import { HistoryToolbar } from './HistoryToolbar';
import { HistoryHeader } from './HistoryHeader';
import { CoachContext } from '../../context/CoachContextTypes';
import { NutritionHistoryTimeline, type NutritionDaySummary } from './NutritionHistoryTimeline';
import { WorkoutSessionHistory } from './WorkoutSessionHistory';
import { ExerciseStatsList } from './ExerciseStatsList';
import { useHistoryData } from './useHistoryData';
import {
  useWorkoutHistory,
  useExerciseStats,
  type HistoryRange,
} from './useWorkoutHistory';
import { StatusBanner } from '../common/StatusBanner';
import { groupNutritionDays } from '../../utils/nutritionDayGrouping';
import { DEFAULT_EXERCISES_LIST } from '../../utils/ghostSets';
import { normalizeDateStr } from '../../utils/ghostSets';
import { fetchAllVisibleExercises, EXERCISE_SUMMARY_PROJECTION } from '../../lib/exercises';

export const HistoryView: React.FC = () => {
  const { user, isCoachMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const coachCtx = React.useContext(CoachContext);
  const selectedAthleteId = coachCtx?.selectedAthleteId || '';
  const selectedAthlete = coachCtx?.selectedAthlete || null;
  const queryClient = useQueryClient();

  const [inspectMode, setInspectMode] = useState<'athlete' | 'coach'>('athlete');
  const [historyDomain, setHistoryDomain] = useState<'workouts' | 'nutrition'>('workouts');
  const [viewMode, setViewMode] = useState<'session' | 'exercise'>('session');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionCategory, setSessionCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editingMealLog, setEditingMealLog] = useState<NutritionLog | null>(null);
  const [editingSet, setEditingSet] = useState<(WorkoutSet & { workout_date?: string; workout_name?: string }) | null>(null);
  const [timeRange, setTimeRange] = useState<HistoryRange>('all');

  /* oxlint-disable react/set-state-in-effect */
  React.useEffect(() => {
    if (isCoachMode && selectedAthleteId) {
      setInspectMode('athlete');
    }
    setEditingMealLog(null);
    setEditingSet(null);
  }, [isCoachMode, selectedAthleteId]);

  const isInspectingAthlete = Boolean(isCoachMode && inspectMode === 'athlete' && selectedAthleteId);
  const targetUserId = isInspectingAthlete ? selectedAthleteId : (user?.id || '');

  const effectiveTimeZone = isInspectingAthlete
    ? selectedAthlete?.timezone || undefined
    : undefined;

  // Workout History hook (v2 RPC, keyset pagination, range filtering)
  const {
    sessions,
    totalCount,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
    isSessionsPending,
    isSessionsError,
    sessionsError,
    refetchSessions,
    deleteSession,
    isDeletingSession,
  } = useWorkoutHistory(targetUserId, timeRange, effectiveTimeZone);

  // Per-session set loading and expansion
  const {
    expandedSessionIds,
    loadingSessionIds,
    sessionErrorIds,
    sessionSetsMap,
    setSessionSetsMap,
    loadSetsForSession,
    handleToggleExpand,
  } = useHistorySessionSets({
    targetUserId,
    sessions,
    queryClient,
  });

  // Calendar Jump hook
  const {
    isCalendarOpen,
    setIsCalendarOpen,
    highlightDate,
    jumpStatusMessage,
    setJumpStatusMessage,
    handleSelectDate,
    sessionDates,
  } = useHistoryCalendarJump({
    sessions,
    hasMore,
    isLoadingMore,
    isSessionsPending,
    loadMore,
    setTimeRange,
    targetUserId,
  });

  // Fetch exercises catalog
  const {
    data: exercises = DEFAULT_EXERCISES_LIST,
    refetch: refetchExercises,
  } = useQuery({
    queryKey: ['exercises'],
    queryFn: async () => {
      const data = await fetchAllVisibleExercises<Exercise>(EXERCISE_SUMMARY_PROJECTION);
      if (!data || data.length === 0) return DEFAULT_EXERCISES_LIST;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Deferred set deletion hook
  const {
    handleDeleteSetRequested,
    handleSetSaved,
    displayedSessionsWithSets,
  } = useHistorySetDeferredDelete({
    targetUserId,
    exercises,
    sessions,
    displayedSessions: sessions,
    sessionSetsMap,
    setSessionSetsMap,
    setEditingSet,
    setMutationError,
  });

  // By-Session filtering
  const {
    filtered: filteredSessions,
    isFiltering: isSessionFiltering,
    matchCount: sessionMatchCount,
  } = useHistorySessionFilter(
    displayedSessionsWithSets,
    sessionSetsMap,
    sessionSearchQuery,
    sessionCategory,
    exercises
  );

  const filterSummary = useMemo(() => {
    if (!isSessionFiltering) return undefined;
    return {
      matchCount: sessionMatchCount,
      loadedCount: displayedSessionsWithSets.length,
    };
  }, [isSessionFiltering, sessionMatchCount, displayedSessionsWithSets.length]);

  const handleClearFilters = useCallback(() => {
    setTimeRange('all');
    setSessionSearchQuery('');
    setSessionCategory('All');
  }, []);

  // Nutrition Data hook (window infinite query)
  const {
    nutritionLogs,
    hasMoreNutrition,
    loadMoreNutrition,
    isNutritionPending,
    isLoadingMoreNutrition,
    scaleMealMutation,
    isNutritionLogsError,
    nutritionLogsError,
    refetchNutritionLogs,
  } = useHistoryData(targetUserId, setMutationError, effectiveTimeZone);

  // Nutrition Deferred Delete hook
  const {
    handleDeleteMealRequested,
    pendingDeleteMealId,
  } = useHistoryMealDeferredDelete({
    targetUserId,
    setMutationError,
    isActive: location.pathname === '/history',
    meals: nutritionLogs,
  });

  const handleDeleteSession = useCallback(
    async (workoutId: string) => {
      try {
        setMutationError(null);
        await deleteSession(workoutId);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : (err as { message?: string })?.message || 'Failed to delete workout session';
        setMutationError(msg);
        throw err;
      }
    },
    [deleteSession]
  );

  const isExerciseView = historyDomain === 'workouts' && viewMode === 'exercise';
  const {
    data: rawExerciseStats = [],
    isError: isExerciseStatsError,
    error: exerciseStatsError,
    refetch: refetchExerciseStats,
  } = useExerciseStats(targetUserId, isExerciseView);

  const isReadError =
    historyDomain === 'nutrition'
      ? isNutritionLogsError
      : isExerciseView
      ? (isSessionsError || isExerciseStatsError)
      : isSessionsError;

  const activeError =
    historyDomain === 'nutrition'
      ? nutritionLogsError
      : isExerciseView
      ? (sessionsError || exerciseStatsError)
      : sessionsError;

  const readErrorMessage =
    activeError instanceof Error
      ? activeError.message
      : 'Unable to load history data. Please try again.';

  const handleRetryHistory = () => {
    if (historyDomain === 'nutrition') {
      void refetchNutritionLogs();
    } else {
      void refetchSessions();
      void refetchExercises();
      if (isExerciseView) {
        void refetchExerciseStats();
      }
    }
  };

  const nutritionDays = useMemo<NutritionDaySummary[]>(() => {
    return groupNutritionDays(nutritionLogs, effectiveTimeZone);
  }, [nutritionLogs, effectiveTimeZone]);

  const filteredNutritionDays = useMemo(() => {
    if (timeRange === 'all') return nutritionDays;
    const now = new Date();
    const days = timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 365;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = normalizeDateStr(cutoff, effectiveTimeZone);
    return nutritionDays.filter((d) => d.date >= cutoffStr);
  }, [nutritionDays, timeRange, effectiveTimeZone]);

  return (
    <div className="space-y-5">
      {/* Mutation Error Notification (Dismiss aria label) */}
      <StatusBanner
        message={mutationError}
        tone="error"
        testId="history-mutation-error"
        icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={() => setMutationError(null)}
            aria-label="Dismiss"
            className="p-1 min-w-[44px] min-h-[44px] text-rose-400 hover:text-white flex items-center justify-center cursor-pointer"
          >
            ✕
          </button>
        }
      />

      {/* Calendar Jump StatusBanner */}
      {jumpStatusMessage && (
        <StatusBanner
          message={jumpStatusMessage}
          tone="info"
          testId="calendar-jump-status"
          action={
            <button
              type="button"
              onClick={() => setJumpStatusMessage(null)}
              aria-label="Dismiss"
              className="p-1 min-w-[44px] min-h-[44px] text-cyan-400 hover:text-white flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>
          }
        />
      )}

      {isCoachMode && selectedAthleteId && (
        <div
          data-testid="coach-inspection-banner"
          className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="truncate min-w-0">
              <div className="text-xs uppercase font-bold text-zinc-400">Coach Inspection Mode</div>
              <div className="text-xs font-bold text-white truncate">
                {inspectMode === 'athlete' ? (
                  <>
                    Viewing Athlete: <span className="text-cyan-300 font-bold">{selectedAthlete?.name}</span> (Read-Only)
                  </>
                ) : (
                  <span className="text-zinc-400">Viewing My Personal History</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingMealLog(null);
              setEditingSet(null);
              setInspectMode((prev) => (prev === 'athlete' ? 'coach' : 'athlete'));
            }}
            data-testid="toggle-inspect-mode-btn"
            className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition touch-manipulation flex items-center justify-center shrink-0 cursor-pointer"
          >
            {inspectMode === 'athlete' ? 'Switch to My History' : 'Switch to Athlete'}
          </button>
        </div>
      )}

      {/* Header Banner & Domain Switcher */}
      <HistoryHeader
        historyDomain={historyDomain}
        onHistoryDomainChange={setHistoryDomain}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />

      {/* History Domain Content */}
      <StatusBanner
        title={isReadError ? 'Failed to load history data' : null}
        message={isReadError ? readErrorMessage : null}
        tone="error"
        testId="history-read-error"
        className="mb-4"
        icon={<AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={handleRetryHistory}
            data-testid="retry-history-btn"
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Retry</span>
          </button>
        }
      />

      {!isReadError && (
        historyDomain === 'nutrition' ? (
          <NutritionHistoryTimeline
            filteredNutritionDays={filteredNutritionDays}
            timeRange={timeRange}
            isInspectingAthlete={isInspectingAthlete}
            onEditMeal={setEditingMealLog}
            onDeleteMeal={(id, meal) => handleDeleteMealRequested(meal || id)}
            onScaleMeal={(m, items) => scaleMealMutation.mutateAsync({ log: m, items })}
            isNutritionPending={isNutritionPending}
            onNavigateToNutrition={() => navigate('/nutrition')}
            hasMoreNutrition={hasMoreNutrition}
            isLoadingMoreNutrition={isLoadingMoreNutrition}
            onLoadMoreNutrition={loadMoreNutrition}
            pendingDeleteMealId={pendingDeleteMealId}
          />
        ) : viewMode === 'session' ? (
          <div className="space-y-4">
            <HistoryToolbar
              searchQuery={sessionSearchQuery}
              onSearchQueryChange={setSessionSearchQuery}
              selectedCategory={sessionCategory}
              onSelectedCategoryChange={setSessionCategory}
              onOpenCalendar={() => setIsCalendarOpen(true)}
            />
            <WorkoutSessionHistory
              displayedSessions={filteredSessions}
              filteredSessionsCount={sessions.length}
              totalCount={totalCount}
              exercises={exercises}
              timeRange={timeRange}
              isInspectingAthlete={isInspectingAthlete}
              isSessionsPending={isSessionsPending}
              onEditSet={setEditingSet}
              onLoadMore={loadMore}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              loadMoreError={loadMoreError}
              expandedSessionIds={expandedSessionIds}
              onToggleExpand={handleToggleExpand}
              loadingSessionIds={loadingSessionIds}
              sessionErrorIds={sessionErrorIds}
              onRetrySessionSets={loadSetsForSession}
              onDeleteSession={isInspectingAthlete ? undefined : handleDeleteSession}
              isDeletingSession={isDeletingSession}
              onClearFilters={handleClearFilters}
              highlightDate={highlightDate}
              filterSummary={filterSummary}
            />
          </div>
        ) : (
          <ExerciseStatsList
            exercises={exercises}
            rawExerciseStats={rawExerciseStats}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            selectedCategory={selectedCategory}
            onSelectedCategoryChange={setSelectedCategory}
            isInspectingAthlete={isInspectingAthlete}
            onEditSet={isInspectingAthlete ? () => {} : setEditingSet}
            userId={targetUserId}
            timeZone={effectiveTimeZone}
            isReadOnly={isInspectingAthlete}
          />
        )
      )}

      {/* History Calendar Sheet */}
      <HistoryCalendarSheet
        open={isCalendarOpen}
        onClose={() => setIsCalendarOpen(false)}
        userId={targetUserId}
        timeZone={effectiveTimeZone}
        sessionDates={sessionDates}
        onSelectDate={handleSelectDate}
      />

      {/* Edit Meal Sheet */}
      <EditMealSheet
        isOpen={!!editingMealLog}
        meal={editingMealLog}
        onClose={() => setEditingMealLog(null)}
        targetUserId={targetUserId}
        nutritionLogs={nutritionLogs}
        timeZone={effectiveTimeZone}
      />



      {/* Edit Set Sheet */}
      <EditSetSheet
        isOpen={!!editingSet}
        set={editingSet}
        exercises={exercises}
        onClose={() => setEditingSet(null)}
        onSaved={handleSetSaved}
        onDeleteRequested={handleDeleteSetRequested}
        targetUserId={targetUserId}
      />
    </div>
  );
};

export default HistoryView;
