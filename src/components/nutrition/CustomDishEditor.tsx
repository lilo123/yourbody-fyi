import React, { useRef, useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCalories, formatMacro, roundTo1Decimal } from '../../utils/nutrition';
import { parseQuantityInput, shortUnitLabel, type CanonicalUnit } from '../../utils/unitConverter';
import { sumItems, MAX_ITEMS, type NutritionItem } from '../../utils/itemModel';
import { UnitChip } from './UnitChip';

export interface CustomDishEditorProps {
  items: NutritionItem[];
  onChange: (next: NutritionItem[]) => void;
}

let seq = 0;
function newItemId(): string {
  seq += 1;
  return `new-${Date.now()}-${seq}`;
}

const MACRO_FIELDS = [
  { key: 'calories', label: 'Calories', tone: 'text-amber-400', mode: 'decimal' },
  { key: 'protein', label: 'Protein (g)', tone: 'text-cyan-400', mode: 'decimal' },
  { key: 'carbs', label: 'Carbs (g)', tone: 'text-emerald-400', mode: 'decimal' },
  { key: 'fat', label: 'Fat (g)', tone: 'text-violet-400', mode: 'decimal' },
  { key: 'fiber', label: 'Fiber (g)', tone: 'text-teal-400', mode: 'decimal' },
] as const;

/**
 * Structured editor for a custom dish's components.
 *
 * This replaces a single-line `<input type="text">` that was bound directly to
 * the raw `ingredients` JSON blob and wrote back whatever came out of it. Any
 * user who tapped that field corrupted their breakdown; clearing it nulled the
 * column outright. That is a live data-destruction bug, and replacing this
 * control is the fix.
 *
 * Layout is a name line plus a six-column macro grid of `col-span-2` cells,
 * which reflows to three per row on mobile without a second desktop layout, and
 * deliberately has no scroll region of its own: the modal already scrolls and
 * there is already one nested scroller in it.
 */
export const CustomDishEditor: React.FC<CustomDishEditorProps> = ({ items, onChange }) => {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const totals = sumItems(items);

  const patch = (index: number, next: Partial<NutritionItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...next } : it)));
  };

  const patchMacro = (index: number, key: (typeof MACRO_FIELDS)[number]['key'], raw: string) => {
    // Round to at most 1 decimal place. An unusable entry clears to 0 rather than poisoning the parent sum.
    const n = Number(raw);
    patch(index, { [key]: raw === '' ? 0 : Number.isFinite(n) ? Math.max(0, roundTo1Decimal(n)) : 0 } as Partial<NutritionItem>);
  };

  const remove = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    onChange(next);
    // Move focus to the next row, or the add button when the last row went;
    // otherwise focus lands on <body>.
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLInputElement>('[data-testid="dish-item-name"]');
      const target = rows?.[Math.min(index, (rows?.length ?? 1) - 1)];
      (target ?? addRef.current)?.focus();
    });
  };

  const add = () => {
    if (items.length >= MAX_ITEMS) return;
    onChange([
      ...items,
      {
        id: newItemId(),
        name: '',
        quantity: 1,
        unit: 'unit',
        displayPortion: null,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      },
    ]);
  };

  return (
    <div className="space-y-2" data-testid="custom-dish-editor">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Components ({items.length})
        </span>
        <button
          ref={addRef}
          type="button"
          onClick={add}
          disabled={items.length >= MAX_ITEMS}
          data-testid="dish-add-item"
          className="flex min-h-[44px] items-center gap-1 rounded-xl px-2 text-xs font-bold text-cyan-300 transition hover:bg-zinc-800 disabled:opacity-50 touch-manipulation"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add</span>
        </button>
      </div>

      <div ref={listRef} className="space-y-2">
        {items.map((item, index) => {
          const itemKey = item.id || String(index);
          const qtyId = `${baseId}-item-${itemKey}-qty`;
          return (
            <div
              key={item.id}
              data-testid="dish-item-row"
              className="space-y-1.5 rounded-xl border border-zinc-800 border-l-2 border-l-cyan-500/40 bg-zinc-950 p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  data-testid="dish-item-name"
                  aria-label={`Component ${index + 1} name`}
                  value={item.name}
                  onChange={(e) => patch(index, { name: e.target.value })}
                  placeholder="e.g. Rolled oats"
                  className="min-h-[44px] w-full min-w-0 flex-1 rounded-xl border border-border-interactive bg-zinc-950 px-2.5 text-base font-semibold text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove component ${index + 1}`}
                  data-testid="dish-item-remove"
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-rose-500/10 hover:text-rose-400 touch-manipulation"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-6 gap-1.5">
                <div className="col-span-2">
                  <label
                    htmlFor={qtyId}
                    className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-400"
                  >
                    Qty
                  </label>
                  <input
                    id={qtyId}
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    data-testid="dish-item-quantity"
                    aria-label={`Component ${index + 1} quantity`}
                    value={roundTo1Decimal(item.quantity)}
                    onChange={(e) => {
                      const parsed = parseQuantityInput(e.target.value);
                      patch(index, { quantity: parsed != null ? roundTo1Decimal(parsed) : 0 });
                    }}
                    className="min-h-[44px] w-full rounded-xl border border-border-interactive bg-zinc-950 p-2 text-center text-base tabular-nums font-bold text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="col-span-2">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Unit
                  </span>
                  <div className="flex min-h-[44px] items-center">
                    <UnitChip
                      value={item.unit}
                      onChange={(unit: CanonicalUnit) => patch(index, { unit })}
                      testId="dish-item-unit"
                    />
                  </div>
                </div>
                {MACRO_FIELDS.map((field) => {
                  const macroId = `${baseId}-item-${itemKey}-${field.key}`;
                  return (
                    <div key={field.key} className="col-span-2">
                      <label
                        htmlFor={macroId}
                        className={`mb-1 block text-xs font-bold uppercase tracking-wider ${field.tone}`}
                      >
                        {field.label}
                      </label>
                      <input
                        id={macroId}
                        type="number"
                        step="any"
                        min="0"
                        inputMode={field.mode}
                        data-testid={`dish-item-${field.key}`}
                        aria-label={`Component ${index + 1} ${field.label}`}
                        value={roundTo1Decimal(item[field.key])}
                        onChange={(e) => patchMacro(index, field.key, e.target.value)}
                        className="min-h-[44px] w-full rounded-xl border border-border-interactive bg-zinc-950 p-2 text-center text-base tabular-nums font-bold text-white outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50"
                      />
                    </div>
                  );
                })}
              </div>

            {item.displayPortion && (
              <span className="block tabular-nums text-xs text-zinc-400">
                was &ldquo;{item.displayPortion}&rdquo; &middot; {roundTo1Decimal(item.quantity)}{' '}
                {shortUnitLabel(item.unit)}
              </span>
            )}
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <div
          data-testid="dish-derived-totals"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950 p-2.5 tabular-nums text-xs text-zinc-400"
        >
          <span className="font-bold uppercase tracking-wider text-zinc-400">Dish total</span>
          <span className="font-bold text-amber-400">{formatCalories(totals.calories)} kcal</span>
          <span className="text-cyan-400">P {formatMacro(totals.protein)}</span>
          <span className="text-emerald-400">C {formatMacro(totals.carbs)}</span>
          <span className="text-violet-400">F {formatMacro(totals.fat)}</span>
          <span className="text-teal-400">Fib {formatMacro(totals.fiber)}</span>
        </div>
      )}
    </div>
  );
};
