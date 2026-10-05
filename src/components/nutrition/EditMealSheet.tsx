import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { Utensils, X } from 'lucide-react';
import type { NutritionLog } from '../../types/database';
import { AccessibleModal } from '../common/AccessibleModal';
import { StatusBanner } from '../common/StatusBanner';
import type { CustomDish } from '../../types/database';
import { mergeOrAppendStagedItems, recomputeStagedTotals, type StagedItem, type StagedMeal } from './nutritionEngineHelpers';
import { StagedMealCard } from './StagedMealCard';
import { useMealEditor } from './useMealEditor';
import { useCustomDishSaving } from './useCustomDishSaving';
import { nutritionDayKey } from '../../utils/nutritionDayKey';
import { normalizeDateStr } from '../../utils/date';

export interface EditMealSheetProps {
  isOpen: boolean;
  meal: (NutritionLog & { items?: unknown }) | null;
  onClose: () => void;
  targetUserId?: string;
  readOnly?: boolean;
  nutritionLogs?: NutritionLog[];
  targets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  timeZone?: string | null;
  triggerToast?: (
    dish: { name: string; calories: number | null },
    options?: {
      variant?: 'logged' | 'added' | 'updated';
      dishName?: string;
      calories?: number;
      onUndo?: () => Promise<void> | void;
    }
  ) => void;
  setStatus?: (s: string) => void;
  setIsError?: (e: boolean) => void;
  customDishes?: CustomDish[];
}

export const EditMealSheet: React.FC<EditMealSheetProps> = ({
  isOpen,
  meal,
  onClose,
  targetUserId,
  readOnly = false,
  nutritionLogs = [],
  targets,
  timeZone,
  triggerToast,
  setStatus,
  setIsError,
  customDishes = [],
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus sheet heading on open (no soft keyboard)
  useEffect(() => {
    if (isOpen) {
      const frameId = requestAnimationFrame(() => {
        headingRef.current?.focus();
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [isOpen]);

  // Coach read-only: no Edit affordance for coaches
  if (readOnly || !isOpen || !meal) {
    return null;
  }

  return (
    <EditMealSheetContent
      meal={meal}
      onClose={onClose}
      headingRef={headingRef}
      targetUserId={targetUserId}
      nutritionLogs={nutritionLogs}
      targets={targets}
      timeZone={timeZone}
      triggerToast={triggerToast}
      setStatus={setStatus}
      setIsError={setIsError}
      customDishes={customDishes}
    />
  );
};

interface EditMealSheetContentProps {
  meal: NutritionLog & { items?: unknown };
  onClose: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  targetUserId?: string;
  nutritionLogs: NutritionLog[];
  targets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  timeZone?: string | null;
  triggerToast?: (
    dish: { name: string; calories: number | null },
    options?: {
      variant?: 'logged' | 'added' | 'updated';
      dishName?: string;
      calories?: number;
      onUndo?: () => Promise<void> | void;
    }
  ) => void;
  setStatus?: (s: string) => void;
  setIsError?: (e: boolean) => void;
  customDishes?: CustomDish[];
}

const EditMealSheetContent: React.FC<EditMealSheetContentProps> = ({
  meal,
  onClose,
  headingRef,
  targetUserId,
  nutritionLogs,
  targets,
  timeZone,
  triggerToast,
  setStatus,
  setIsError,
  customDishes = [],
}) => {
  const {
    draft,
    setDraft,
    draftDate,
    setDraftDate,
    isDirty,
    isSaving,
    errorMessage,
    applyStagedItemChange,
    handleDeleteItem,
    save,
  } = useMealEditor({
    meal,
    isOpen: true,
    onClose,
    targetUserId,
    timeZone,
    triggerToast,
    setStatus,
    setIsError,
  });

  const { handleSaveStagedAsCustomDish, handleSaveItemAsCustomDish } = useCustomDishSaving({
    targetUserId: targetUserId || meal.user_id || '',
    stagedMeal: draft,
    setStatus: setStatus ?? (() => {}),
    setIsError: setIsError ?? (() => {}),
  });

  // That day's Day total: eaten that day excluding this meal + draft
  const dayExcludingThisMeal = useMemo(() => {
    if (!nutritionLogs || !draftDate) {
      return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    }
    const targetDate = normalizeDateStr(draftDate, timeZone || undefined);
    return nutritionLogs
      .filter((l) => l.id !== meal.id && nutritionDayKey(l, timeZone || undefined) === targetDate)
      .reduce(
        (acc, log) => {
          acc.calories += Number(log.calories) || 0;
          acc.protein += Number(log.protein) || 0;
          acc.carbs += Number(log.carbs) || 0;
          acc.fat += Number(log.fat) || 0;
          acc.fiber += Number(log.fiber) || 0;
          return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
      );
  }, [nutritionLogs, draftDate, meal.id, timeZone]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleAddParsedItems = useCallback(
    (items: StagedItem[], mealAtStart?: StagedMeal) => {
      setDraft((currentDraft) => {
        if (!currentDraft) return null;
        if (mealAtStart && currentDraft !== mealAtStart) return currentDraft;
        const merged = mergeOrAppendStagedItems(currentDraft.items, items);
        const tot = recomputeStagedTotals(merged);
        return {
          ...currentDraft,
          items: merged,
          ...tot,
          explanation: currentDraft.explanation,
        };
      });
    },
    [setDraft]
  );

  return (
    <AccessibleModal
      isOpen
      onClose={handleCancel}
      dismissible={!isDirty}
      closeOnBackdropClick={!isDirty}
      titleId="edit-meal-sheet-title"
      overlayTestId="edit-meal-sheet-overlay"
      dialogTestId="edit-meal-sheet"
      className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-3 sm:p-5 w-full max-w-lg h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl space-y-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          id="edit-meal-sheet-title"
          className="text-sm font-bold text-white flex items-center gap-2 outline-none"
        >
          <Utensils className="w-4 h-4 text-cyan-400" />
          <span>Edit Meal</span>
        </h3>
        <button
          type="button"
          onClick={handleCancel}
          className="text-zinc-400 hover:text-white min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg touch-manipulation"
          aria-label="Close edit meal"
          data-testid="close-edit-meal-sheet-btn"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <StatusBanner
        message={errorMessage}
        tone="error"
        testId="edit-meal-error"
      />

      {draft && (
        <StagedMealCard
          mode="edit"
          stagedMeal={draft}
          isDirty={isDirty}
          date={draftDate}
          onDateChange={setDraftDate}
          dailyTotals={dayExcludingThisMeal}
          targets={targets}
          onUpdateStagedMeal={setDraft}
          onApplyStagedItemChange={applyStagedItemChange}
          onDeleteItem={handleDeleteItem}
          onSaveItemAsCustomDish={handleSaveItemAsCustomDish}
          onLogStagedMeal={() => void save()}
          onSaveStagedAsCustomDish={handleSaveStagedAsCustomDish}
          onDiscardStagedMeal={handleCancel}
          onCancel={handleCancel}
          isPending={isSaving}
          navHeight={0}
          customDishes={customDishes}
          onAddParsedItems={handleAddParsedItems}
        />
      )}
    </AccessibleModal>
  );
};
