import { useState, type FormEvent } from 'react';
import { roundTo1Decimal } from '../../utils/nutrition';

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

export interface UseManualMealFormOptions {
  onStageMeal: (meal: ManualMealStagedData) => void;
}

export function useManualMealForm({ onStageMeal }: UseManualMealFormOptions) {
  // Manual Form Fallback State
  const [manualDishName, setManualDishName] = useState('');
  const [manualCalories, setManualCalories] = useState<number | ''>('');
  const [manualProtein, setManualProtein] = useState<number | ''>('');
  const [manualCarbs, setManualCarbs] = useState<number | ''>('');
  const [manualFat, setManualFat] = useState<number | ''>('');
  const [manualFiber, setManualFiber] = useState<number | ''>('');
  const [manualMealType, setManualMealType] = useState<string>('Breakfast');
  const [manualServingSize, setManualServingSize] = useState<number | ''>(1);
  const [manualServingUnit, setManualServingUnit] = useState<string>('serving');

  const resetManualForm = () => {
    setManualDishName('');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    setManualFiber('');
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
    handleManualSubmit,
  };
}

export type UseManualMealFormReturn = ReturnType<typeof useManualMealForm>;
