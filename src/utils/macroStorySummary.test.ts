import { describe, it, expect } from 'vitest';
import { buildMacroStoryData } from './macroStorySummary';
import type { NutritionLog } from '../types/database';

describe('macroStorySummary builder', () => {
  const sampleLog = (overrides?: Partial<NutritionLog>): NutritionLog => ({
    id: 'log-1',
    user_id: 'user-1',
    food_name: 'Grilled Salmon Bowl',
    calories: 650,
    protein: 45,
    carbs: 55,
    fat: 22,
    fiber: 8,
    logged_at: '2026-10-12T12:00:00Z',
    ...overrides,
  });

  it('computes goals, percentages, and isOver when targets are provided via calories property', () => {
    const summary = buildMacroStoryData({
      date: '2026-10-12',
      totals: {
        calories: 2200,
        protein: 160,
        carbs: 220,
        fat: 70,
        fiber: 30,
      },
      targets: {
        calories: 2000,
        protein: 150,
        carbs: 250,
        fat: 65,
        fiber: 35,
      },
      meals: [sampleLog()],
    });

    expect(summary.title).toBe('Daily Nutrition');
    expect(summary.dateFormatted).toBe('Oct 12');
    expect(summary.hasTargets).toBe(true);

    // Calories: 2200 / 2000 => 110%, isOver = true
    expect(summary.calories.current).toBe(2200);
    expect(summary.calories.currentFormatted).toBe('2200 kcal');
    expect(summary.calories.target).toBe(2000);
    expect(summary.calories.targetFormatted).toBe('2000 kcal');
    expect(summary.calories.percentage).toBe(110);
    expect(summary.calories.isOver).toBe(true);

    // Protein: 160 / 150 => 107%, isOver = true
    expect(summary.protein.current).toBe(160);
    expect(summary.protein.currentFormatted).toBe('160g');
    expect(summary.protein.target).toBe(150);
    expect(summary.protein.targetFormatted).toBe('150g');
    expect(summary.protein.percentage).toBe(107);
    expect(summary.protein.isOver).toBe(true);

    // Carbs: 220 / 250 => 88%, isOver = false
    expect(summary.carbs.current).toBe(220);
    expect(summary.carbs.currentFormatted).toBe('220g');
    expect(summary.carbs.target).toBe(250);
    expect(summary.carbs.targetFormatted).toBe('250g');
    expect(summary.carbs.percentage).toBe(88);
    expect(summary.carbs.isOver).toBe(false);

    // Fat: 70 / 65 => 108%, isOver = true
    expect(summary.fat.current).toBe(70);
    expect(summary.fat.percentage).toBe(108);
    expect(summary.fat.isOver).toBe(true);

    // Fiber: 30 / 35 => 86%, isOver = false
    expect(summary.fiber.current).toBe(30);
    expect(summary.fiber.percentage).toBe(86);
    expect(summary.fiber.isOver).toBe(false);
  });

  it('supports UserProfile target property names (target_calories, target_protein, etc.)', () => {
    const summary = buildMacroStoryData({
      date: '2026-10-12',
      totals: {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 55,
        fiber: 25,
      },
      targets: {
        target_calories: 2000,
        target_protein: 150,
        target_carbs: 200,
        target_fat: 60,
        target_fiber: 28,
      },
      meals: [],
    });

    expect(summary.hasTargets).toBe(true);
    expect(summary.calories.target).toBe(2000);
    expect(summary.calories.percentage).toBe(90);
    expect(summary.protein.target).toBe(150);
    expect(summary.carbs.target).toBe(200);
    expect(summary.fat.target).toBe(60);
    expect(summary.fiber.target).toBe(28);
  });

  it('operates in totals-only mode when targets are omitted, null, or zero', () => {
    const summary = buildMacroStoryData({
      date: '2026-10-12',
      totals: {
        calories: 1950,
        protein: 135,
        carbs: 210,
        fat: 60,
        fiber: 22,
      },
      targets: null,
      meals: [sampleLog()],
    });

    expect(summary.hasTargets).toBe(false);
    expect(summary.calories.currentFormatted).toBe('1950 kcal');
    expect(summary.calories.target).toBeNull();
    expect(summary.calories.targetFormatted).toBeNull();
    expect(summary.calories.percentage).toBeNull();
    expect(summary.calories.isOver).toBe(false);

    expect(summary.protein.currentFormatted).toBe('135g');
    expect(summary.protein.target).toBeNull();
    expect(summary.protein.percentage).toBeNull();
  });

  it('caps meals list at 6 and computes overflow count correctly', () => {
    const meals: NutritionLog[] = Array.from({ length: 9 }, (_, index) =>
      sampleLog({
        id: `meal-${index + 1}`,
        food_name: `Meal Item #${index + 1}`,
        calories: 300 + index * 50,
      })
    );

    const summary = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 3500 },
      meals,
    });

    expect(summary.totalMealsCount).toBe(9);
    expect(summary.meals).toHaveLength(6);
    expect(summary.overflowCount).toBe(3);
    expect(summary.meals[0].name).toBe('Meal Item #1');
    expect(summary.meals[5].name).toBe('Meal Item #6');
  });

  it('truncates meal names exceeding 36 characters with an ellipsis', () => {
    const longNameMeal = sampleLog({
      id: 'meal-long',
      food_name: 'Organic Free-Range Herb Roasted Chicken Breast with Quinoa and Asparagus',
      calories: 550,
    });

    const summary = buildMacroStoryData({
      date: '2026-10-12',
      totals: { calories: 550 },
      meals: [longNameMeal],
    });

    expect(summary.meals).toHaveLength(1);
    expect(summary.meals[0].name.length).toBeLessThanOrEqual(36);
    expect(summary.meals[0].name.endsWith('…')).toBe(true);
  });

  it('handles empty day gracefully without errors', () => {
    const summary = buildMacroStoryData({
      date: '',
      totals: null,
      targets: null,
      meals: null,
    });

    expect(summary.title).toBe('Daily Nutrition');
    expect(summary.dateFormatted).toBe('');
    expect(summary.hasTargets).toBe(false);
    expect(summary.calories.current).toBe(0);
    expect(summary.calories.currentFormatted).toBe('0 kcal');
    expect(summary.meals).toEqual([]);
    expect(summary.overflowCount).toBe(0);
    expect(summary.totalMealsCount).toBe(0);
  });
});
