import React, { useState } from 'react';
import { X } from 'lucide-react';
import { AccessibleModal } from '../common/AccessibleModal';
import { KcalMacroHint } from './KcalMacroHint';
import { roundTo1Decimal } from '../../utils/nutrition';
import { shortUnitLabel } from '../../utils/unitConverter';
import type { NutritionItem } from '../../utils/itemModel';
import type { EditedItemNutrition } from './nutritionEngineHelpers';

export interface ItemNutritionModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: NutritionItem;
  onSave: (edited: EditedItemNutrition) => void;
}

interface FieldDefinition {
  key: keyof EditedItemNutrition;
  id: string;
  label: string;
  unit: string;
  tone: string;
  testId: string;
  errorTestId: string;
}

const FIELDS: readonly FieldDefinition[] = [
  {
    key: 'calories',
    id: 'edit-cal',
    label: 'Calories',
    unit: 'kcal',
    tone: 'text-amber-400',
    testId: 'edit-item-calories-input',
    errorTestId: 'edit-item-calories-error',
  },
  {
    key: 'protein',
    id: 'edit-p',
    label: 'Protein',
    unit: 'g',
    tone: 'text-cyan-400',
    testId: 'edit-item-protein-input',
    errorTestId: 'edit-item-protein-error',
  },
  {
    key: 'carbs',
    id: 'edit-c',
    label: 'Carbs',
    unit: 'g',
    tone: 'text-emerald-400',
    testId: 'edit-item-carbs-input',
    errorTestId: 'edit-item-carbs-error',
  },
  {
    key: 'fat',
    id: 'edit-f',
    label: 'Fat',
    unit: 'g',
    tone: 'text-violet-400',
    testId: 'edit-item-fat-input',
    errorTestId: 'edit-item-fat-error',
  },
  {
    key: 'fiber',
    id: 'edit-fib',
    label: 'Fiber',
    unit: 'g',
    tone: 'text-teal-400',
    testId: 'edit-item-fiber-input',
    errorTestId: 'edit-item-fiber-error',
  },
] as const;

function validateFieldValue(val: string): { parsed: number; error: string | null } {
  const trimmed = val.trim();
  if (trimmed === '') {
    return { parsed: 0, error: null };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || isNaN(n)) {
    return { parsed: 0, error: 'Must be a valid number' };
  }
  if (n < 0) {
    return { parsed: 0, error: 'Cannot be negative' };
  }
  return { parsed: roundTo1Decimal(n), error: null };
}

interface ItemNutritionFormProps {
  item: NutritionItem;
  onClose: () => void;
  onSave: (edited: EditedItemNutrition) => void;
}

const ItemNutritionForm: React.FC<ItemNutritionFormProps> = ({ item, onClose, onSave }) => {
  const initialValues: Record<keyof EditedItemNutrition, string> = {
    calories: String(roundTo1Decimal(item.calories)),
    protein: String(roundTo1Decimal(item.protein)),
    carbs: String(roundTo1Decimal(item.carbs)),
    fat: String(roundTo1Decimal(item.fat)),
    fiber: String(roundTo1Decimal(item.fiber)),
  };

  const [formState, setFormState] = useState<Record<keyof EditedItemNutrition, string>>(initialValues);

  const validationResults = {
    calories: validateFieldValue(formState.calories),
    protein: validateFieldValue(formState.protein),
    carbs: validateFieldValue(formState.carbs),
    fat: validateFieldValue(formState.fat),
    fiber: validateFieldValue(formState.fiber),
  };

  const hasErrors = Object.values(validationResults).some((r) => r.error !== null);

  const hasChanged =
    validationResults.calories.parsed !== roundTo1Decimal(item.calories) ||
    validationResults.protein.parsed !== roundTo1Decimal(item.protein) ||
    validationResults.carbs.parsed !== roundTo1Decimal(item.carbs) ||
    validationResults.fat.parsed !== roundTo1Decimal(item.fat) ||
    validationResults.fiber.parsed !== roundTo1Decimal(item.fiber);

  const isSaveDisabled = hasErrors || !hasChanged;

  const handleChange = (key: keyof EditedItemNutrition, val: string) => {
    setFormState((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaveDisabled) return;

    onSave({
      calories: validationResults.calories.parsed,
      protein: validationResults.protein.parsed,
      carbs: validationResults.carbs.parsed,
      fat: validationResults.fat.parsed,
      fiber: validationResults.fiber.parsed,
    });
    onClose();
  };

  return (
    <AccessibleModal
      isOpen
      onClose={onClose}
      titleId="edit-item-nutrition-title"
      overlayTestId="edit-item-nutrition-modal-overlay"
      dialogTestId="edit-item-nutrition-modal"
      className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] max-w-md w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      overlayClassName="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-zinc-800 pb-3">
        <div className="min-w-0 flex-1">
          <h3 id="edit-item-nutrition-title" className="text-sm font-bold text-white truncate">
            Edit nutrition · {item.name}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5" data-testid="edit-item-nutrition-subtitle">
            for {roundTo1Decimal(item.quantity)} {shortUnitLabel(item.unit)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="close-edit-item-nutrition-btn"
          className="text-zinc-400 hover:text-white min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition touch-manipulation shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Helper text */}
      <p className="text-xs text-zinc-400 leading-relaxed" data-testid="edit-item-nutrition-helper">
        Totals update automatically. Later portion changes scale from these values.
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {FIELDS.map((field, index) => {
            const result = validationResults[field.key];
            const hasFieldError = result.error !== null;
            const errorId = `${field.id}-error`;

            return (
              <div
                key={field.key}
                className={field.key === 'calories' ? 'col-span-2 sm:col-span-1' : 'col-span-1'}
              >
                <label
                  htmlFor={field.id}
                  className={`block text-xs font-semibold ${field.tone} uppercase tracking-wider mb-1 whitespace-nowrap`}
                >
                  {field.label}
                  <span className="sr-only"> ({field.unit})</span>
                </label>
                <input
                  id={field.id}
                  type="text"
                  inputMode="decimal"
                  enterKeyHint={index === FIELDS.length - 1 ? 'done' : 'next'}
                  data-testid={field.testId}
                  value={formState[field.key]}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  aria-invalid={hasFieldError}
                  aria-errormessage={hasFieldError ? errorId : undefined}
                  className={`w-full bg-zinc-950 border rounded-xl p-2 text-center text-base tabular-nums font-bold text-white outline-none min-h-[44px] transition ${
                    hasFieldError
                      ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/50'
                      : 'border-border-interactive focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50'
                  }`}
                />
                <p aria-hidden="true" className="text-xs text-zinc-400 text-left mt-1 lowercase">
                  {field.unit}
                </p>
                {hasFieldError && (
                  <p
                    id={errorId}
                    role="alert"
                    data-testid={field.errorTestId}
                    className="text-xs text-rose-400 mt-1"
                  >
                    {result.error}
                  </p>
                )}
              </div>
            );
          })}
          </div>

          <KcalMacroHint
            kcal={formState.calories}
            protein={formState.protein}
            carbs={formState.carbs}
            fat={formState.fat}
            fiber={formState.fiber}
            testId="macro-mismatch-hint"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={onClose}
            data-testid="cancel-edit-item-nutrition-btn"
            className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition touch-manipulation"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaveDisabled}
            aria-disabled={isSaveDisabled}
            data-testid="save-edit-item-nutrition-btn"
            className="px-5 py-2 min-h-[40px] rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-black shadow-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed transition touch-manipulation"
          >
            Save
          </button>
        </div>
      </form>
    </AccessibleModal>
  );
};

export const ItemNutritionModal: React.FC<ItemNutritionModalProps> = ({
  isOpen,
  onClose,
  item,
  onSave,
}) => {
  if (!isOpen || !item) return null;

  return (
    <ItemNutritionForm
      key={`${item.id}-${item.quantity}-${item.unit}`}
      item={item}
      onClose={onClose}
      onSave={onSave}
    />
  );
};
