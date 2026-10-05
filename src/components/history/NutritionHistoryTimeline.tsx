import React from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { NutritionLog } from '../../types/database';
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCalories, formatMacro } from '../../utils/nutrition';
import { MealLogRow } from '../nutrition/MealLogRow';
import type { NutritionItem } from '../../utils/itemModel';
import { FALLBACK_WINDOW } from './virtualizationConstants';
import { Skeleton } from '../common/Skeleton';
import { formatNutritionDayHeader } from './useHistoryData';

export interface NutritionDaySummary {
  date: string;
  meals: NutritionLog[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  macroCalories: { protein: number; carbs: number; fat: number; total: number };
  percentages: { protein: number; carbs: number; fat: number };
}

export interface NutritionHistoryTimelineProps {
  filteredNutritionDays: NutritionDaySummary[];
  timeRange: 'all' | '90d' | '30d' | '1y';
  isInspectingAthlete: boolean;
  onEditMeal: (meal: NutritionLog) => void;
  onDeleteMeal: (mealId: string, meal?: NutritionLog) => void;
  onScaleMeal?: (log: NutritionLog, items: NutritionItem[]) => Promise<unknown>;
  // H23
  isNutritionPending?: boolean;
  onNavigateToNutrition?: () => void;
  // H11
  hasMoreNutrition?: boolean;
  isLoadingMoreNutrition?: boolean;
  onLoadMoreNutrition?: () => void;
  // RD-7 pending delete hiding
  pendingDeleteMealId?: string | null;
}

// D-YB4-2: Realistic collapsed day-card height estimate derived from 390px/320px browser measurements
const COLLAPSED_DAY_CARD_ESTIMATE_PX = 156;

export const NutritionHistoryTimeline: React.FC<NutritionHistoryTimelineProps> = ({
  filteredNutritionDays,
  timeRange,
  isInspectingAthlete,
  onEditMeal,
  onDeleteMeal,
  onScaleMeal: _onScaleMeal,
  isNutritionPending = false,
  onNavigateToNutrition,
  hasMoreNutrition = false,
  isLoadingMoreNutrition = false,
  onLoadMoreNutrition,
  pendingDeleteMealId,
}) => {
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);

  // In-memory accordion expansion state (D-YB-9); resets on remount, survives range change & paging
  const [expandedDates, setExpandedDates] = React.useState<Set<string>>(() => new Set());

  const handleToggle = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  // Filter out pending delete meals from days (RD-7, H27)
  const displayDays = React.useMemo(() => {
    if (!pendingDeleteMealId) return filteredNutritionDays;
    return filteredNutritionDays
      .map((day) => {
        const remainingMeals = day.meals.filter((m) => m.id !== pendingDeleteMealId);
        if (remainingMeals.length === day.meals.length) return day;
        // Recompute totals without the pending delete meal
        const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
        remainingMeals.forEach((log) => {
          totals.calories += Number(log.calories) || 0;
          totals.protein += Number(log.protein) || 0;
          totals.carbs += Number(log.carbs) || 0;
          totals.fat += Number(log.fat) || 0;
          totals.fiber += Number(log.fiber) || 0;
        });
        const pCal = totals.protein * 4;
        const cCal = totals.carbs * 4;
        const fCal = totals.fat * 9;
        const totalMacroCal = pCal + cCal + fCal;
        const percentages =
          totalMacroCal > 0
            ? {
                protein: Math.round((pCal / totalMacroCal) * 100),
                carbs: Math.round((cCal / totalMacroCal) * 100),
                fat: Math.max(
                  0,
                  100 -
                    Math.round((pCal / totalMacroCal) * 100) -
                    Math.round((cCal / totalMacroCal) * 100)
                ),
              }
            : { protein: 0, carbs: 0, fat: 0 };
        return {
          ...day,
          meals: remainingMeals,
          totals,
          macroCalories: { protein: pCal, carbs: cCal, fat: fCal, total: totalMacroCal },
          percentages,
        };
      })
      .filter((day) => day.meals.length > 0);
  }, [filteredNutritionDays, pendingDeleteMealId]);

  const measureScrollMargin = React.useCallback(() => {
    if (parentRef.current) {
      const offsetTop = parentRef.current.offsetTop;
      setScrollMargin((prev) => (prev !== offsetTop ? offsetTop : prev));
    }
  }, []);

  const containerRef = React.useCallback((node: HTMLDivElement | null) => {
    parentRef.current = node;
    if (node) {
      const offsetTop = node.offsetTop;
      setScrollMargin((prev) => (prev !== offsetTop ? offsetTop : prev));
    }
  }, []);

  React.useLayoutEffect(() => {
    measureScrollMargin();
  });

  React.useEffect(() => {
    measureScrollMargin();
    window.addEventListener('resize', measureScrollMargin);
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      const observer = new ResizeObserver(() => {
        measureScrollMargin();
      });
      observer.observe(document.body);
      return () => {
        window.removeEventListener('resize', measureScrollMargin);
        observer.disconnect();
      };
    }
    return () => {
      window.removeEventListener('resize', measureScrollMargin);
    };
  }, [measureScrollMargin]);

  const getItemKey = React.useCallback(
    (index: number) => displayDays[index]?.date ?? index,
    [displayDays]
  );

  const virtualizer = useWindowVirtualizer({
    count: displayDays.length,
    getItemKey,
    estimateSize: (index) => {
      const day = displayDays[index];
      if (!day) return COLLAPSED_DAY_CARD_ESTIMATE_PX;
      const isExpanded = expandedDates.has(day.date);
      if (!isExpanded) return COLLAPSED_DAY_CARD_ESTIMATE_PX;
      const mealsCount = day.meals?.length ?? 1;
      return 200 + mealsCount * 80;
    },
    overscan: 0,
    gap: 16,
    scrollMargin,
    measureElement: (element, entry) => {
      if (entry?.borderBoxSize?.[0]?.blockSize) {
        return Math.round(entry.borderBoxSize[0].blockSize);
      }
      const measured = element?.getBoundingClientRect?.()?.height;
      if (measured && measured > 0) {
        return Math.round(measured);
      }
      const index = Number(element?.getAttribute('data-index'));
      const day = displayDays[index];
      if (!day) return COLLAPSED_DAY_CARD_ESTIMATE_PX;
      const isExpanded = expandedDates.has(day.date);
      if (!isExpanded) return COLLAPSED_DAY_CARD_ESTIMATE_PX;
      const mealsCount = day.meals?.length ?? 1;
      return 200 + mealsCount * 80;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const isVirtual = virtualItems.length > 0;

  // H23: Skeleton cards (aria-busy) while initial fetch is pending
  if (isNutritionPending) {
    return (
      <div data-testid="nutrition-history-skeleton" className="space-y-4">
        <Skeleton variant="card" count={3} ariaLabel="Loading nutrition history..." />
      </div>
    );
  }

  // H23: Empty state with 'Log a meal' CTA
  if (displayDays.length === 0) {
    return (
      <div
        data-testid="nutrition-history-empty"
        className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-8 text-center space-y-4"
      >
        <p className="text-zinc-400 text-xs">
          {timeRange === 'all'
            ? 'No nutrition logs recorded yet.'
            : 'No nutrition logs recorded in this time range.'}
        </p>
        {!isInspectingAthlete && onNavigateToNutrition && (
          <button
            type="button"
            onClick={onNavigateToNutrition}
            data-testid="log-meal-cta-btn"
            className="inline-flex items-center justify-center px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-border-interactive transition touch-manipulation cursor-pointer"
          >
            Log a meal
          </button>
        )}
      </div>
    );
  }

  const renderDayCard = (day: NutritionDaySummary) => {
    const { title, subtitle } = formatNutritionDayHeader(day.date, day.meals.length);
    const isExpanded = expandedDates.has(day.date);

    return (
      <div
        key={day.date}
        className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
      >
        {/* Date Header & Macro Summary Pills */}
        <div className={`space-y-3 ${isExpanded ? 'border-b border-zinc-800 pb-3' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">{title}</span>
              </h3>
              <div className="text-xs text-zinc-400 mt-0.5 truncate">
                <span>{subtitle}</span>
                <span className="sr-only">{day.date} • {day.meals.length} {day.meals.length === 1 ? "meal" : "meals"} logged</span>
              </div>
            </div>

            {/* D-YB-9: 44px Chevron toggle with aria-expanded & aria-controls */}
            <button
              type="button"
              onClick={() => handleToggle(day.date)}
              aria-expanded={isExpanded}
              aria-controls={`nutrition-day-details-${day.date}`}
              aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
              data-testid={`expand-day-btn-${day.date}`}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-zinc-800/60 hover:bg-cyan-500/20 text-zinc-400 hover:text-cyan-300 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer shrink-0"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Daily Macro Summary Pills */}
          <div className="flex items-center gap-1.5 flex-wrap tabular-nums text-xs font-bold">
            <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-xl">
              {formatCalories(day.totals.calories)} kcal
            </span>
            <span className="bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 px-2 py-1 rounded-xl text-xs">
              {formatMacro(day.totals.protein)}g P
            </span>
            <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded-xl text-xs">
              {formatMacro(day.totals.carbs)}g C
            </span>
            <span className="bg-violet-500/15 text-violet-400 border border-violet-500/30 px-2 py-1 rounded-xl text-xs">
              {formatMacro(day.totals.fat)}g F
            </span>
            <span className="bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-1 rounded-xl text-xs">
              {formatMacro(day.totals.fiber)}g Fib
            </span>
          </div>
        </div>

        {/* Proportional Caloric Macro Distribution Bar and Meals list when expanded */}
        {isExpanded && (
          <div id={`nutrition-day-details-${day.date}`} className="space-y-4">
            {day.macroCalories.total > 0 && (
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold uppercase text-zinc-400 tracking-wider">
                  <span>Caloric Macro Distribution</span>
                  <span className="text-zinc-400 tabular-nums font-normal text-xs">
                    {formatCalories(day.macroCalories.total)} macro kcal
                  </span>
                </div>

                {/* Multi-segment ratio bar */}
                <div className="h-2.5 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden flex shadow-inner">
                  {day.percentages.protein > 0 && (
                    <div
                      style={{ width: `${day.percentages.protein}%` }}
                      className="bg-cyan-400 transition-all duration-500"
                      title={`Protein: ${day.percentages.protein}% (${formatCalories(day.macroCalories.protein)} kcal)`}
                    />
                  )}
                  {day.percentages.carbs > 0 && (
                    <div
                      style={{ width: `${day.percentages.carbs}%` }}
                      className="bg-emerald-400 transition-all duration-500"
                      title={`Carbs: ${day.percentages.carbs}% (${formatCalories(day.macroCalories.carbs)} kcal)`}
                    />
                  )}
                  {day.percentages.fat > 0 && (
                    <div
                      style={{ width: `${day.percentages.fat}%` }}
                      className="bg-violet-400 transition-all duration-500"
                      title={`Fat: ${day.percentages.fat}% (${formatCalories(day.macroCalories.fat)} kcal)`}
                    />
                  )}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-between text-xs tabular-nums text-zinc-400 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block"></span>
                    <span className="text-cyan-300 font-bold">{day.percentages.protein}% P</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                    <span className="text-emerald-300 font-bold">{day.percentages.carbs}% C</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-violet-400 inline-block"></span>
                    <span className="text-violet-300 font-bold">{day.percentages.fat}% F</span>
                  </div>
                </div>
              </div>
            )}

            {/* Meals timeline for this day */}
            <div className="space-y-2 pt-1">
              {day.meals.map((meal) => (
                <MealLogRow
                  key={meal.id}
                  log={meal}
                  onEdit={onEditMeal}
                  onDelete={(m) => onDeleteMeal(m.id, m)}
                  readOnly={isInspectingAthlete}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {!isVirtual ? (
        <div ref={containerRef} className="space-y-4">
          {displayDays.length > FALLBACK_WINDOW && (
            <div
              data-testid="virtualizer-fallback-notice"
              className="text-xs text-zinc-400 text-center py-2 tabular-nums"
            >
              Showing first {FALLBACK_WINDOW} of {displayDays.length} (virtualization disabled)
            </div>
          )}
          {displayDays.slice(0, FALLBACK_WINDOW).map((day) => (
            <div key={day.date}>
              {renderDayCard(day)}
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          {virtualItems.map((virtualRow) => {
            const day = displayDays[virtualRow.index];
            if (!day) return null;
            return (
              <div
                key={day.date || virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                }}
              >
                {renderDayCard(day)}
              </div>
            );
          })}
        </div>
      )}

      {/* H11: Load older days button when hasMoreNutrition */}
      {hasMoreNutrition && displayDays.length > 0 && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={onLoadMoreNutrition}
            disabled={isLoadingMoreNutrition}
            data-testid="load-more-nutrition-btn"
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-zinc-800/80 hover:bg-zinc-700 text-cyan-300 border border-border-interactive transition touch-manipulation disabled:opacity-50 cursor-pointer"
          >
            {isLoadingMoreNutrition ? 'Loading...' : 'Load older days'}
          </button>
        </div>
      )}
    </div>
  );
};
