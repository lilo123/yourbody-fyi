import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { NutritionLog } from '../../types/database';
import { getDishIcon } from '../../utils/dishIcons';
import { formatCalories, formatMacro } from '../../utils/nutrition';
import {
  normalizeItems,
  sumItems,
  isLevel1,
  type NutritionItem,
} from '../../utils/itemModel';
import { supabase } from '../../lib/supabase';
import { OverflowMenu, type OverflowMenuItem } from '../common/OverflowMenu';
import { ComponentRow } from './ComponentRow';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { PendingMark } from '../sync/PendingMark';

export interface MealLogRowProps {
  log: NutritionLog & { items?: unknown };
  onEdit: (log: NutritionLog) => void;
  onDelete: (log: NutritionLog) => void;
  /**
   * Coach read-only inspection. Expanding is allowed — seeing the breakdown is
   * exactly what a coach wants and RLS permits SELECT — but every mutating
   * affordance is hidden, because RLS rejects the UPDATE and the error surfaces
   * as a raw Postgres string.
   */
  readOnly?: boolean;
}

/**
 * The single meal row, shared by NutritionEngine and HistoryView.
 *
 * The timeline row panel is strictly read-only. Inline whole-dish scaling
 * and inline component editing have been removed; editing is now exclusively
 * handled in EditMealSheet.
 *
 * Layout is two rows inside a 220 px content box at 320 px:
 *   row 1  a real <button> trigger: chevron, icon, name, count badge
 *   row 2  the macro cluster plus one overflow button
 *
 * A row with fewer than two components renders no chevron, no count badge and
 * no trigger at all.
 */
export const MealLogRow: React.FC<MealLogRowProps> = ({
  log,
  onEdit,
  onDelete,
  readOnly = false,
}) => {
  const isOnline = useOnlineStatus();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const baseItems = useMemo(
    () => (log.items !== undefined ? normalizeItems(log.items) : undefined),
    [log.items]
  );
  const [onDemandItems, setOnDemandItems] = useState<NutritionItem[] | null | undefined>(baseItems);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (log.items !== undefined) {
      setOnDemandItems(normalizeItems(log.items));
    }
  }, [log.items]);

  const effectiveBaseItems = onDemandItems !== undefined ? onDemandItems : baseItems;
  const items = effectiveBaseItems ?? null;
  const expandable =
    effectiveBaseItems !== undefined
      ? isLevel1(effectiveBaseItems)
      : Boolean(log.has_components);

  const fetchItemsOnDemand = useCallback(async () => {
    setFetchError(null);
    try {
      // payload-gate: detail-fetch — loaded on demand only on user expand or scale action
      const { data, error: fetchErr } = await supabase
        .from('nutrition_logs')
        .select('id, items')
        .eq('id', log.id)
        .maybeSingle();
      if (fetchErr) {
        throw new Error(fetchErr.message || 'Failed to load meal components');
      }
      const resolved = data?.items ? normalizeItems(data.items) : null;
      setOnDemandItems(resolved);
      return resolved;
    } catch (err: any) {
      const msg = err?.message || 'Failed to load meal components';
      setFetchError(msg);
      throw err;
    }
  }, [log.id]);

  // Displayed macros follow the components whenever there are components
  const totals = items ? sumItems(items) : null;
  const shown = totals ?? {
    calories: Number(log.calories) || 0,
    protein: Number(log.protein) || 0,
    carbs: Number(log.carbs) || 0,
    fat: Number(log.fat) || 0,
    fiber: Number(log.fiber) || 0,
  };

  const menuItems: OverflowMenuItem[] = [
    {
      label: !isOnline ? 'Edit meal (Available when online)' : 'Edit meal',
      onSelect: () => {
        if (!isOnline) return;
        onEdit(log);
      },
      testId: `edit-meal-${log.id}`,
    },
    {
      label: !isOnline ? 'Delete meal (Available when online)' : 'Delete meal',
      onSelect: () => {
        if (!isOnline) return;
        onDelete(log);
      },
      tone: 'danger',
      testId: `delete-meal-${log.id}`,
    },
  ];

  const toggleExpanded = async () => {
    if (!expanded) {
      let current = effectiveBaseItems;
      if (current === undefined) {
        try {
          current = await fetchItemsOnDemand();
        } catch {
          return;
        }
      }
      if (current && isLevel1(current)) {
        setExpanded(true);
      } else {
        setExpanded(false);
      }
      return;
    }
    setExpanded(false);
  };

  const isPending = Boolean((log as any).pending);
  const identity = (
    <>
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
        {getDishIcon(log.food_name)}
      </div>
      <span
        data-testid="meal-log-name"
        title={log.food_name}
        className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white"
      >
        {log.food_name}
      </span>
      {isPending && <PendingMark size="sm" className="shrink-0" />}
    </>
  );

  return (
    <div
      data-testid="meal-log-item"
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950 p-3 shadow-sm"
    >
      {/* Row 1 — the trigger (or a plain identity line for a leaf). */}
      {expandable ? (
        <button
          type="button"
          data-testid="meal-log-accordion-trigger"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={toggleExpanded}
          className="flex w-full min-h-[44px] items-center gap-2 text-left touch-manipulation"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          )}
          {identity}
          <span
            data-testid="meal-log-count-badge"
            className="shrink-0 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-xs font-bold tabular-nums text-cyan-300"
          >
            {effectiveBaseItems ? effectiveBaseItems.length : '...'}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2">{identity}</div>
      )}

      {/* Row 2 — macro cluster plus a single overflow control. */}
      <div className="mt-1 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs tabular-nums text-zinc-400">
          {log.meal_type && (
            <span
              data-testid="meal-log-type-chip"
              className="whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-zinc-400"
            >
              {log.meal_type}
            </span>
          )}
          <span className="whitespace-nowrap font-bold text-amber-400">
            {formatCalories(shown.calories)} kcal
          </span>
          <span className="whitespace-nowrap text-cyan-400">P {formatMacro(shown.protein)}</span>
          <span className="whitespace-nowrap text-emerald-400">C {formatMacro(shown.carbs)}</span>
          <span className="whitespace-nowrap text-violet-400">F {formatMacro(shown.fat)}</span>
          <span className="whitespace-nowrap text-teal-400">Fib {formatMacro(shown.fiber)}</span>
        </div>
        {!readOnly && (
          <OverflowMenu
            ariaLabel={`Actions for ${log.food_name}`}
            items={menuItems}
            testId={`meal-actions-${log.id}`}
          />
        )}
      </div>

      {/* On-demand fetch failures surface an error state with a retry button */}
      <StatusBanner
        message={fetchError}
        tone="error"
        testId="meal-log-fetch-error"
        className="mt-1.5"
        action={
          fetchError && (
            <button
              type="button"
              data-testid="meal-log-fetch-retry"
              onClick={() => {
                void fetchItemsOnDemand().then((loadedItems) => {
                  if (loadedItems && isLevel1(loadedItems)) {
                    setExpanded(true);
                  }
                }).catch(() => {});
              }}
              className="shrink-0 rounded border border-rose-400/40 bg-rose-500/20 px-1.5 py-0.5 text-xs font-bold text-rose-200 hover:bg-rose-500/30 relative before:absolute before:inset-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] before:content-[''] touch-manipulation"
            >
              Retry
            </button>
          )
        }
      />

      {/* Expanded panel — read-only component list */}
      {expandable && expanded && (
        <div id={panelId} data-testid="meal-log-panel" className="mt-2 space-y-1.5">
          {(items ?? []).map((item) => (
            <ComponentRow
              key={item.id}
              item={item}
              reference={item}
              readOnly={true}
            />
          ))}
        </div>
      )}
    </div>
  );
};
