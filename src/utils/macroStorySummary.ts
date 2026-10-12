import type { NutritionLog } from '../types/database';
import { formatCalories, formatMacro } from './nutrition';
import { formatShortDate } from './date';
import { truncateText } from './workoutStorySummary';

export interface NutrientGoal {
  current: number;
  currentFormatted: string;
  target: number | null;
  targetFormatted: string | null;
  percentage: number | null;
  isOver: boolean;
}

export interface MacroStoryMeal {
  id: string;
  name: string;
  calories: number;
  caloriesFormatted: string;
}

export interface MacroStoryData {
  title: string;
  dateFormatted: string;
  calories: NutrientGoal;
  protein: NutrientGoal;
  carbs: NutrientGoal;
  fat: NutrientGoal;
  fiber: NutrientGoal;
  hasTargets: boolean;
  meals: MacroStoryMeal[];
  overflowCount: number;
  totalMealsCount: number;
}

export interface MacroTargets {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  target_calories?: number | null;
  target_protein?: number | null;
  target_carbs?: number | null;
  target_fat?: number | null;
  target_fiber?: number | null;
}

export interface BuildMacroStoryOptions {
  date: string;
  totals?: {
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
    fiber?: number | null;
  } | null;
  targets?: MacroTargets | null;
  meals?: NutritionLog[] | null;
}

function sanitizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isNaN(value)) {
    return Math.max(0, value);
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && !Number.isNaN(parsed)) {
    return Math.max(0, parsed);
  }
  return 0;
}

function buildNutrientGoal(
  currentRaw: unknown,
  targetRaw: unknown,
  unit: 'kcal' | 'g'
): NutrientGoal {
  const current = sanitizeNumber(currentRaw);
  const targetNum = targetRaw != null ? sanitizeNumber(targetRaw) : null;
  const hasTarget = targetNum !== null && targetNum > 0;

  const currentFormatted =
    unit === 'kcal' ? `${formatCalories(current)} kcal` : `${formatMacro(current)}g`;

  const targetFormatted = hasTarget
    ? unit === 'kcal'
      ? `${formatCalories(targetNum)} kcal`
      : `${formatMacro(targetNum)}g`
    : null;

  const percentage = hasTarget ? Math.round((current / targetNum) * 100) : null;
  const isOver = hasTarget ? current > targetNum : false;

  return {
    current,
    currentFormatted,
    target: hasTarget ? targetNum : null,
    targetFormatted,
    percentage,
    isOver,
  };
}

/**
 * Pure builder function that computes nutrition totals, target percentages,
 * caps meals at 6, and produces structured data for macro story canvas rendering.
 */
export function buildMacroStoryData(options: BuildMacroStoryOptions): MacroStoryData {
  const dateFormatted = options.date ? formatShortDate(options.date) : '';
  const title = 'Daily Nutrition';

  const totals = options.totals || {};
  const targets = options.targets || {};

  const calTarget = targets.calories ?? targets.target_calories;
  const proTarget = targets.protein ?? targets.target_protein;
  const carbTarget = targets.carbs ?? targets.target_carbs;
  const fatTarget = targets.fat ?? targets.target_fat;
  const fibTarget = targets.fiber ?? targets.target_fiber;

  const calories = buildNutrientGoal(totals.calories, calTarget, 'kcal');
  const protein = buildNutrientGoal(totals.protein, proTarget, 'g');
  const carbs = buildNutrientGoal(totals.carbs, carbTarget, 'g');
  const fat = buildNutrientGoal(totals.fat, fatTarget, 'g');
  const fiber = buildNutrientGoal(totals.fiber, fibTarget, 'g');

  const hasTargets = Boolean(
    calories.target !== null ||
    protein.target !== null ||
    carbs.target !== null ||
    fat.target !== null ||
    fiber.target !== null
  );

  const rawMeals = options.meals ? [...options.meals] : [];
  const allMeals: MacroStoryMeal[] = rawMeals.map((meal, index) => {
    const rawName = meal.food_name?.trim() || `Meal #${index + 1}`;
    const name = truncateText(rawName, 36);
    const kcal = sanitizeNumber(meal.calories);
    return {
      id: meal.id || `meal-${index}`,
      name,
      calories: kcal,
      caloriesFormatted: `${formatCalories(kcal)} kcal`,
    };
  });

  const meals = allMeals.slice(0, 6);
  const overflowCount = Math.max(0, allMeals.length - 6);

  return {
    title,
    dateFormatted,
    calories,
    protein,
    carbs,
    fat,
    fiber,
    hasTargets,
    meals,
    overflowCount,
    totalMealsCount: allMeals.length,
  };
}
