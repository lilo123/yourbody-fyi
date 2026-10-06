import React, { useState } from 'react';
import { formatCalories, formatMacro, roundTo1Decimal } from '../../utils/nutrition';
import { parseQuantityInput, shortUnitLabel, type CanonicalUnit } from '../../utils/unitConverter';
import { scaleItemToQuantity, reanchorItemTo, type NutritionItem } from '../../utils/itemModel';
import { OverflowMenu, type OverflowMenuItem } from '../common/OverflowMenu';
import { UnitChip } from './UnitChip';
import { ItemNutritionModal } from './ItemNutritionModal';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { EditedItemNutrition } from './nutritionEngineHelpers';
import { DEFAULT_MACRO_COLUMNS, getMacroGridTemplateColumns, type MacroColumnKey } from './macroColumns';
import { MacroCell } from './MacroCell';

export interface ComponentRowProps {
  item: NutritionItem;
  /** The item at its reference quantity. Scaling is relative to this, so there is no accumulating drift and no dead end. */
  reference: NutritionItem;
  macroColumns?: MacroColumnKey[];
  onChange?: (next: NutritionItem) => void;
  onReanchor?: (next: NutritionItem) => void;
  onRemove?: () => void;
  onSaveToQuickLog?: () => void;
  onEditNutrition?: (edited: EditedItemNutrition) => void;
  /** Coach read-only inspection: expanding is allowed, every mutating affordance is not. */
  readOnly?: boolean;
}

/**
 * Compact item row for staged meals and meal logs (R3).
 *
 * Layout:
 *   Left  (flex-1 min-w-0): name (line 1, up to 2 lines) stacked above non-zero macros
 *         (line 2, kcal first in amber, then non-zero P/C/F/Fib in macro colors).
 *   Right (shrink-0): bordered [qty input][UnitChip] field, followed by the OverflowMenu (⋯).
 *
 * Maintains touch target sizes >= 40x40 px and typography >= 12 px (text-xs).
 */
export const ComponentRow: React.FC<ComponentRowProps> = ({
  item,
  reference,
  macroColumns,
  onChange,
  onReanchor,
  onRemove,
  onSaveToQuickLog,
  onEditNutrition,
  readOnly = false,
}) => {
  const isOnline = useOnlineStatus();
  const columns = macroColumns ?? DEFAULT_MACRO_COLUMNS;
  // The input is free text so an in-progress value like "" or "12." is not
  // clobbered by the controlled numeric round trip.
  const [draft, setDraft] = useState<string | null>(null);
  const [pendingUnit, setPendingUnit] = useState<CanonicalUnit | null>(null);
  const [pendingAbsurdEdit, setPendingAbsurdEdit] = useState<NutritionItem | null>(null);
  const [localAnchor, setLocalAnchor] = useState<NutritionItem | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const shown = draft ?? (pendingUnit !== null ? '' : String(roundTo1Decimal(item.quantity)));
  const activeUnit = pendingUnit ?? item.unit;

  const editable = !readOnly && Boolean(onChange);

  const effectiveRef =
    reference.unit === item.unit
      ? reference
      : localAnchor?.unit === item.unit
        ? localAnchor
        : reference;

  const handleUnitChange = (nextUnit: CanonicalUnit) => {
    if (!editable) return;
    const currentActiveUnit = pendingUnit ?? item.unit;
    if (nextUnit === currentActiveUnit) {
      // Re-selecting already-active unit is a no-op
      return;
    }
    if (nextUnit === item.unit) {
      // Re-selecting the row's base unit cancels pending re-anchor
      setPendingUnit(null);
      setDraft(null);
      return;
    }
    setPendingUnit(nextUnit);
    setDraft('');
  };

  const commit = (raw: string) => {
    const parsed = parseQuantityInput(raw);
    if (parsed === null || parsed <= 0 || !onChange) {
      if (pendingUnit) {
        setDraft('');
      } else {
        setDraft(null);
      }
      return;
    }

    if (pendingUnit) {
      const reanchored = reanchorItemTo(item, roundTo1Decimal(parsed), pendingUnit);
      setLocalAnchor(reanchored);
      setPendingUnit(null);
      setDraft(null);
      if (onReanchor) {
        onReanchor(reanchored);
      } else {
        onChange(reanchored);
      }
      return;
    }

    if (roundTo1Decimal(parsed) === roundTo1Decimal(item.quantity)) {
      setDraft(null);
      setPendingAbsurdEdit(null);
      return;
    }

    const scaled = scaleItemToQuantity(effectiveRef, roundTo1Decimal(parsed));
    const nextItem: NutritionItem = {
      ...scaled,
      quantity: roundTo1Decimal(scaled.quantity),
      calories: roundTo1Decimal(scaled.calories),
      protein: roundTo1Decimal(scaled.protein),
      carbs: roundTo1Decimal(scaled.carbs),
      fat: roundTo1Decimal(scaled.fat),
      fiber: roundTo1Decimal(scaled.fiber),
      unit: item.unit,
    };

    if (item.calories > 0 && nextItem.calories > item.calories * 20) {
      setPendingAbsurdEdit(nextItem);
      return;
    }

    onChange(nextItem);
    setDraft(null);
    setPendingAbsurdEdit(null);
  };


  const menuItems: OverflowMenuItem[] = [];
  if (onEditNutrition) {
    menuItems.push({
      label: 'Edit nutrition',
      onSelect: () => setIsEditModalOpen(true),
      testId: 'component-edit-nutrition',
    });
  }
  if (onSaveToQuickLog) {
    menuItems.push({
      label: !isOnline ? 'Save to quick log (Available when online)' : 'Save to quick log',
      onSelect: () => {
        if (!isOnline) return;
        onSaveToQuickLog();
      },
      testId: 'component-save-quick-log',
    });
  }
  if (onRemove) {
    menuItems.push({ label: 'Remove', onSelect: onRemove, tone: 'danger', testId: 'component-remove' });
  }

  const accessibleParts: string[] = [`${formatCalories(item.calories)} kcal`];
  if (columns.includes('protein') && roundTo1Decimal(item.protein) > 0) {
    accessibleParts.push(`protein ${formatMacro(item.protein)} g`);
  }
  if (columns.includes('carbs') && roundTo1Decimal(item.carbs) > 0) {
    accessibleParts.push(`carbs ${formatMacro(item.carbs)} g`);
  }
  if (columns.includes('fat') && roundTo1Decimal(item.fat) > 0) {
    accessibleParts.push(`fat ${formatMacro(item.fat)} g`);
  }
  if (columns.includes('fiber') && roundTo1Decimal(item.fiber) > 0) {
    accessibleParts.push(`fiber ${formatMacro(item.fiber)} g`);
  }
  const accessibleRowText = `${item.name}: ${accessibleParts.join(', ')}`;

  return (
    <div
      data-testid="component-row"
      className="py-0.5 border-b border-zinc-800/80 last:border-b-0 min-h-[44px] flex flex-col justify-center gap-1"
    >
      {/* LINE 1: Name (left, flex-1, may wrap) + [qty][unit] field and ⋯ (right) */}
      <div className="flex items-center justify-between gap-1.5 sm:gap-2">
        <div
          data-testid="component-name"
          title={item.name}
          className="flex-1 min-w-0 text-sm font-semibold text-white leading-tight break-words line-clamp-2"
        >
          {item.name}
        </div>

        {/* RIGHT (shrink-0): [field: input + UnitChip] + ⋯ OverflowMenu */}
        <div data-testid="component-right-cluster" className="shrink-0 flex items-center gap-1">
          {editable ? (
            <div
              data-testid="component-quantity-box"
              className="relative w-[100px] h-8 rounded-lg border border-border-interactive bg-zinc-950 flex items-center transition hover:border-cyan-500/70 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-400"
            >
              <label
                htmlFor={`component-quantity-input-${item.id}`}
                data-testid="component-quantity-field"
                className="relative w-[46px] min-h-[44px] h-11 -my-1.5 shrink-0 flex items-center cursor-text touch-manipulation"
              >
                <input
                  id={`component-quantity-input-${item.id}`}
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  enterKeyHint="done"
                  data-testid="component-quantity-input"
                  aria-label={`Quantity of ${item.name}`}
                  value={shown}
                  placeholder={pendingUnit ? `amount in ${pendingUnit} for this ${formatCalories(item.calories)} kcal` : undefined}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={(e) => commit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commit((e.target as HTMLInputElement).value);
                    }
                  }}
                  className="h-8 w-[46px] shrink-0 bg-transparent text-right pr-1 pl-1 text-base font-semibold tabular-nums text-white outline-none border-0 m-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </label>
              <UnitChip
                value={activeUnit}
                onChange={handleUnitChange}
                testId="component-unit-chip"
                ariaLabel={`Change unit for ${item.name}, currently ${shortUnitLabel(activeUnit)}`}
                embedded
              />
            </div>
          ) : (
            <span className="text-xs tabular-nums font-normal text-zinc-400 px-1">
              {roundTo1Decimal(item.quantity)}{shortUnitLabel(item.unit)}
            </span>
          )}

          {!readOnly && menuItems.length > 0 && (
            <div className="-my-1.5 [&>div>button]:!min-h-[44px] [&>div>button]:!h-11 [&>div>button]:!min-w-[44px] [&>div>button]:!w-11 [&>div>button]:!p-0 flex items-center justify-center">
              <OverflowMenu
                ariaLabel={`Actions for ${item.name}`}
                items={menuItems}
                testId="component-actions"
              />
            </div>
          )}
        </div>
      </div>

      {/* LINE 2: Fixed-column-width macro grid */}
      <div className="w-full">
        <span className="sr-only">{accessibleRowText}</span>
        <div
          data-testid="component-macros"
          aria-hidden="true"
          className="grid text-xs tabular-nums text-zinc-400 leading-tight"
          style={{ gridTemplateColumns: getMacroGridTemplateColumns(columns) }}
        >
          {columns.map((colKey) => (
            <MacroCell
              key={colKey}
              colKey={colKey}
              value={item[colKey]}
              variant="component"
            />
          ))}
        </div>
      </div>

      {pendingUnit && (
        <div data-testid="component-reanchor-hint" className="mt-1 text-xs text-zinc-400">
          amount in {pendingUnit} for this {formatCalories(item.calories)} kcal
        </div>
      )}

      {/* Inline confirmation for absurd edits (>20x calories) */}
      {pendingAbsurdEdit && (
        <div
          data-testid="absurd-edit-confirm"
          className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-950/40 p-2 text-xs space-y-1.5"
        >
          <div className="text-amber-200">
            This edit increases calories by more than 20x ({formatCalories(item.calories)} → {formatCalories(pendingAbsurdEdit.calories)} kcal).
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="confirm-apply-edit"
              onClick={() => {
                onChange?.(pendingAbsurdEdit);
                setPendingAbsurdEdit(null);
                setDraft(null);
              }}
              className="rounded bg-amber-500 px-2 py-1 font-bold text-zinc-950 hover:bg-amber-400 min-h-[40px] touch-manipulation relative before:absolute before:inset-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] before:content-['']"
            >
              Apply anyway
            </button>
            <button
              type="button"
              data-testid="cancel-apply-edit"
              onClick={() => {
                setPendingAbsurdEdit(null);
                setDraft(null);
              }}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700 min-h-[40px] touch-manipulation relative before:absolute before:inset-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] before:content-['']"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {onEditNutrition && (
        <ItemNutritionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          item={item}
          onSave={onEditNutrition}
        />
      )}
    </div>
  );
};
