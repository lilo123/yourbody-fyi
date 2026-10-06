import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import type { RoutineTemplate } from '../../types/database';
import {
  computeGhostSets,
  getExerciseBenchmarks,
  getDayOfWeekAbbr,
  getLocalDateStr,
} from '../../utils/ghostSets';
import { workoutSessionStore } from '../../utils/workoutSessionStore';
import { Layers, Plus, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { useWorkoutQueries } from './useWorkoutQueries';
import { useWorkoutSession } from './useWorkoutSession';
import { useWorkoutMutations } from './useWorkoutMutations';
import { WorkoutHeader } from './WorkoutHeader';
import { RoutinePickerModal } from './RoutinePickerModal';
import { RestDayView } from './RestDayView';
import { ExerciseCard } from './ExerciseCard';
import { StatusBanner } from '../common/StatusBanner';
import { Skeleton } from '../common/Skeleton';
import { useSetDeletion } from './useSetDeletion';
import { useExerciseRemoval } from './useExerciseRemoval';
import { useWorkoutUrlParams } from './useWorkoutUrlParams';
import { useWorkoutEditSheet } from './useWorkoutEditSheet';
import { useWorkoutSetCommit } from './useWorkoutSetCommit';
import { useWorkoutFinishReview } from './useWorkoutFinishReview';
import { WorkoutEmptyState } from './WorkoutEmptyState';
import { WorkoutDialogs } from './WorkoutDialogs';
import type { CatalogExercise } from '../../lib/exercises';

export const WorkoutEngine: React.FC = () => {
  const { user, profile } = useAuth();
  const unit = useWeightUnit();

  const targetUserId = user?.id || (() => {
    try { return JSON.parse(localStorage.getItem('yourbody_user') || '{}')?.id || ''; } catch { return ''; }
  })();
  const autoRestTimer = profile?.auto_rest_timer ?? (localStorage.getItem('yourbody_auto_rest_timer') !== 'false');

  const [showRoutineModal, setShowRoutineModal] = useState(false);
  const [isExercisePickerOpen, setIsExercisePickerOpen] = useState(false);

  // Dialog States
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isReloadConfirmOpen, setIsReloadConfirmOpen] = useState(false);

  // 1. Workout Session State & Stores
  const activeSession = workoutSessionStore.getActiveSession(targetUserId);
  const initialDate = activeSession?.workoutDate || getLocalDateStr(new Date());

  // 2. Data Queries
  const {
    exercises,
    exercisesFetched,
    customTemplates,
    templatesFetched,
    userLogs,
    logsFetched,
    availableRoutines,
    isLogsError,
    logsError,
    refetchLogs,
  } = useWorkoutQueries(targetUserId, initialDate);

  // 3. Session Management (Routines, Exercises, Targets, Drafts)
  const {
    workoutDate,
    setWorkoutDate,
    activeRoutineName,
    activeExercises,
    targetSetCounts,
    targetRepCounts,
    expandedExercises,
    inputDrafts,
    setInputDrafts,
    getSetsForExerciseToday,
    toggleAccordion,
    collapseExercise,
    collapseCompleted,
    toggleAllAccordions,
    handleSelectRoutine: selectRoutineInternal,
    handleReloadScheduledRoutine: reloadScheduledRoutineInternal,
    addExercises: addExercisesInternal,
    moveExercise,
    removeExercise: removeExerciseDirectly,
    restoreExercise,
    adjustTargetSets,
    updateDraft,
    handleClearWorkout: executeClearWorkout,
    isScheduledRoutineDirty,
  } = useWorkoutSession({
    targetUserId,
    exercises,
    exercisesFetched,
    customTemplates,
    templatesFetched,
    userLogs,
    logsFetched,
  });

  const handleSelectRoutine = useCallback((routineName: string, template?: RoutineTemplate) => {
    setShowRoutineModal(false);
    selectRoutineInternal(routineName, template);
  }, [selectRoutineInternal]);

  // URL Query Parameters Handling (URL-1, URL-2)
  const { syncDateToUrl } = useWorkoutUrlParams({
    customTemplates,
    templatesFetched,
    onSelectRoutine: handleSelectRoutine,
    workoutDate,
    onDateChange: setWorkoutDate,
    targetUserId,
  });

  const handleDateChange = useCallback((newDate: string) => {
    setWorkoutDate(newDate);
    syncDateToUrl(newDate);
  }, [setWorkoutDate, syncDateToUrl]);

  const handleDraftSuccess = useCallback(
    (variables: { exerciseName?: string; exerciseId?: string; setIndex: number }) => {
      setInputDrafts((prev) => {
        const next = { ...prev };
        if (variables.exerciseName) {
          delete next[`${variables.exerciseName}_${variables.setIndex}`];
        }
        if (variables.exerciseId) {
          delete next[`${variables.exerciseId}_${variables.setIndex}`];
        }
        return next;
      });
    },
    [setInputDrafts]
  );

  // 4. Set Mutations
  const {
    logSetMutation, batchLogSetsMutation, deleteSetMutation,
    mutationError, clearMutationError, exerciseErrors, clearExerciseError,
    setMutationError, setExerciseError,
  } = useWorkoutMutations({
    targetUserId, workoutDate, activeRoutineName, exercises,
    customTemplates, autoRestTimer, onDraftSuccess: handleDraftSuccess,
  });

  // 5. Deferred Set Deletion with Undo Toast
  const {
    pendingSetId,
    scheduleDelete,
    toast: deleteToast,
  } = useSetDeletion({
    onCommitDelete: async (setId: string) => {
      await deleteSetMutation.mutateAsync(setId);
    },
    timeoutMs: 6000,
  });

  // 6. Exercise Removal with Undo Toast & RemoveExerciseSheet
  const {
    sheetState: removeSheetState,
    requestRemoveExercise,
    handleConfirmRemoveAndDelete,
    handleKeepSetsAndCollapse,
    handleCloseSheet: handleCloseRemoveSheet,
    toast: exerciseRemovalToast,
    pendingDeletedSetIds,
  } = useExerciseRemoval({
    onCommitDeleteSets: async (setIds: string[]) => {
      for (const id of setIds) {
        await deleteSetMutation.mutateAsync(id);
      }
    },
    onRestoreExercise: restoreExercise,
    onRemoveExerciseLocally: removeExerciseDirectly,
    onCollapseExercise: collapseExercise,
    getSetsForExercise: (exName) =>
      getSetsForExerciseToday(exName).filter((s) => s.id !== pendingSetId),
    activeExercises,
    targetSetCounts,
    targetRepCounts,
    inputDrafts,
    timeoutMs: 6000,
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to delete exercise sets';
      setMutationError(msg);
    },
  });

  // 7. Edit Set Sheet
  const {
    editingSet,
    isEditSheetOpen,
    handleEditSet,
    handleCloseEditSheet,
    handleSavedEditSet,
    handleDeleteRequested,
  } = useWorkoutEditSheet({
    activeExercises,
    activeRoutineName,
    workoutDate,
    targetUserId,
    getSetsForExerciseToday,
    pendingSetId,
    pendingDeletedSetIds,
    scheduleDelete,
  });

  const inputDraftsRef = useRef(inputDrafts);
  const targetRepCountsRef = useRef(targetRepCounts);
  useEffect(() => {
    inputDraftsRef.current = inputDrafts;
    targetRepCountsRef.current = targetRepCounts;
  });

  // 8. Set Commit & Batch Log
  const { handleCommitSet, handleBatchLogExercise } = useWorkoutSetCommit({
    exercises, customTemplates, inputDraftsRef, targetRepCountsRef,
    logSetMutation, batchLogSetsMutation, setMutationError, setExerciseError,
  });

  // 9. Finish Workout Review Sheet
  const {
    isFinishReviewOpen,
    setIsFinishReviewOpen,
    pendingReviewSets,
    handleFinishWorkout,
    handleConfirmFinishWithSets,
    handleFinishWithoutSets,
  } = useWorkoutFinishReview({
    activeExercises,
    getSetsForExerciseToday,
    pendingSetId,
    pendingDeletedSetIds,
    targetSetCounts,
    targetRepCountsRef,
    inputDraftsRef,
    userLogs,
    workoutDate,
    exercises,
    batchLogSetsMutation,
  });

  const isWholeWorkoutCompleted =
    activeExercises.length > 0 &&
    activeExercises.every(
      (exName) =>
        getSetsForExerciseToday(exName).filter(
          (s) => s.id !== pendingSetId && (!s.id || !pendingDeletedSetIds.has(s.id))
        ).length >= (targetSetCounts[exName] || 3)
    );

  const handleOpenExercisePicker = useCallback(() => {
    setIsExercisePickerOpen(true);
  }, []);

  const handleLogActivityAnyway = useCallback(() => {
    selectRoutineInternal('Free Workout');
    setIsExercisePickerOpen(true);
  }, [selectRoutineInternal]);

  const handleReloadScheduledRoutine = useCallback(() => {
    setShowRoutineModal(false);
    reloadScheduledRoutineInternal();
  }, [reloadScheduledRoutineInternal]);

  const handleRequestReload = useCallback(() => {
    setShowRoutineModal(false);
    if (isScheduledRoutineDirty) {
      setIsReloadConfirmOpen(true);
    } else {
      handleReloadScheduledRoutine();
    }
  }, [isScheduledRoutineDirty, handleReloadScheduledRoutine]);

  const handleConfirmClearWorkout = useCallback(() => {
    setIsClearConfirmOpen(false);
    executeClearWorkout();
  }, [executeClearWorkout]);

  const handleConfirmReloadRoutine = useCallback(() => {
    setIsReloadConfirmOpen(false);
    handleReloadScheduledRoutine();
  }, [handleReloadScheduledRoutine]);

  const handleAddExercisesFromPicker = useCallback(
    (chosen: CatalogExercise[]) => {
      if (!chosen || chosen.length === 0) return;
      addExercisesInternal(chosen);
      setIsExercisePickerOpen(false);
      const firstAddedName = chosen[0]?.name;
      if (firstAddedName) {
        requestAnimationFrame(() => {
          const card =
            document.querySelector(`[data-card-for-exercise="${firstAddedName}"]`) ||
            document.querySelector(`[data-testid="exercise-card-${firstAddedName}"]`);
          if (card) {
            card?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            const focusable = card.querySelector<HTMLElement>('input, button');
            focusable?.focus();
          }
        });
      }
    },
    [addExercisesInternal]
  );

  const allExpanded =
    activeExercises.length > 0 && activeExercises.every((e) => expandedExercises.has(e));

  const currentDayAbbr = getDayOfWeekAbbr(workoutDate);

  return (
    <div className="space-y-6 pb-44 text-white">
      {/* Header controls & stats */}
      <WorkoutHeader
        mutationError={mutationError}
        onClearMutationError={clearMutationError}
        activeRoutineName={activeRoutineName}
        onOpenRoutineModal={() => setShowRoutineModal(true)}
        workoutDate={workoutDate}
        onDateChange={handleDateChange}
        onClearWorkout={() => setIsClearConfirmOpen(true)}
      />

      {/* Logs Read Error Banner */}
      <StatusBanner
        title={isLogsError ? 'Failed to load workout history' : null}
        message={
          isLogsError
            ? logsError instanceof Error
              ? logsError.message
              : typeof logsError === 'string'
              ? logsError
              : (logsError as unknown as { message?: string })?.message ||
                'Unable to load previous sets and ghost benchmarks. Please try again.'
            : null
        }
        tone="error"
        testId="workout-logs-error"
        icon={<AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          <button
            type="button"
            onClick={() => refetchLogs()}
            data-testid="retry-logs-btn"
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 shrink-0" />
            <span>Retry</span>
          </button>
        }
      />

      <RoutinePickerModal
        isOpen={showRoutineModal}
        onClose={() => setShowRoutineModal(false)}
        onReloadScheduledRoutine={handleRequestReload}
        onSelectRoutine={handleSelectRoutine}
        activeRoutineName={activeRoutineName}
        currentDayAbbr={currentDayAbbr}
        customTemplates={availableRoutines.custom}
        defaultTemplates={availableRoutines.defaults}
        exercises={exercises}
        targetUserId={targetUserId}
      />

      {activeRoutineName === 'Rest Day' ? (
        <RestDayView
          onOpenRoutineModal={() => setShowRoutineModal(true)}
          onLogActivity={handleLogActivityAnyway}
        />
      ) : (
        <>
          {activeExercises.length > 0 && (
            <div className="flex flex-wrap items-center justify-between bg-zinc-900/90 border border-zinc-800/80 rounded-xl px-3 py-2 shadow-sm gap-2">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" /> Exercises ({activeExercises.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={collapseCompleted}
                  className="text-xs font-bold text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 border border-border-interactive px-2.5 py-1 rounded-lg transition flex items-center gap-1.5 min-h-[44px]"
                  title="Collapse completed exercises"
                >
                  <span>Collapse Completed</span>
                </button>
                <button
                  onClick={() => toggleAllAccordions(!allExpanded)}
                  className="text-xs font-bold text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 border border-border-interactive px-2.5 py-1 rounded-lg transition min-h-[44px]"
                >
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              </div>
            </div>
          )}

          {activeExercises.length === 0 ? (
            <WorkoutEmptyState
              onOpenRoutineModal={() => setShowRoutineModal(true)}
              onAddExerciseClick={handleOpenExercisePicker}
            />
          ) : !logsFetched ? (
            <Skeleton
              variant="card"
              count={3}
              testId="workout-loading-skeleton"
              ariaLabel="Loading workout data..."
            />
          ) : (
            <div className="space-y-4">
              {activeExercises.map((exName, exIndex) => {
                const rawSets = getSetsForExerciseToday(exName);
                const exerciseSetsToday = rawSets.filter(
                  (s) => s.id !== pendingSetId && (!s.id || !pendingDeletedSetIds.has(s.id))
                );
                const benchmarks = getExerciseBenchmarks(exName, userLogs, workoutDate, unit, profile?.pr_mode || 'weight');
                const isExpanded = expandedExercises.has(exName);
                const targetCount = targetSetCounts[exName] || 3;
                const ghostValues = computeGhostSets(exName, targetCount, userLogs, workoutDate, unit);

                return (
                  <div key={exName} data-card-for-exercise={exName} className="scroll-mb-44">
                    <ExerciseCard
                    exName={exName}
                    exIndex={exIndex}
                    activeExercisesLength={activeExercises.length}
                    setsToday={exerciseSetsToday}
                    benchmarks={benchmarks}
                    targetCount={targetCount}
                    targetRepCount={targetRepCounts[exName]}
                    ghostValues={ghostValues}
                    isExpanded={isExpanded}
                    inputDrafts={inputDrafts}
                    isMutating={logSetMutation.isPending || batchLogSetsMutation.isPending}
                    isBatchPending={batchLogSetsMutation.isPending}
                    error={exerciseErrors[exName]}
                    onDismissError={clearExerciseError}
                    onToggleAccordion={toggleAccordion}
                    onAdjustTargetSets={adjustTargetSets}
                    onMoveExercise={moveExercise}
                    onRemoveExercise={requestRemoveExercise}
                    onUpdateDraft={updateDraft}
                    onCommitSet={handleCommitSet}
                    onEditSet={handleEditSet}
                    onBatchLogExercise={handleBatchLogExercise}
                  />
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-1 scroll-mb-44">
            <button
              type="button"
              onClick={handleOpenExercisePicker}
              className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs transition flex items-center justify-center gap-2 shadow-xl min-h-[44px] bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800/80 hover:border-cyan-500/50 text-white active:scale-95"
              data-testid="add-exercise-btn"
            >
              <Plus className="w-4 h-4 text-cyan-400" />
              <span>Add Exercise</span>
            </button>
          </div>

          {activeExercises.length > 0 && (
            <div className="pt-2 scroll-mb-44">
              <button
                type="button"
                onClick={handleFinishWorkout}
                disabled={batchLogSetsMutation.isPending || isWholeWorkoutCompleted}
                className={`w-full py-3.5 px-4 rounded-2xl font-bold text-xs transition flex items-center justify-center gap-2 shadow-2xl min-h-[44px] ${
                  isWholeWorkoutCompleted
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
                    : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-neon-cyan active:scale-95'
                }`}
                data-testid="finish-workout-btn"
              >
                {isWholeWorkoutCompleted ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Workout Completed</span>
                  </>
                ) : batchLogSetsMutation.isPending ? (
                  <span>Logging All Sets...</span>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-cyan-300" />
                    <span>Finish Workout & Log Remaining Sets</span>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Workout Dialogs, Sheets & Undo Toasts */}
      <WorkoutDialogs
        isEditSheetOpen={isEditSheetOpen}
        editingSet={editingSet}
        exercises={exercises}
        targetUserId={targetUserId}
        onCloseEditSheet={handleCloseEditSheet}
        onSavedEditSet={handleSavedEditSet}
        onDeleteRequested={handleDeleteRequested}
        removeSheetState={removeSheetState}
        onCloseRemoveSheet={handleCloseRemoveSheet}
        onConfirmRemoveAndDelete={handleConfirmRemoveAndDelete}
        onKeepSetsAndCollapse={handleKeepSetsAndCollapse}
        isDeletingSet={deleteSetMutation.isPending}
        isFinishReviewOpen={isFinishReviewOpen}
        onCloseFinishReview={() => setIsFinishReviewOpen(false)}
        pendingReviewSets={pendingReviewSets}
        onConfirmFinishWithSets={handleConfirmFinishWithSets}
        onFinishWithoutSets={handleFinishWithoutSets}
        isSubmittingFinishReview={batchLogSetsMutation.isPending}
        isClearConfirmOpen={isClearConfirmOpen}
        onCancelClearConfirm={() => setIsClearConfirmOpen(false)}
        onConfirmClearWorkout={handleConfirmClearWorkout}
        isReloadConfirmOpen={isReloadConfirmOpen}
        onCancelReloadConfirm={() => setIsReloadConfirmOpen(false)}
        onConfirmReloadRoutine={handleConfirmReloadRoutine}
        exerciseRemovalToast={exerciseRemovalToast}
        deleteToast={deleteToast}
        isExercisePickerOpen={isExercisePickerOpen}
        onCloseExercisePicker={() => setIsExercisePickerOpen(false)}
        onAddExercisesFromPicker={handleAddExercisesFromPicker}
        activeExerciseNames={activeExercises}
        userLogs={userLogs}
      />
    </div>
  );
};

export default WorkoutEngine;
