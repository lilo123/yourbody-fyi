import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { NutritionLog, CustomDish } from '../../types/database';
import { getLocalDateStr, formatLocalTimestamp } from '../../utils/date';
import { EditMealSheet } from './EditMealSheet';
import { roundTo1Decimal, calculateRemainingFuel } from '../../utils/nutrition';
import { itemsForPersist, sumItems, type NutritionItem } from '../../utils/itemModel';
import { MealLogRow } from './MealLogRow';
import { NutrientBreakdownModal, type BreakdownNutrient } from './NutrientBreakdownModal';
import { stagedToItem, recomputeStagedTotals, buildStagedMealFromManualData, useStagedCardFocus, type StagedMeal } from './nutritionEngineHelpers';
import { Skeleton } from '../common/Skeleton';
import { useDeferredDelete } from '../common/useDeferredDelete';
import { useNutritionData } from './useNutritionData';
import { useToast, useToastOffset } from '../../hooks/useToast';
import { useNutritionAi } from './useNutritionAi';
import { useCustomDishModal } from './useCustomDishModal';
import { NutritionDashboardRings } from './NutritionDashboardRings';
import { QuickLogFavorites } from './QuickLogFavorites';
import { NutritionAiInput } from './NutritionAiInput';
import { StagedMealCard } from './StagedMealCard';
import { ManualMealForm } from './ManualMealForm';
import { useManualMealForm, type ManualMealStagedData } from './useManualMealForm';
import { useCustomDishSaving } from './useCustomDishSaving';
import { useCustomDishActions } from './useCustomDishActions';
import { useStagedMealAddAi } from './useStagedMealAddAi';
import { CustomDishesModal } from './CustomDishesModal';
import { Utensils, AlertCircle, RotateCcw } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { PendingReviewList } from './PendingReviewList';
import { useAiQueueReview } from './useAiQueueReview';
import { deleteAfterLog, newId } from '../../offline';

export const NutritionEngine: React.FC = () => {
  const { user, profile } = useAuth();
  const targetUserId = user?.id || '';

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getLocalDateStr(new Date());
  });

  const [stagedMeal, setStagedMeal] = useState<StagedMeal | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [breakdownNutrient, setBreakdownNutrient] = useState<BreakdownNutrient | null>(null);
  const [status, setStatus] = useState<string>('');
  const [isError, setIsError] = useState(false);

  const handleStageManualMeal = (data: ManualMealStagedData) => {
    setStagedMeal(buildStagedMealFromManualData(data, ai.selectedPhoto?.dataUrl));
    setShowManualForm(false);
  };

  // Manual Form Fallback State (stages into StagedMealCard instead of logging directly)
  const manualMealForm = useManualMealForm({
    onStageMeal: handleStageManualMeal,
  });

  const [editingMealLog, setEditingMealLog] = useState<NutritionLog | null>(null);
  const { textareaRef: aiTextareaRef, headingRef: sectionHeadingRef, decideFocusRestore, cardFocusProps } =
    useStagedCardFocus(Boolean(stagedMeal));

  const {
    customDishes, nutritionLogs, todayLogs, dailyTotals, targets, remainingFuel,
    mutation, deleteMutation, saveCustomDishMutation, deleteCustomDishMutation,
    activeToast, triggerToast, isTimerActive,
    isNutritionLogsError, isNutritionLogsPending, nutritionLogsError, refetchNutritionLogs,
    isCustomDishesError, customDishesError, refetchCustomDishes, fetchDishDetail,
  } = useNutritionData({
    targetUserId,
    selectedDate,
    profile,
    onMutationSuccessReset: () => {
      setStagedMeal(null); ai.setSelectedPhoto(null); setShowManualForm(false);
      ai.setIsRateLimited(false); ai.setNlInput(''); manualMealForm.resetManualForm();
    },
    setStatus,
    setIsError,
  });

  const [dishFetchError, setDishFetchError] = useState<{ message: string; retry: () => void } | null>(null);
  const { show: showToast, dismiss: dismissToast } = useToast();
  useToastOffset(isTimerActive ? (stagedMeal ? 190 : 148) : stagedMeal ? 128 : undefined);

  // Deferred delete for NutritionLog (6s window with UndoToast)
  const deferredMealDelete = useDeferredDelete<NutritionLog>({
    durationMs: 6000,
    commit: async (log) => {
      await deleteMutation.mutateAsync(log.id);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Error deleting meal';
      setStatus('Failed to delete meal: ' + msg);
      setIsError(true);
    },
  });

  // Deferred delete for CustomDish (6s window with UndoToast)
  const deferredDishDelete = useDeferredDelete<CustomDish>({
    durationMs: 6000,
    commit: async (dish) => {
      await deleteCustomDishMutation.mutateAsync(dish.id);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Error deleting dish';
      setStatus('Failed to delete dish: ' + msg);
      setIsError(true);
    },
  });

  const handleScheduleMealDelete = useCallback(
    (log: NutritionLog) => {
      deferredDishDelete.flush();
      dismissToast();
      const label = log.food_name || 'Meal';
      deferredMealDelete.schedule(log, label);
      showToast({
        kind: 'undo',
        verb: 'Deleted',
        subject: label,
        detail: 'Meal log removed',
        durationMs: 6000,
        onUndo: deferredMealDelete.undo,
        onCommit: deferredMealDelete.flush,
        undoAriaLabel: `Undo delete ${label}`,
        testId: 'quick-log-toast',
      });
    },
    [deferredDishDelete, dismissToast, deferredMealDelete, showToast]
  );

  const handleScheduleDishDelete = useCallback(
    (dishId: string) => {
      deferredMealDelete.flush();
      dismissToast();
      const found = customDishes.find((d) => d.id === dishId);
      const dish = found || ({ id: dishId, name: 'Custom dish' } as CustomDish);
      const label = dish.name || 'Custom dish';
      deferredDishDelete.schedule(dish, label);
      showToast({
        kind: 'undo',
        verb: 'Deleted',
        subject: label,
        detail: 'Custom dish removed',
        durationMs: 6000,
        onUndo: deferredDishDelete.undo,
        onCommit: deferredDishDelete.flush,
        undoAriaLabel: `Undo delete ${label}`,
        testId: 'quick-log-toast',
      });
    },
    [deferredMealDelete, dismissToast, customDishes, deferredDishDelete, showToast]
  );

  const displayedTodayLogs = useMemo(() => {
    if (!deferredMealDelete.pending) return todayLogs;
    return todayLogs.filter((l) => l.id !== deferredMealDelete.pending?.item.id);
  }, [todayLogs, deferredMealDelete.pending]);

  const displayedCustomDishes = useMemo(() => {
    if (!deferredDishDelete.pending) return customDishes;
    return customDishes.filter((d) => d.id !== deferredDishDelete.pending?.item.id);
  }, [customDishes, deferredDishDelete.pending]);

  const displayedDailyTotals = useMemo(() => {
    if (!deferredMealDelete.pending) return dailyTotals;
    return displayedTodayLogs.reduce((acc, log) => ({
      calories: acc.calories + (Number(log.calories) || 0), protein: acc.protein + (Number(log.protein) || 0),
      carbs: acc.carbs + (Number(log.carbs) || 0), fat: acc.fat + (Number(log.fat) || 0), fiber: acc.fiber + (Number(log.fiber) || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  }, [dailyTotals, displayedTodayLogs, deferredMealDelete.pending]);

  const displayedRemainingFuel = useMemo(() => {
    if (!deferredMealDelete.pending) return remainingFuel;
    return calculateRemainingFuel(displayedDailyTotals, targets);
  }, [remainingFuel, displayedDailyTotals, targets, deferredMealDelete.pending]);

  // Own query status (not a prefix lookup in the cache, which matched other nutrition_logs keys and was not reactive).
  const isLogsPending = !isNutritionLogsError && (isNutritionLogsPending || !targetUserId);

  const ai = useNutritionAi({
    customDishes,
    targetUserId,
    timeZone: profile?.timezone ?? undefined,
    onParsedSuccess: (meal) => {
      setStagedMeal(meal);
      setShowManualForm(false);
      showToast({ message: 'Analyzed', verb: 'Analyzed', subject: meal.name, kind: 'info', testId: 'status-message' });
    },
    onFallbackToManual: (dishName) => {
      setShowManualForm(true);
      if (!manualMealForm.manualDishName.trim()) {
        manualMealForm.setManualDishName(dishName);
      }
      setStagedMeal(null);
    },
    setStatus,
    setIsError,
  });

  const { aiQueueItems, aiQueueCounts, handleReviewAiItem } = useAiQueueReview({
    targetUserId,
    stagedMeal,
    setStagedMeal,
    showManualForm,
    manualMealForm,
  });

  const dishModal = useCustomDishModal({
    onSaveDish: (args) => saveCustomDishMutation.mutate(args),
    onDeleteDish: handleScheduleDishDelete,
    onDismissToast: dismissToast,
    fetchDishDetail,
    onFetchError: (err, retry) => {
      setDishFetchError({ message: err?.message || 'Failed to load dish details', retry });
    },
  });

  const applyStagedItemChange = (itemId: string, next: NutritionItem) => {
    if (!stagedMeal) return;
    const updatedItems = stagedMeal.items.map((it) =>
      it.id === itemId
        ? {
            ...it, name: next.name, unit: next.unit,
            quantity: roundTo1Decimal(next.quantity), calories: roundTo1Decimal(next.calories),
            protein: roundTo1Decimal(next.protein), carbs: roundTo1Decimal(next.carbs),
            fat: roundTo1Decimal(next.fat), fiber: roundTo1Decimal(next.fiber),
            portionMultiplier: it.baseQuantity > 0 ? next.quantity / it.baseQuantity : 1,
          }
        : it
    );
    setStagedMeal({ ...stagedMeal, items: updatedItems, ...recomputeStagedTotals(updatedItems) });
  };

  const handleDeleteItem = (itemId: string) => {
    if (!stagedMeal) return;
    const updatedItems = stagedMeal.items.filter((it) => it.id !== itemId);
    if (updatedItems.length === 0) {
      decideFocusRestore();
      setStagedMeal(null);
      return;
    }
    setStagedMeal({ ...stagedMeal, items: updatedItems, ...recomputeStagedTotals(updatedItems) });
  };

  const handleLogStagedMeal = (e?: React.MouseEvent | React.UIEvent) => {
    if (!stagedMeal) return;
    dismissToast();
    decideFocusRestore(e);
    const items = stagedMeal.items.map(stagedToItem);
    const totals = sumItems(items);
    const isSingle = items.length <= 1;
    const item0 = items[0];
    const logDate = stagedMeal.captureDate || selectedDate;
    const logTimestamp = stagedMeal.capturedAt || formatLocalTimestamp(selectedDate, undefined, profile?.timezone ?? undefined);
    const aiqItemId = stagedMeal.aiqItemId;

    const payload = {
      id: newId(),
      food_name: stagedMeal.name,
      calories: isSingle && item0 ? roundTo1Decimal(item0.calories) : roundTo1Decimal(totals.calories),
      protein: isSingle && item0 ? roundTo1Decimal(item0.protein) : roundTo1Decimal(totals.protein),
      carbs: isSingle && item0 ? roundTo1Decimal(item0.carbs) : roundTo1Decimal(totals.carbs),
      fat: isSingle && item0 ? roundTo1Decimal(item0.fat) : roundTo1Decimal(totals.fat),
      fiber: isSingle && item0 ? roundTo1Decimal(item0.fiber) : roundTo1Decimal(totals.fiber),
      meal_type: stagedMeal.mealType,
      serving_size: Number(stagedMeal.servingSize) || 1,
      serving_unit: stagedMeal.servingUnit || 'serving',
      logged_at: logTimestamp,
      logged_date: logDate,
      items: items.length > 1 ? itemsForPersist(items) : null,
      notes: stagedMeal.notes ?? null,
    };
    mutation.mutate(payload, {
      onSuccess: async () => {
        if (aiqItemId && targetUserId) {
          try {
            await deleteAfterLog(targetUserId, aiqItemId);
          } catch (deleteErr) {
            console.warn('[NutritionEngine] Failed to delete aiq item after log:', deleteErr);
          }
        }
      },
    });
  };

  const { handleSaveStagedAsCustomDish, handleSaveItemAsCustomDish } = useCustomDishSaving({
    targetUserId,
    stagedMeal,
    setStatus,
    setIsError,
  });

  const { handleStageCustomDish, handleQuickLogCustomDishDirect, handleAddCustomDishToStaged } =
    useCustomDishActions({
      targetUserId,
      selectedDate,
      timeZone: profile?.timezone ?? undefined,
      stagedMeal,
      setStagedMeal,
      setDishFetchError,
      fetchDishDetail,
      mutation,
      triggerToast,
    });

  const { handleAddParsedItems } = useStagedMealAddAi({
    stagedMeal,
    setStagedMeal,
    triggerToast,
  });

  useEffect(() => {
    if (
      activeToast?.variant === 'added' &&
      (!stagedMeal ||
        (stagedMeal !== activeToast.forMeal && stagedMeal !== activeToast.preMeal))
    ) {
      dismissToast();
    }
  }, [stagedMeal, activeToast, dismissToast]);

  // Saved-dish failures surface here, beside Quick Log Favorites, rather than in the nutrition
  // logs banner. They are independent queries; folding them together reported a custom_dishes
  // failure as "Failed to load nutrition logs" and hid meals that had loaded perfectly well.
  const savedDishesErrorMessage = isCustomDishesError
    ? `Failed to load saved dishes: ${
        customDishesError instanceof Error
          ? customDishesError.message
          : (customDishesError as any)?.message || 'Please try again.'
      }`
    : null;

  return (
    <div className={`space-y-6 ${stagedMeal ? 'pb-32' : ''}`}>
      <NutritionDashboardRings
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        dailyTotals={displayedDailyTotals}
        targets={targets}
        remainingFuel={displayedRemainingFuel}
        onSelectBreakdownNutrient={setBreakdownNutrient}
      />

      <QuickLogFavorites
        customDishes={displayedCustomDishes}
        onOpenNewDishModal={dishModal.handleOpenNewDishModal}
        onStageCustomDish={(d) => { setStatus(''); setIsError(false); handleStageCustomDish(d); }}
        onOpenEditDishModal={dishModal.handleOpenEditDishModal}
        onQuickLogCustomDishDirect={handleQuickLogCustomDishDirect}
        onDismissToast={dismissToast}
        isStaged={Boolean(stagedMeal)}
        onAddCustomDishToStaged={handleAddCustomDishToStaged}
      />

      <StatusBanner
        message={dishFetchError?.message || dishModal.dishFetchError?.message || savedDishesErrorMessage}
        tone="error"
        testId="dish-fetch-error"
        className="shadow-lg"
        action={
          (dishFetchError || dishModal.dishFetchError || isCustomDishesError) && (
            <button
              type="button"
              data-testid="dish-fetch-retry"
              onClick={() => {
                if (dishFetchError) {
                  dishFetchError.retry();
                } else if (dishModal.dishFetchError) {
                  dishModal.dishFetchError.retry();
                } else {
                  void refetchCustomDishes();
                }
              }}
              className="shrink-0 rounded border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-xs font-bold text-rose-200 hover:bg-rose-500/30 touch-manipulation"
            >
              Retry
            </button>
          )
        }
      />

      {stagedMeal && isError && status ? (
        <StatusBanner
          message={status} tone="error" testId="status-message" className="shadow-lg"
          icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        />
      ) : null}

      {stagedMeal ? (
        <div {...cardFocusProps}>
          <StagedMealCard
            stagedMeal={stagedMeal}
            dailyTotals={displayedDailyTotals}
            targets={targets}
            onUpdateStagedMeal={setStagedMeal}
            onApplyStagedItemChange={applyStagedItemChange}
            onDeleteItem={handleDeleteItem}
            onSaveItemAsCustomDish={handleSaveItemAsCustomDish}
            onLogStagedMeal={handleLogStagedMeal}
            onSaveStagedAsCustomDish={handleSaveStagedAsCustomDish}
            onDiscardStagedMeal={(e) => {
              decideFocusRestore(e);
              setStagedMeal(null);
            }}
            isPending={mutation.isPending}
            customDishes={displayedCustomDishes}
            onAddParsedItems={handleAddParsedItems}
            onAnalyzeWithAiInstead={() => ai.handleForceAiAnalyze(stagedMeal.rawText || stagedMeal.name)}
          />
        </div>
      ) : (
        <NutritionAiInput
          textareaRef={aiTextareaRef}
          headingRef={sectionHeadingRef}
          nlInput={ai.nlInput}
          onNlInputChange={ai.setNlInput}
          selectedPhoto={ai.selectedPhoto}
          onRemovePhoto={ai.handleRemovePhoto}
          onFileChange={ai.handleFileChange}
          onPickPhoto={ai.handlePickPhoto}
          isAnalyzing={ai.isAnalyzing}
          onAnalyze={ai.handleAnalyze}
          showManualForm={showManualForm}
          onToggleManualForm={() => setShowManualForm((prev) => !prev)}
          isRateLimited={ai.isRateLimited}
          onSwitchToManual={() => {
            setShowManualForm(true);
            ai.setIsRateLimited(false);
            if (!manualMealForm.manualDishName.trim()) {
              manualMealForm.setManualDishName(ai.nlInput.trim() || (ai.selectedPhoto ? 'Meal Photo' : ''));
            }
          }}
          status={status}
          isError={isError}
          fileInputRef={ai.fileInputRef}
          hasCustomDishes={displayedCustomDishes.length > 0}
        />
      )}

      <ManualMealForm
        show={showManualForm}
        onClose={() => setShowManualForm(false)}
        selectedPhoto={ai.selectedPhoto}
        onRemovePhoto={ai.handleRemovePhoto}
        manualName={manualMealForm.manualDishName}
        onManualNameChange={manualMealForm.setManualDishName}
        manualMealType={manualMealForm.manualMealType}
        onManualMealTypeChange={manualMealForm.setManualMealType}
        manualCalories={manualMealForm.manualCalories}
        onManualCaloriesChange={manualMealForm.setManualCalories}
        manualProtein={manualMealForm.manualProtein}
        onManualProteinChange={manualMealForm.setManualProtein}
        manualCarbs={manualMealForm.manualCarbs}
        onManualCarbsChange={manualMealForm.setManualCarbs}
        manualFat={manualMealForm.manualFat}
        onManualFatChange={manualMealForm.setManualFat}
        manualFiber={manualMealForm.manualFiber}
        onManualFiberChange={manualMealForm.setManualFiber}
        manualServingSize={manualMealForm.manualServingSize}
        onManualServingSizeChange={manualMealForm.setManualServingSize}
        manualServingUnit={manualMealForm.manualServingUnit}
        onManualServingUnitChange={manualMealForm.setManualServingUnit}
        onSubmit={manualMealForm.handleManualSubmit}
        isPending={mutation.isPending}
      />

      {/* AI Queue Pending Review */}
      <PendingReviewList
        userId={targetUserId}
        items={aiQueueItems}
        counts={aiQueueCounts}
        onReviewItem={handleReviewAiItem}
        onEnterManually={(item) => {
          setShowManualForm(true);
          manualMealForm.setManualDishName(item.text || 'Meal Photo');
        }}
      />

      {/* Logged Meals Timeline */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Utensils className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Today's Meals ({displayedTodayLogs.length})
            </h3>
          </div>
        </div>

        <StatusBanner
          message={
            isNutritionLogsError
              ? `Failed to load nutrition logs: ${
                  nutritionLogsError instanceof Error
                    ? nutritionLogsError.message
                    : typeof nutritionLogsError === 'string'
                    ? nutritionLogsError
                    : (nutritionLogsError as any)?.message ||
                      'Unable to load nutrition data. Please try again.'
                }`
              : null
          }
          tone="error"
          testId="nutrition-read-error"
          className="rounded-2xl p-4 flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg"
          icon={<AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />}
          action={
            isNutritionLogsError && (
              <button
                type="button"
                onClick={() => {
                  void refetchNutritionLogs();
                }}
                data-testid="retry-nutrition-btn"
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation min-h-[44px] min-w-[44px] shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Retry</span>
              </button>
            )
          }
        />

        {isNutritionLogsError ? null : isLogsPending ? (
          <Skeleton
            variant="row"
            count={3}
            ariaLabel="Loading meal logs..."
            testId="nutrition-logs-skeleton"
          />
        ) : displayedTodayLogs.length === 0 ? (
          <div className="p-6 text-center text-zinc-400 text-xs">
            No meals logged for this date yet.
          </div>
        ) : (
          <div className="space-y-2">
            {displayedTodayLogs.map((log) => (
              <MealLogRow
                key={log.id}
                log={log}
                onEdit={setEditingMealLog}
                onDelete={handleScheduleMealDelete}
              />
            ))}
          </div>
        )}
      </div>

      <CustomDishesModal
        isOpen={dishModal.showDishModal} onClose={dishModal.handleCloseDishModal}
        editingDish={dishModal.editingDish} customDishes={displayedCustomDishes}
        dishModalKind={dishModal.dishModalKind} setDishModalKind={dishModal.setDishModalKind}
        dishModalName={dishModal.dishModalName} setDishModalName={dishModal.setDishModalName}
        dishModalCalories={dishModal.dishModalCalories} setDishModalCalories={dishModal.setDishModalCalories}
        dishModalProtein={dishModal.dishModalProtein} setDishModalProtein={dishModal.setDishModalProtein}
        dishModalCarbs={dishModal.dishModalCarbs} setDishModalCarbs={dishModal.setDishModalCarbs}
        dishModalFat={dishModal.dishModalFat} setDishModalFat={dishModal.setDishModalFat}
        dishModalFiber={dishModal.dishModalFiber} setDishModalFiber={dishModal.setDishModalFiber}
        dishModalNotes={dishModal.dishModalNotes} setDishModalNotes={dishModal.setDishModalNotes}
        dishModalItems={dishModal.dishModalItems} setDishModalItems={dishModal.setDishModalItems}
        onSaveDish={dishModal.handleSaveCustomDishModal} onDeleteDish={dishModal.handleDeleteCustomDish}
        isSaving={saveCustomDishMutation.isPending} isDeleting={deleteCustomDishMutation.isPending}
        onOpenEditDishModal={dishModal.handleOpenEditDishModal}
      />

      {/* Edit Meal Sheet */}
      <EditMealSheet
        isOpen={!!editingMealLog}
        meal={editingMealLog}
        onClose={() => setEditingMealLog(null)}
        targetUserId={targetUserId}
        nutritionLogs={nutritionLogs}
        targets={targets}
        timeZone={profile?.timezone}
        triggerToast={triggerToast}
        setStatus={setStatus}
        setIsError={setIsError}
        customDishes={displayedCustomDishes}
      />

      {/* Nutrient Breakdown Modal */}
      <NutrientBreakdownModal
        isOpen={breakdownNutrient !== null}
        onClose={() => setBreakdownNutrient(null)}
        selectedNutrient={breakdownNutrient ?? 'calories'}
        onSelectNutrient={setBreakdownNutrient}
        logs={displayedTodayLogs}
        dailyTotals={displayedDailyTotals}
        targets={targets}
      />
    </div>
  );
};

export default NutritionEngine;
