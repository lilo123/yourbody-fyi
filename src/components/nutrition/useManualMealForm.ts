import { useState, type FormEvent } from 'react';
import { roundTo1Decimal } from '../../utils/nutrition';
import { inferMealType } from './inferMealType';

export interface ManualMealStagedData {
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  meal_type: string;
  serving_size: number;
  serving_unit: string;
}

export interface ManualMealPrefill {
  name?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  servingSize?: number;
  servingUnit?: string;
}

export interface UseManualMealFormOptions {
  onStageMeal: (meal: ManualMealStagedData) => void;
  now?: Date;
  initialMealType?: string;
}

export function useManualMealForm({
  onStageMeal,
  now,
  initialMealType,
}: UseManualMealFormOptions) {
  // Manual Form Fallback State
  const [manualDishName, setManualDishName] = useState('');
  const [manualCalories, setManualCalories] = useState<number | ''>('');
  const [manualProtein, setManualProtein] = useState<number | ''>('');
  const [manualCarbs, setManualCarbs] = useState<number | ''>('');
  const [manualFat, setManualFat] = useState<number | ''>('');
  const [manualFiber, setManualFiber] = useState<number | ''>('');
  const [manualMealType, setManualMealType] = useState<string>(() =>
    initialMealType ?? inferMealType(undefined, now)
  );
  const [manualServingSize, setManualServingSize] = useState<number | ''>(1);
  const [manualServingUnit, setManualServingUnit] = useState<string>('serving');

  const resetManualForm = () => {
    setManualDishName('');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    setManualFiber('');
    setManualMealType(initialMealType ?? inferMealType(undefined, now));
  };

  const prefillForm = (prefill: ManualMealPrefill) => {
    if (prefill.name !== undefined) {
      setManualDishName(prefill.name);
    }
    setManualCalories(prefill.calories !== undefined ? prefill.calories : '');
    setManualProtein(prefill.protein !== undefined ? prefill.protein : '');
    setManualCarbs(prefill.carbs !== undefined ? prefill.carbs : '');
    setManualFat(prefill.fat !== undefined ? prefill.fat : '');
    setManualFiber(prefill.fiber !== undefined ? prefill.fiber : '');
    if (prefill.servingSize !== undefined) {
      setManualServingSize(prefill.servingSize);
    }
    if (prefill.servingUnit !== undefined) {
      setManualServingUnit(prefill.servingUnit);
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualDishName.trim()) return;
    if (manualCalories === '' || Number(manualCalories) < 0) return;
    if (manualProtein !== '' && Number(manualProtein) < 0) return;
    if (manualCarbs !== '' && Number(manualCarbs) < 0) return;
    if (manualFat !== '' && Number(manualFat) < 0) return;
    if (manualFiber !== '' && Number(manualFiber) < 0) return;
    if (manualServingSize !== '' && Number(manualServingSize) < 0) return;

    const data: ManualMealStagedData = {
      food_name: manualDishName.trim(),
      calories: roundTo1Decimal(manualCalories),
      protein: manualProtein === '' ? 0 : roundTo1Decimal(manualProtein),
      carbs: manualCarbs === '' ? 0 : roundTo1Decimal(manualCarbs),
      fat: manualFat === '' ? 0 : roundTo1Decimal(manualFat),
      fiber: manualFiber === '' ? 0 : roundTo1Decimal(manualFiber),
      meal_type: manualMealType,
      serving_size: Number(manualServingSize) || 1,
      serving_unit: manualServingUnit,
    };

    onStageMeal(data);
  };

  return {
    manualDishName,
    setManualDishName,
    manualCalories,
    setManualCalories,
    manualProtein,
    setManualProtein,
    manualCarbs,
    setManualCarbs,
    manualFat,
    setManualFat,
    manualFiber,
    setManualFiber,
    manualMealType,
    setManualMealType,
    manualServingSize,
    setManualServingSize,
    manualServingUnit,
    setManualServingUnit,
    resetManualForm,
    prefillForm,
    handleManualSubmit,
  };
}

export type UseManualMealFormReturn = ReturnType<typeof useManualMealForm>;
