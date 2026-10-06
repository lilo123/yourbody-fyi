import React, { memo, useRef, useEffect, useState } from 'react';
import { Utensils, Check, Star, X, ChevronDown, Sparkles } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatCalories } from '../../utils/nutrition';
import type { NutritionItem } from '../../utils/itemModel';
import { ComponentRow } from './ComponentRow';
import {
  stagedToItem,
  stagedReference,
  reanchorStagedItem,
  recomputeStagedTotals,
  updateStagedItemNutrition,
  buildStagedItem,
  mergeOrAppendStagedItems,
  scaleStagedMeal,
  getScrollBehavior,
  useNavHeight,
  type StagedItem,
  type StagedMeal,
} from './nutritionEngineHelpers';
import type { CustomDish } from '../../types/database';
import { AddItemForm, type AddItemFormData } from './AddItemForm';
import { AddItemsComposer } from './AddItemsComposer';
import { MealScaleControl } from './MealScaleControl';
import { computeVisibleMacroColumns, getMacroGridTemplateColumns } from './macroColumns';
import { MacroCell } from './MacroCell';
import { DayTotalRow, type MacroTotalsShape } from './TodayAfterRow';

export interface StagedMealCardProps {
  mode?: 'stage' | 'edit';
  isDirty?: boolean;
  date?: string;
  onDateChange?: (date: string) => void;
  onCancel?: () => void;
  navHeight?: number;
  stagedMeal: StagedMeal;
  dailyTotals?: Partial<MacroTotalsShape>;
  targets?: Partial<MacroTotalsShape>;
  onUpdateStagedMeal: (updated: StagedMeal) => void;
  onApplyStagedItemChange: (id: string, next: NutritionItem) => void;
  onDeleteItem: (id: string) => void;
  onSaveItemAsCustomDish: (item: StagedItem) => void;
  onLogStagedMeal: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  onSaveStagedAsCustomDish: () => void;
  onDiscardStagedMeal: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  isPending: boolean;
  customDishes?: CustomDish[];
  onAddParsedItems?: (items: StagedItem[], mealAtStart?: StagedMeal) => void;
  onAnalyzeWithAiInstead?: () => void;
}

export const StagedMealCard: React.FC<StagedMealCardProps> = memo(({
  mode = 'stage',
  isDirty = false,
  date,
  onDateChange,
  onCancel,
  stagedMeal,
  dailyTotals,
  targets,
  onUpdateStagedMeal,
  onApplyStagedItemChange,
  onDeleteItem,
  onSaveItemAsCustomDish,
  onLogStagedMeal,
  onSaveStagedAsCustomDish,
  onDiscardStagedMeal,
  isPending,
  customDishes = [],
  onAddParsedItems,
  onAnalyzeWithAiInstead,
  navHeight: navHeightProp,
}) => {
  const isOnline = useOnlineStatus();
  const cardRef = useRef<HTMLDivElement>(null);
  const measuredNavHeight = useNavHeight();
  const isEditMode = mode === 'edit';
  const effectiveNavHeight = isEditMode ? (navHeightProp ?? 0) : (navHeightProp ?? measuredNavHeight);

  useEffect(() => {
    const behavior = getScrollBehavior();
    if (cardRef.current) {
      if (typeof cardRef.current.scrollIntoView === 'function') {
        cardRef.current.scrollIntoView({ behavior, block: 'start' });
      }
    }

    const triggerEl = typeof document !== 'undefined' ? document.activeElement : null;
    const frameId = requestAnimationFrame(() => {
      if (!cardRef.current) return;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      if (!activeEl || activeEl === document.body || activeEl === document.documentElement) {
        const dishNameInput = cardRef.current.querySelector<HTMLInputElement>('[data-testid="dish-name-input"]');
        dishNameInput?.focus({ preventScroll: true });
        return;
      }

      if (cardRef.current.contains(activeEl)) {
        return;
      }

      // Only autofocus if focus is still on the element that triggered staging
      // and not moved elsewhere (e.g. date picker or outside input)
      const isTrigger =
        triggerEl &&
        activeEl === triggerEl &&
        activeEl.tagName !== 'INPUT' &&
        activeEl.tagName !== 'TEXTAREA';

      if (isTrigger) {
        const dishNameInput = cardRef.current.querySelector<HTMLInputElement>('[data-testid="dish-name-input"]');
        dishNameInput?.focus({ preventScroll: true });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, []);

  const logButtonRef = useRef<HTMLButtonElement>(null);
  const wasPendingRef = useRef(isPending);
  const logButtonHadFocusRef = useRef(false);

  useEffect(() => {
    if (isPending) {
      if (typeof document !== 'undefined' && document.activeElement === logButtonRef.current) {
        logButtonHadFocusRef.current = true;
      }
    } else if (wasPendingRef.current && !isPending) {
      if (logButtonHadFocusRef.current) {
        logButtonHadFocusRef.current = false;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        if (!active || active === document.body || active === document.documentElement) {
          logButtonRef.current?.focus();
        }
      }
    }
    wasPendingRef.current = isPending;
  }, [isPending]);

  const handleLogClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (typeof document !== 'undefined' && document.activeElement === logButtonRef.current) {
      logButtonHadFocusRef.current = true;
    }
    onLogStagedMeal(e);
  };

  const handleDiscardClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onDiscardStagedMeal(e);
  };

  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [newlyAddedItemId, setNewlyAddedItemId] = useState<string | null>(null);
  const wasAddingItemRef = useRef(false);
  const wasComposerOpenRef = useRef(false);
  const addItemBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (newlyAddedItemId && cardRef.current) {
      const row = cardRef.current.querySelector(`[data-item-id="${newlyAddedItemId}"]`);
      const qtyInput = row?.querySelector<HTMLInputElement>('[data-testid="component-quantity-input"]');
      qtyInput?.focus();
      setNewlyAddedItemId(null);
    } else if (
      (wasAddingItemRef.current && !isAddingItem && !isComposerOpen) ||
      (wasComposerOpenRef.current && !isComposerOpen && !isAddingItem)
    ) {
      addItemBtnRef.current?.focus();
    }
    wasAddingItemRef.current = isAddingItem;
    wasComposerOpenRef.current = isComposerOpen;
  }, [newlyAddedItemId, isAddingItem, isComposerOpen]);

  const handleAddParsed = (items: StagedItem[]) => {
    if (onAddParsedItems) {
      onAddParsedItems(items, stagedMeal);
    } else {
      const merged = mergeOrAppendStagedItems(stagedMeal.items, items);
      const totals = recomputeStagedTotals(merged);
      onUpdateStagedMeal({
        ...stagedMeal,
        items: merged,
        ...totals,
      });
    }
    setIsComposerOpen(false);
  };

  const handleAddItem = (data: AddItemFormData) => {
    const newItem = buildStagedItem({
      name: data.name,
      portion: `${data.quantity} ${data.unit}`,
      quantity: data.quantity,
      unit: data.unit,
      calories: data.calories,
      protein: data.protein,
      carbs: data.carbs,
      fat: data.fat,
      fiber: data.fiber,
    });
    const updatedItems = [...stagedMeal.items, newItem];
    const totals = recomputeStagedTotals(updatedItems);
    onUpdateStagedMeal({
      ...stagedMeal,
      items: updatedItems,
      ...totals,
    });
    setIsAddingItem(false);
    setNewlyAddedItemId(newItem.id);
  };

  const isMultiItem = stagedMeal.items && stagedMeal.items.length > 1;
  const macroColumns = computeVisibleMacroColumns(stagedMeal.items);

  return (
    <div
      ref={cardRef}
      data-testid="staged-meal-card"
      className="bg-zinc-900/90 border border-cyan-500/50 rounded-2xl sm:rounded-3xl px-3 pt-0.5 pb-0 sm:pt-4 sm:px-4 sm:pb-0 shadow-[0_0_30px_rgba(6,182,212,0.15)] space-y-1.5 sm:space-y-2 animate-in fade-in motion-reduce:animate-none scroll-mt-16 sm:scroll-mt-20"
    >
      {/* Header row: Dish Name & Meal Type (1 row on mobile & desktop) */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-1">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {stagedMeal.photoUrl ? (
            <div className="w-8 h-8 rounded-lg overflow-hidden border border-cyan-500/40 shrink-0 bg-zinc-950 shadow-md">
              <img
                src={stagedMeal.photoUrl}
                alt="Staged meal preview"
                data-testid="staged-meal-photo-thumbnail"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <Utensils className="w-4 h-4 text-cyan-400" />
            </div>
          )}
          <input
            type="text"
            data-testid="dish-name-input"
            aria-label="Meal name"
            value={stagedMeal.name}
            onChange={(e) => onUpdateStagedMeal({ ...stagedMeal, name: e.target.value })}
            className="flex-1 min-w-0 bg-zinc-950 border border-border-interactive text-white font-bold text-base rounded-xl px-2.5 py-1.5 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none truncate min-h-[40px] h-10"
            placeholder="Meal name..."
          />
        </div>

        <div className="relative w-[134px] shrink-0">
          <select
            aria-label="Meal type"
            {...(isEditMode ? { 'data-testid': 'meal-type-select' } : {})}
            value={stagedMeal.mealType}
            onChange={(e) => onUpdateStagedMeal({ ...stagedMeal, mealType: e.target.value })}
            className="w-full appearance-none bg-zinc-950 border border-border-interactive text-zinc-300 text-base font-semibold rounded-xl pl-2 pr-7 py-2 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none min-h-[40px] h-10 cursor-pointer"
          >
            <option value="Breakfast">Breakfast</option>
            <option value="Lunch">Lunch</option>
            <option value="Dinner">Dinner</option>
            <option value="Snack">Snack</option>
            <option value="Pre-Workout">Pre-Workout</option>
            <option value="Post-Workout">Post-Workout</option>
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Local Parse provenance banner */}
      {stagedMeal.source === 'local' && (
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1.5 pt-0.5">
          <span
            data-testid="parsed-locally-badge"
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30"
          >
            Parsed locally
          </span>
          {isOnline && onAnalyzeWithAiInstead && (
            <button
              type="button"
              data-testid="analyze-with-ai-instead-btn"
              onClick={onAnalyzeWithAiInstead}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 rounded-xl hover:bg-cyan-900/50 transition min-h-[44px] touch-manipulation"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Analyze with AI instead</span>
            </button>
          )}
        </div>
      )}

      {/* Date row in edit mode */}
      {isEditMode && (
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1.5 pt-0.5">
          <label
            htmlFor="edit-meal-date-input"
            className="text-xs font-bold uppercase tracking-wider text-zinc-400"
          >
            Date
          </label>
          <input
            id="edit-meal-date-input"
            type="date"
            data-testid="edit-meal-date-input"
            value={date}
            onChange={(e) => onDateChange?.(e.target.value)}
            className="date-pill bg-zinc-950 border border-border-interactive text-cyan-400 rounded-xl px-2.5 py-1 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none cursor-pointer shrink-0 min-h-[40px] h-10 w-[140px] sm:w-auto"
          />
        </div>
      )}

      {/* Itemized Ingredient Breakdown */}
      <div className="space-y-0.5 pt-0.5">
        <div
          data-testid="breakdown-header"
          className="flex items-center justify-between gap-2 min-w-0 text-xs font-bold uppercase text-zinc-400 tracking-wider"
        >
          {isMultiItem ? (
            <>
              {/* the short label keeps label + Scale + Add on one line below 390px */}
              <span className="max-[389px]:hidden">Itemized Breakdown ({stagedMeal.items.length})</span>
              <span className="hidden max-[389px]:inline">Items ({stagedMeal.items.length})</span>
            </>
          ) : (
            <span className="sr-only">Items</span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <MealScaleControl
              scale={stagedMeal.scale ?? 1}
              onScale={(factor) => onUpdateStagedMeal(scaleStagedMeal(stagedMeal, factor))}
            />
            {!isAddingItem && !isComposerOpen && (
              <button
                ref={addItemBtnRef}
                type="button"
                data-testid="add-item-button"
                aria-label="Add item"
                onClick={() => setIsComposerOpen(true)}
                className="text-cyan-400 hover:text-cyan-300 font-bold text-xs min-h-[40px] h-10 px-2.5 flex items-center justify-center -my-3 rounded-lg transition motion-reduce:transition-none touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                + Add
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-zinc-800/80 pt-3.5">
          {stagedMeal.items.map((item) => (
            <div key={item.id} data-item-id={item.id}>
              <ComponentRow
                item={stagedToItem(item)}
                reference={stagedReference(item)}
                macroColumns={macroColumns}
                onChange={(next) => onApplyStagedItemChange(item.id, next)}
                onReanchor={(next) => {
                  const updatedItems = stagedMeal.items.map((it) =>
                    it.id === item.id ? reanchorStagedItem(it, next) : it
                  );
                  const totals = recomputeStagedTotals(updatedItems);
                  const single = updatedItems.length === 1 ? updatedItems[0] : null;
                  onUpdateStagedMeal({
                    ...stagedMeal,
                    items: updatedItems,
                    ...totals,
                    ...(single
                      ? {
                          explanation: `${formatCalories(totals.calories)} kcal (${stagedMeal.name})`,
                          ...(single.quantity > 0
                            ? {
                                servingSize: single.quantity,
                                servingUnit: single.unit,
                              }
                            : {}),
                        }
                      : {}),
                  });
                }}
                onRemove={() => onDeleteItem(item.id)}
                onSaveToQuickLog={() => onSaveItemAsCustomDish(item)}
                onEditNutrition={(edited) => {
                  const updatedItems = stagedMeal.items.map((it) =>
                    it.id === item.id ? updateStagedItemNutrition(it, edited) : it
                  );
                  const totals = recomputeStagedTotals(updatedItems);
                  onUpdateStagedMeal({
                    ...stagedMeal,
                    items: updatedItems,
                    ...totals,
                  });
                }}
              />
            </div>
          ))}
        </div>

        {isComposerOpen && (
          <AddItemsComposer
            customDishes={customDishes}
            scrollMarginBottom={effectiveNavHeight + 70}
            onParsed={handleAddParsed}
            onEnterManually={() => {
              setIsComposerOpen(false);
              setIsAddingItem(true);
            }}
            onCancel={() => {
              setIsComposerOpen(false);
            }}
          />
        )}

        {isAddingItem && (
          <div className="pt-1">
            <AddItemForm
              onAddItem={handleAddItem}
              onCancel={() => setIsAddingItem(false)}
            />
          </div>
        )}

        {/* Macro Totals: Read-only for multi-item directly under the rows */}
        {isMultiItem && (
          <div
            data-testid="staged-meal-totals"
            className="pt-1 border-t border-zinc-700/80 text-xs tabular-nums leading-tight"
            aria-label="Totals are the sum of items"
            title="Totals are the sum of items · edit an item via ⋯"
          >
            <div
              data-testid="this-meal-label"
              className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-0 leading-none"
            >
              This meal
            </div>
            <div
              data-testid="staged-meal-totals-grid"
              className="grid text-xs tabular-nums leading-tight"
              style={{ gridTemplateColumns: getMacroGridTemplateColumns(macroColumns) }}
            >
              <span className="sr-only">Totals are the sum of items</span>
              {macroColumns.map((colKey) => (
                <MacroCell
                  key={colKey}
                  colKey={colKey}
                  value={stagedMeal[colKey]}
                  variant="staged-total"
                />
              ))}
            </div>
          </div>
        )}

        {/* Day total row (drop isMultiItem gate so single item meals show Day total) */}
        {(dailyTotals || targets) && (
          <DayTotalRow
            macroColumns={macroColumns}
            mealTotals={{
              calories: stagedMeal.calories,
              protein: stagedMeal.protein,
              carbs: stagedMeal.carbs,
              fat: stagedMeal.fat,
              fiber: stagedMeal.fiber,
            }}
            dailyTotals={dailyTotals}
            targets={targets}
          />
        )}
      </div>

      {/* Accessible math explanation for screen readers (visual formula box removed) */}
      {stagedMeal.explanation && (
        <span className="sr-only" aria-live="polite">{stagedMeal.explanation}</span>
      )}

      {/* Action Buttons Bar */}
      <div
        data-testid="staged-card-actions"
        style={{ bottom: `${effectiveNavHeight}px` }}
        className="sticky z-20 bg-zinc-900 border-t border-zinc-800/80 -mx-3 px-3 sm:-mx-4 sm:px-4 py-1.5 flex items-center gap-1.5 sm:gap-2 rounded-b-2xl sm:rounded-b-3xl"
      >
        <button
          ref={logButtonRef}
          type="button"
          {...(isEditMode ? { 'data-testid': 'save-edit-meal-btn' } : {})}
          onClick={handleLogClick}
          onFocus={() => {
            logButtonHadFocusRef.current = true;
          }}
          onBlur={(e) => {
            if (e.relatedTarget && e.relatedTarget !== document.body) {
              logButtonHadFocusRef.current = false;
            }
          }}
          disabled={isEditMode ? (isPending || !isDirty || !isOnline) : isPending}
          title={isEditMode && !isOnline ? 'Available when online' : undefined}
          className={isEditMode
            ? 'flex-1 min-w-0 bg-gradient-to-r from-cyan-500 to-teal-600 hover:from-cyan-400 hover:to-teal-500 text-white font-bold py-2.5 px-2 min-h-[40px] rounded-xl text-xs shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95 transition motion-reduce:transition-none disabled:opacity-50 flex items-center justify-center gap-1 touch-manipulation whitespace-nowrap'
            : 'flex-1 min-w-0 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-2.5 px-2 min-h-[40px] rounded-xl text-xs shadow-[0_0_15px_rgba(16,185,129,0.3)] active:scale-95 transition motion-reduce:transition-none disabled:opacity-50 flex items-center justify-center gap-1 touch-manipulation whitespace-nowrap'
          }
        >
          <Check className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">
            {isEditMode
              ? (isPending ? 'Saving...' : 'Save changes')
              : (isPending ? 'Logging...' : `Log Meal (+${formatCalories(stagedMeal.calories)} kcal)`)}
          </span>
        </button>

        <button
          type="button"
          aria-label="Save as Custom Dish"
          disabled={!isOnline}
          onClick={onSaveStagedAsCustomDish}
          className="bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold py-2.5 px-3 min-h-[40px] rounded-xl text-xs border border-border-interactive transition motion-reduce:transition-none flex items-center gap-1.5 touch-manipulation shrink-0 disabled:opacity-50"
          title={!isOnline ? 'Available when online' : 'Save this meal as a quick-log custom dish'}
        >
          <Star className="w-3.5 h-3.5 fill-amber-400 shrink-0" />
          <span className="hidden sm:inline">
            {!isOnline ? 'Save as Custom Dish (Available when online)' : 'Save as Custom Dish'}
          </span>
        </button>

        {isEditMode ? (
          <button
            type="button"
            data-testid="cancel-edit-meal-btn"
            aria-label="Cancel editing"
            onClick={onCancel ?? handleDiscardClick}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold transition motion-reduce:transition-none border border-border-interactive flex items-center justify-center touch-manipulation shrink-0"
            title="Cancel"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            aria-label="Discard staged meal"
            onClick={handleDiscardClick}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white p-2.5 min-h-[40px] min-w-[40px] rounded-xl transition motion-reduce:transition-none border border-border-interactive flex items-center justify-center touch-manipulation shrink-0"
            title="Discard"
          >
            <X className="w-4 h-4 shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
});

StagedMealCard.displayName = 'StagedMealCard';
