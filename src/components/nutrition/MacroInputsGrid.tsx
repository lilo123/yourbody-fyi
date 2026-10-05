import React, { memo } from 'react';
import { KcalMacroHint } from './KcalMacroHint';

export interface MacroValues {
  calories: number | '';
  protein: number | '';
  carbs: number | '';
  fat: number | '';
  fiber: number | '';
}

export interface MacroChangeHandlers {
  onCaloriesChange: (val: number | '') => void;
  onProteinChange: (val: number | '') => void;
  onCarbsChange: (val: number | '') => void;
  onFatChange: (val: number | '') => void;
  onFiberChange: (val: number | '') => void;
}

export interface MacroErrors {
  calories?: string;
  protein?: string;
  carbs?: string;
  fat?: string;
  fiber?: string;
}

export interface MacroInputIds {
  caloriesId: string;
  proteinId: string;
  carbsId: string;
  fatId: string;
  fiberId: string;
}

export interface MacroInputsGridProps {
  values: MacroValues;
  onChange: MacroChangeHandlers;
  errors?: MacroErrors;
  ids: MacroInputIds;
  testIdPrefix?: string;
  inputClassName?: string;
  fiberEnterKeyHint?: 'next' | 'done';
  hintSlot?: React.ReactNode;
}

export const MacroInputsGrid: React.FC<MacroInputsGridProps> = memo(({
  values,
  onChange,
  errors,
  ids,
  testIdPrefix = '',
  inputClassName,
  fiberEnterKeyHint = 'next',
  hintSlot,
}) => {
  const getInputClass = (fieldError?: string) => {
    const base =
      inputClassName ||
      'w-full bg-zinc-900 border text-white rounded-xl p-2 text-base tabular-nums font-bold outline-none text-center transition min-h-[40px]';
    return `${base} ${
      fieldError
        ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/50'
        : 'border-border-interactive focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50'
    }`;
  };

  return (
    <div>
      <div className="grid grid-cols-6 sm:grid-cols-5 gap-2">
      <div className="col-span-2 sm:col-span-1">
        <label
          htmlFor={ids.caloriesId}
          className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-1"
        >
          Calories <span className="text-amber-400 font-bold">*</span>
        </label>
        <input
          id={ids.caloriesId}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          enterKeyHint="next"
          data-testid={`${testIdPrefix}calories-input`}
          value={values.calories}
          onChange={(e) => onChange.onCaloriesChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="0"
          aria-invalid={Boolean(errors?.calories)}
          aria-errormessage={errors?.calories ? `${ids.caloriesId}-error` : undefined}
          className={getInputClass(errors?.calories)}
          required
        />
        {errors?.calories && (
          <p
            id={`${ids.caloriesId}-error`}
            role="alert"
            data-testid={`${testIdPrefix}calories-error`}
            className="text-xs text-rose-400 mt-1"
          >
            {errors.calories}
          </p>
        )}
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label
          htmlFor={ids.proteinId}
          className="block text-xs font-bold text-cyan-400 uppercase tracking-wider mb-1"
        >
          Protein (g)
        </label>
        <input
          id={ids.proteinId}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          enterKeyHint="next"
          data-testid={`${testIdPrefix}protein-input`}
          value={values.protein}
          onChange={(e) => onChange.onProteinChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="0"
          aria-invalid={Boolean(errors?.protein)}
          aria-errormessage={errors?.protein ? `${ids.proteinId}-error` : undefined}
          className={getInputClass(errors?.protein)}
        />
        {errors?.protein && (
          <p
            id={`${ids.proteinId}-error`}
            role="alert"
            data-testid={`${testIdPrefix}protein-error`}
            className="text-xs text-rose-400 mt-1"
          >
            {errors.protein}
          </p>
        )}
      </div>

      <div className="col-span-2 sm:col-span-1">
        <label
          htmlFor={ids.carbsId}
          className="block text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1"
        >
          Carbs (g)
        </label>
        <input
          id={ids.carbsId}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          enterKeyHint="next"
          data-testid={`${testIdPrefix}carbs-input`}
          value={values.carbs}
          onChange={(e) => onChange.onCarbsChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="0"
          aria-invalid={Boolean(errors?.carbs)}
          aria-errormessage={errors?.carbs ? `${ids.carbsId}-error` : undefined}
          className={getInputClass(errors?.carbs)}
        />
        {errors?.carbs && (
          <p
            id={`${ids.carbsId}-error`}
            role="alert"
            data-testid={`${testIdPrefix}carbs-error`}
            className="text-xs text-rose-400 mt-1"
          >
            {errors.carbs}
          </p>
        )}
      </div>

      <div className="col-span-3 sm:col-span-1">
        <label
          htmlFor={ids.fatId}
          className="block text-xs font-bold text-violet-400 uppercase tracking-wider mb-1"
        >
          Fat (g)
        </label>
        <input
          id={ids.fatId}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          enterKeyHint="next"
          data-testid={`${testIdPrefix}fat-input`}
          value={values.fat}
          onChange={(e) => onChange.onFatChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="0"
          aria-invalid={Boolean(errors?.fat)}
          aria-errormessage={errors?.fat ? `${ids.fatId}-error` : undefined}
          className={getInputClass(errors?.fat)}
        />
        {errors?.fat && (
          <p
            id={`${ids.fatId}-error`}
            role="alert"
            data-testid={`${testIdPrefix}fat-error`}
            className="text-xs text-rose-400 mt-1"
          >
            {errors.fat}
          </p>
        )}
      </div>

      <div className="col-span-3 sm:col-span-1">
        <label
          htmlFor={ids.fiberId}
          className="block text-xs font-bold text-teal-400 uppercase tracking-wider mb-1"
        >
          Fiber (g)
        </label>
        <input
          id={ids.fiberId}
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          enterKeyHint={fiberEnterKeyHint}
          data-testid={`${testIdPrefix}fiber-input`}
          value={values.fiber}
          onChange={(e) => onChange.onFiberChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="0"
          aria-invalid={Boolean(errors?.fiber)}
          aria-errormessage={errors?.fiber ? `${ids.fiberId}-error` : undefined}
          className={getInputClass(errors?.fiber)}
        />
        {errors?.fiber && (
          <p
            id={`${ids.fiberId}-error`}
            role="alert"
            data-testid={`${testIdPrefix}fiber-error`}
            className="text-xs text-rose-400 mt-1"
          >
            {errors.fiber}
          </p>
        )}
      </div>

      </div>

      {hintSlot !== undefined ? (
        hintSlot && (
          <div data-testid="macro-hint-slot">
            {hintSlot}
          </div>
        )
      ) : (
        <div data-testid="macro-hint-slot">
          <KcalMacroHint
            calories={values.calories}
            protein={values.protein}
            carbs={values.carbs}
            fat={values.fat}
            fiber={values.fiber}
            testId="macro-mismatch-hint"
          />
        </div>
      )}
    </div>
  );
});

MacroInputsGrid.displayName = 'MacroInputsGrid';
