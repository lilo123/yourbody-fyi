import React, { useState, useMemo, useId } from 'react';
import { X, ChevronDown, ChevronRight, PieChart } from 'lucide-react';
import type { NutritionLog } from '../../types/database';
import { useModalA11y } from '../../hooks/useModalA11y';
import { getDishIcon } from '../../utils/dishIcons';
import { formatCalories, formatMacro, formatPercentage, roundTo1Decimal } from '../../utils/nutrition';
import { isLevel1, normalizeItems, sumItems, type NutritionItem } from '../../utils/itemModel';

export type BreakdownNutrient = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber';

export interface NutrientConfig {
  key: BreakdownNutrient;
  label: string;
  shortLabel: string;
  unit: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  activePillClass: string;
}

const NUTRIENT_CONFIGS: Record<BreakdownNutrient, NutrientConfig> = {
  calories: {
    key: 'calories',
    label: 'Calories',
    shortLabel: 'Cal',
    unit: 'kcal',
    textColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/25',
    activePillClass: 'bg-amber-500/20 border-amber-500/40 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.2)]',
  },
  protein: {
    key: 'protein',
    label: 'Protein',
    shortLabel: 'Protein',
    unit: 'g',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/25',
    activePillClass: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.2)]',
  },
  carbs: {
    key: 'carbs',
    label: 'Carbs',
    shortLabel: 'Carbs',
    unit: 'g',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/25',
    activePillClass: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)]',
  },
  fat: {
    key: 'fat',
    label: 'Fat',
    shortLabel: 'Fat',
    unit: 'g',
    textColor: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/25',
    activePillClass: 'bg-violet-500/20 border-violet-500/40 text-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.2)]',
  },
  fiber: {
    key: 'fiber',
    label: 'Fiber',
    shortLabel: 'Fiber',
    unit: 'g',
    textColor: 'text-teal-400',
    bgColor: 'bg-teal-500/10',
    borderColor: 'border-teal-500/25',
    activePillClass: 'bg-teal-500/20 border-teal-500/40 text-teal-400 shadow-[0_0_8px_rgba(20,184,166,0.2)]',
  },
};

const NUTRIENT_KEYS: BreakdownNutrient[] = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

export interface NutrientBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNutrient: BreakdownNutrient;
  onSelectNutrient: (nutrient: BreakdownNutrient) => void;
  logs: NutritionLog[];
  dailyTotals?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  targets?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
  };
}

function getMealRawNutrientValue(log: NutritionLog, nutrient: BreakdownNutrient): number {
  const items = normalizeItems(log.items);
  if (items && items.length > 0) {
    const raw = sumItems(items)[nutrient];
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  const raw = Number(log[nutrient]);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function getMealNutrientValue(log: NutritionLog, nutrient: BreakdownNutrient): number {
  const rawVal = getMealRawNutrientValue(log, nutrient);
  return nutrient === 'calories' ? Math.round(rawVal) : roundTo1Decimal(rawVal);
}

interface MealBreakdownRowProps {
  log: NutritionLog;
  selectedNutrient: BreakdownNutrient;
  dailyTotal: number;
  config: NutrientConfig;
}

const MealBreakdownRow: React.FC<MealBreakdownRowProps> = ({
  log,
  selectedNutrient,
  dailyTotal,
  config,
}) => {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => normalizeItems(log.items), [log.items]);
  const composite = isLevel1(items);

  const mealNutrientVal = useMemo(
    () => getMealNutrientValue(log, selectedNutrient),
    [log, selectedNutrient]
  );

  const formattedMealVal =
    selectedNutrient === 'calories'
      ? `${formatCalories(mealNutrientVal)} kcal`
      : `${formatMacro(mealNutrientVal)}g`;

  const mealPct = formatPercentage(mealNutrientVal, dailyTotal);

  const sortedItems = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [...items].sort((a, b) => {
      const rawA = Number.isFinite(Number(a[selectedNutrient]))
        ? Math.max(0, Number(a[selectedNutrient]))
        : 0;
      const rawB = Number.isFinite(Number(b[selectedNutrient]))
        ? Math.max(0, Number(b[selectedNutrient]))
        : 0;
      const valA =
        selectedNutrient === 'calories' ? Math.round(rawA) : roundTo1Decimal(rawA);
      const valB =
        selectedNutrient === 'calories' ? Math.round(rawB) : roundTo1Decimal(rawB);
      if (valB !== valA) {
        return valB - valA;
      }
      return rawB - rawA;
    });
  }, [items, selectedNutrient]);

  if (composite && items) {
    return (
      <div
        data-testid={`breakdown-meal-row-${log.id}`}
        className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-2.5 sm:p-3 shadow-sm transition-all"
      >
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={panelId}
          data-testid={`breakdown-accordion-trigger-${log.id}`}
          className="flex w-full min-h-[44px] items-center justify-between gap-2 text-left touch-manipulation cursor-pointer rounded-xl hover:bg-zinc-850/60 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
            )}
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
              {getDishIcon(log.food_name)}
            </div>
            <span
              data-testid={`breakdown-meal-name-${log.id}`}
              className="text-sm font-semibold text-white truncate min-w-0 flex-1"
              title={log.food_name || 'Unnamed Meal'}
            >
              {log.food_name || 'Unnamed Meal'}
            </span>
            <span
              data-testid={`breakdown-count-badge-${log.id}`}
              className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-xs font-bold tabular-nums text-cyan-300"
            >
              {items.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 tabular-nums text-xs">
            <span className={`font-bold ${config.textColor}`}>{formattedMealVal}</span>
            <span
              data-testid={`breakdown-meal-pct-${log.id}`}
              className="tabular-nums text-xs font-bold px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/60 shrink-0"
            >
              {mealPct}
            </span>
          </div>
        </button>

        {expanded && (
          <div
            id={panelId}
            role="region"
            aria-label={`${log.food_name || 'Meal'} component breakdown`}
            data-testid={`breakdown-accordion-panel-${log.id}`}
            className="mt-2 pt-2 border-t border-zinc-800/60 space-y-1.5 pl-2 sm:pl-3"
          >
            {sortedItems.map((child: NutritionItem) => {
              const childRawVal = Number.isFinite(Number(child[selectedNutrient]))
                ? Math.max(0, Number(child[selectedNutrient]))
                : 0;
              const childVal =
                selectedNutrient === 'calories'
                  ? Math.round(childRawVal)
                  : roundTo1Decimal(childRawVal);
              const formattedChildVal =
                selectedNutrient === 'calories'
                  ? `${formatCalories(childVal)} kcal`
                  : `${formatMacro(childVal)}g`;
              const childPctOfMeal = formatPercentage(childVal, mealNutrientVal);

              return (
                <div
                  key={child.id}
                  data-testid="breakdown-child-row"
                  className="flex items-center justify-between text-xs py-1 text-zinc-300 gap-2"
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      data-testid="breakdown-child-name"
                      className="truncate text-xs font-normal text-zinc-300 min-w-0 flex-1"
                      title={child.name || 'Item'}
                    >
                      {child.name || 'Item'}
                    </span>
                    {child.displayPortion && (
                      <span
                        data-testid="breakdown-child-portion"
                        title={child.displayPortion}
                        className="text-xs tabular-nums text-zinc-400 truncate max-w-[90px] shrink-0"
                      >
                        ({child.displayPortion})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 tabular-nums text-xs">
                    <span className={`${config.textColor} font-semibold`}>
                      {formattedChildVal}
                    </span>
                    <span
                      data-testid="breakdown-child-pct"
                      className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400 border border-zinc-700/40 shrink-0"
                    >
                      {childPctOfMeal}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Level 2 leaf row (standalone or 0/1 item) - no accordion, no chevron, no count badge
  return (
    <div
      data-testid={`breakdown-leaf-row-${log.id}`}
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-2.5 sm:p-3 shadow-sm flex items-center justify-between min-h-[44px] gap-2"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
          {getDishIcon(log.food_name)}
        </div>
        <span
          data-testid={`breakdown-meal-name-${log.id}`}
          className="text-sm font-semibold text-white truncate min-w-0 flex-1"
          title={log.food_name || 'Unnamed Meal'}
        >
          {log.food_name || 'Unnamed Meal'}
        </span>
        {log.serving_unit && log.serving_size ? (
          <span
            data-testid={`breakdown-leaf-serving-${log.id}`}
            title={`${log.serving_size} ${log.serving_unit}`}
            className="text-xs tabular-nums text-zinc-400 truncate max-w-[90px] shrink-0"
          >
            ({log.serving_size} {log.serving_unit})
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 tabular-nums text-xs">
        <span className={`font-bold ${config.textColor}`}>{formattedMealVal}</span>
        <span
          data-testid={`breakdown-meal-pct-${log.id}`}
          className="tabular-nums text-xs font-bold px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/60 shrink-0"
        >
          {mealPct}
        </span>
      </div>
    </div>
  );
};

export const NutrientBreakdownModal: React.FC<NutrientBreakdownModalProps> = ({
  isOpen,
  onClose,
  selectedNutrient,
  onSelectNutrient,
  logs,
  dailyTotals,
  targets,
}) => {
  const containerRef = useModalA11y(isOpen, onClose);

  const config = NUTRIENT_CONFIGS[selectedNutrient] || NUTRIENT_CONFIGS.calories;

  const currentDailyTotal = useMemo(() => {
    if (dailyTotals && Number.isFinite(dailyTotals[selectedNutrient])) {
      return selectedNutrient === 'calories'
        ? Math.round(dailyTotals.calories)
        : roundTo1Decimal(dailyTotals[selectedNutrient]);
    }
    const rawTotal = logs.reduce(
      (acc, l) => acc + getMealRawNutrientValue(l, selectedNutrient),
      0
    );
    return selectedNutrient === 'calories' ? Math.round(rawTotal) : roundTo1Decimal(rawTotal);
  }, [dailyTotals, logs, selectedNutrient]);

  const contributingLogs = useMemo(() => {
    return logs
      .map((log) => ({
        log,
        value: getMealNutrientValue(log, selectedNutrient),
        rawValue: getMealRawNutrientValue(log, selectedNutrient),
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => {
        if (b.value !== a.value) {
          return b.value - a.value;
        }
        return b.rawValue - a.rawValue;
      })
      .map((item) => item.log);
  }, [logs, selectedNutrient]);

  const targetVal = targets ? targets[selectedNutrient] : undefined;

  const formattedDailyTotal =
    selectedNutrient === 'calories'
      ? `${formatCalories(currentDailyTotal)} kcal`
      : `${formatMacro(currentDailyTotal)}g`;

  const formattedTargetVal =
    targetVal !== undefined
      ? selectedNutrient === 'calories'
        ? `${formatCalories(targetVal)} kcal`
        : `${formatMacro(targetVal)}g`
      : null;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="nutrient-breakdown-title"
        data-testid="nutrient-breakdown-modal"
        className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-3 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] sm:pb-5 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[90vh] overflow-hidden animate-in fade-in slide-in-from-bottom-6 sm:slide-in-from-bottom-0 duration-200"
      >
        {/* Drag handle on mobile */}
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto sm:hidden shrink-0 mt-0.5 mb-1.5"
          aria-hidden="true"
        />

        {/* 2-Row Stacked Header */}
        <div className="space-y-2.5 shrink-0">
          {/* Row 1: Title + Close button */}
          <div className="flex items-center justify-between pb-1 border-b border-zinc-800/80">
            <h2
              id="nutrient-breakdown-title"
              className="text-sm font-bold text-white flex items-center gap-2 truncate min-w-0"
            >
              <PieChart className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Nutrient Breakdown</span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              data-testid="close-breakdown-modal-btn"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl transition touch-manipulation shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Row 2: 5-Nutrient Segmented Pill Switcher */}
          <div
            role="tablist"
            aria-label="Nutrient switcher"
            className="grid grid-cols-5 gap-1 p-1 bg-zinc-950/80 rounded-xl border border-zinc-800/80 w-full shrink-0"
          >
            {NUTRIENT_KEYS.map((key) => {
              const cfg = NUTRIENT_CONFIGS[key];
              const isSelected = selectedNutrient === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  aria-controls="nutrient-breakdown-tabpanel"
                  data-testid={`nutrient-pill-${key}`}
                  onClick={() => onSelectNutrient(key)}
                  className={`min-h-[44px] min-w-0 flex items-center justify-center rounded-lg text-xs font-bold transition-all touch-manipulation px-0.5 truncate cursor-pointer border ${
                    isSelected
                      ? cfg.activePillClass
                      : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  {cfg.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Nutrient Daily Summary */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-2.5 sm:p-3 flex items-center justify-between tabular-nums text-xs shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-zinc-400 font-bold uppercase text-xs tracking-wider truncate">
              Today's {config.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-bold shrink-0">
            <span className={`${config.textColor} text-sm font-bold`}>
              {formattedDailyTotal}
            </span>
            {formattedTargetVal && (
              <span className="text-zinc-400 text-xs">/ {formattedTargetVal}</span>
            )}
          </div>
        </div>

        {/* Meal Logs Breakdown List */}
        <div
          role="tabpanel"
          id="nutrient-breakdown-tabpanel"
          aria-label={`${config.label} breakdown`}
          className="flex-1 overflow-y-auto space-y-2 pr-0.5 min-h-0"
        >
          {contributingLogs.length === 0 ? (
            <div
              data-testid="breakdown-empty-state"
              className="py-8 text-center text-zinc-400 text-xs font-normal"
            >
              {logs.length === 0
                ? 'No meals logged for this date.'
                : `No meals with ${config.label.toLowerCase()} logged for this date.`}
            </div>
          ) : (
            contributingLogs.map((log) => (
              <MealBreakdownRow
                key={log.id}
                log={log}
                selectedNutrient={selectedNutrient}
                dailyTotal={currentDailyTotal}
                config={config}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
