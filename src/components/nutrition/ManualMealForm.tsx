import React, { memo, useId, useState } from 'react';
import { X } from 'lucide-react';
import type { CompressedImage } from '../../utils/imageCompression';
import { MacroInputsGrid } from './MacroInputsGrid';

export interface ManualMealFormProps {
  show: boolean;
  onClose: () => void;
  selectedPhoto: CompressedImage | null;
  onRemovePhoto: () => void;
  manualName: string;
  onManualNameChange: (val: string) => void;
  manualMealType: string;
  onManualMealTypeChange: (val: string) => void;
  manualCalories: number | '';
  onManualCaloriesChange: (val: number | '') => void;
  manualProtein: number | '';
  onManualProteinChange: (val: number | '') => void;
  manualCarbs: number | '';
  onManualCarbsChange: (val: number | '') => void;
  manualFat: number | '';
  onManualFatChange: (val: number | '') => void;
  manualFiber: number | '';
  onManualFiberChange: (val: number | '') => void;
  manualServingSize: number | '';
  onManualServingSizeChange: (val: number | '') => void;
  manualServingUnit: string;
  onManualServingUnitChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}

export const ManualMealForm: React.FC<ManualMealFormProps> = memo(({
  show,
  onClose,
  selectedPhoto,
  onRemovePhoto,
  manualName,
  onManualNameChange,
  manualMealType,
  onManualMealTypeChange,
  manualCalories,
  onManualCaloriesChange,
  manualProtein,
  onManualProteinChange,
  manualCarbs,
  onManualCarbsChange,
  manualFat,
  onManualFatChange,
  manualFiber,
  onManualFiberChange,
  manualServingSize,
  onManualServingSizeChange,
  manualServingUnit,
  onManualServingUnitChange,
  onSubmit,
  isPending,
}) => {
  const baseId = useId();
  const nameId = `${baseId}-dish-name`;
  const mealTypeId = `${baseId}-meal-type`;
  const caloriesId = `${baseId}-calories`;
  const proteinId = `${baseId}-protein`;
  const carbsId = `${baseId}-carbs`;
  const fatId = `${baseId}-fat`;
  const fiberId = `${baseId}-fiber`;
  const servingSizeId = `${baseId}-serving-size`;
  const servingUnitId = `${baseId}-serving-unit`;

  const [prevShow, setPrevShow] = useState(show);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  if (prevShow !== show) {
    setPrevShow(show);
    if (!show) {
      setHasAttemptedSubmit(false);
    }
  }

  if (!show) return null;

  const errors: Record<string, string> = {};

  if (hasAttemptedSubmit && !manualName.trim()) {
    errors.name = 'Dish / Meal Name is required';
  }

  if (manualCalories !== '' && Number(manualCalories) < 0) {
    errors.calories = 'Must be 0 or more';
  } else if (hasAttemptedSubmit && manualCalories === '') {
    errors.calories = 'Calories is required';
  }

  if (manualProtein !== '' && Number(manualProtein) < 0) {
    errors.protein = 'Must be 0 or more';
  }

  if (manualCarbs !== '' && Number(manualCarbs) < 0) {
    errors.carbs = 'Must be 0 or more';
  }

  if (manualFat !== '' && Number(manualFat) < 0) {
    errors.fat = 'Must be 0 or more';
  }

  if (manualFiber !== '' && Number(manualFiber) < 0) {
    errors.fiber = 'Must be 0 or more';
  }

  if (manualServingSize !== '' && Number(manualServingSize) < 0) {
    errors.servingSize = 'Must be 0 or more';
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const isNameValid = Boolean(manualName.trim());
    const isCaloriesValid = manualCalories !== '' && Number(manualCalories) >= 0;
    const isProteinValid = manualProtein === '' || Number(manualProtein) >= 0;
    const isCarbsValid = manualCarbs === '' || Number(manualCarbs) >= 0;
    const isFatValid = manualFat === '' || Number(manualFat) >= 0;
    const isFiberValid = manualFiber === '' || Number(manualFiber) >= 0;
    const isServingSizeValid = manualServingSize === '' || Number(manualServingSize) >= 0;

    if (
      !isNameValid ||
      !isCaloriesValid ||
      !isProteinValid ||
      !isCarbsValid ||
      !isFatValid ||
      !isFiberValid ||
      !isServingSizeValid
    ) {
      return;
    }

    onSubmit(e);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="p-4 bg-zinc-950 border border-zinc-800 rounded-2xl space-y-3 animate-in fade-in"
    >
      <div className="flex items-center justify-between border-b border-zinc-850 pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
          Manual Macro Logging
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-white text-xs min-h-[40px] min-w-[40px] px-2 flex items-center justify-center rounded-lg transition touch-manipulation"
        >
          Cancel
        </button>
      </div>

      {selectedPhoto && (
        <div data-testid="pinned-photo-in-manual" className="flex items-center gap-3 p-2.5 bg-zinc-950 border border-zinc-800 rounded-2xl">
          <img
            src={selectedPhoto.dataUrl}
            alt="Pinned meal"
            className="w-12 h-12 rounded-xl object-cover border border-cyan-500/30 shrink-0 shadow-sm"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                Pinned Meal Photo
              </span>
              <button
                type="button"
                data-testid="remove-pinned-photo-button"
                onClick={onRemovePhoto}
                className="text-zinc-400 hover:text-rose-400 text-xs min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition touch-manipulation"
                title="Remove Photo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              Refer to your meal photo while entering macronutrients manually
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={nameId}
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
          >
            Dish / Meal Name <span className="text-amber-400 font-bold">*</span>
          </label>
          <input
            id={nameId}
            type="text"
            data-testid="dish-name-input"
            value={manualName}
            onChange={(e) => onManualNameChange(e.target.value)}
            placeholder="e.g. Scrambled Eggs & Toast"
            aria-invalid={Boolean(errors.name)}
            aria-errormessage={errors.name ? `${nameId}-error` : undefined}
            className={`w-full bg-zinc-950 border text-white rounded-xl p-2.5 text-base font-semibold outline-none scroll-mb-24 transition ${
              errors.name
                ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/50'
                : 'border-border-interactive focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50'
            }`}
            required
          />
          {errors.name && (
            <p
              id={`${nameId}-error`}
              role="alert"
              data-testid="dish-name-error"
              className="text-xs text-rose-400 mt-1"
            >
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={mealTypeId}
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
          >
            Meal Type
          </label>
          <select
            id={mealTypeId}
            value={manualMealType}
            onChange={(e) => onManualMealTypeChange(e.target.value)}
            className="w-full bg-zinc-950 border border-border-interactive text-zinc-300 rounded-xl p-2 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none scroll-mb-24 min-h-[40px]"
          >
            <option value="Breakfast">Breakfast</option>
            <option value="Lunch">Lunch</option>
            <option value="Dinner">Dinner</option>
            <option value="Snack">Snack</option>
            <option value="Pre-Workout">Pre-Workout</option>
            <option value="Post-Workout">Post-Workout</option>
          </select>
        </div>
      </div>

      <MacroInputsGrid
        values={{
          calories: manualCalories,
          protein: manualProtein,
          carbs: manualCarbs,
          fat: manualFat,
          fiber: manualFiber,
        }}
        onChange={{
          onCaloriesChange: onManualCaloriesChange,
          onProteinChange: onManualProteinChange,
          onCarbsChange: onManualCarbsChange,
          onFatChange: onManualFatChange,
          onFiberChange: onManualFiberChange,
        }}
        errors={errors}
        ids={{
          caloriesId,
          proteinId,
          carbsId,
          fatId,
          fiberId,
        }}
        inputClassName="w-full bg-zinc-950 border text-white rounded-xl p-2 text-base tabular-nums font-bold outline-none text-center scroll-mb-24 transition"
        fiberEnterKeyHint="next"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={servingSizeId}
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
          >
            Serving Size
          </label>
          <input
            id={servingSizeId}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            enterKeyHint="next"
            value={manualServingSize}
            onChange={(e) => onManualServingSizeChange(e.target.value === '' ? '' : Number(e.target.value))}
            aria-invalid={Boolean(errors.servingSize)}
            aria-errormessage={errors.servingSize ? `${servingSizeId}-error` : undefined}
            className={`w-full bg-zinc-950 border text-white rounded-xl p-2 text-base tabular-nums font-normal outline-none text-center scroll-mb-24 transition ${
              errors.servingSize
                ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/50'
                : 'border-border-interactive focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50'
            }`}
          />
          {errors.servingSize && (
            <p
              id={`${servingSizeId}-error`}
              role="alert"
              data-testid="serving-size-error"
              className="text-xs text-rose-400 mt-1"
            >
              {errors.servingSize}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor={servingUnitId}
            className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
          >
            Serving Unit
          </label>
          <input
            id={servingUnitId}
            type="text"
            enterKeyHint="done"
            value={manualServingUnit}
            onChange={(e) => onManualServingUnitChange(e.target.value)}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center scroll-mb-24"
          />
        </div>
      </div>

      {/* Spacer to prevent sticky Log/Cancel row from occluding fields when scrolled */}
      <div className="h-16 shrink-0" aria-hidden="true" />

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-10 bg-zinc-950/95 backdrop-blur-md pt-2 pb-1 border-t border-zinc-850 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-zinc-400 hover:text-white px-4 py-3 min-h-[44px] rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 transition active:scale-95 touch-manipulation"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 min-h-[44px] rounded-xl uppercase tracking-wider text-xs shadow-[0_0_15px_rgba(16,185,129,0.3)] active:scale-95 transition disabled:opacity-50"
        >
          {isPending ? 'Logging...' : 'Log Meal'}
        </button>
      </div>
    </form>
  );
});

ManualMealForm.displayName = 'ManualMealForm';
