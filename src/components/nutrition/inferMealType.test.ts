import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  inferMealType,
  isValidMealType,
  canonicalizeMealType,
  CANONICAL_MEAL_TYPES,
} from './inferMealType';

describe('inferMealType unit tests', () => {
  describe('meal word in staged meal name', () => {
    it('infers Dinner from "Dinner" regardless of time of day', () => {
      // 08:00 morning local time
      const morningTime = new Date(2026, 9, 15, 8, 0);
      expect(inferMealType('Dinner', morningTime)).toBe('Dinner');
    });

    it('infers Dinner from lowercase "dinner" and trimmed inputs', () => {
      const morningTime = new Date(2026, 9, 15, 8, 0);
      expect(inferMealType('dinner', morningTime)).toBe('Dinner');
      expect(inferMealType('  dinner  ', morningTime)).toBe('Dinner');
      expect(inferMealType('DINNER', morningTime)).toBe('Dinner');
    });

    it('infers Lunch from " LUNCH " and case variations', () => {
      const eveningTime = new Date(2026, 9, 15, 19, 0);
      expect(inferMealType(' LUNCH ', eveningTime)).toBe('Lunch');
      expect(inferMealType('lunch', eveningTime)).toBe('Lunch');
      expect(inferMealType('Lunch', eveningTime)).toBe('Lunch');
    });

    it('infers Breakfast from case variations', () => {
      const eveningTime = new Date(2026, 9, 15, 19, 0);
      expect(inferMealType('breakfast', eveningTime)).toBe('Breakfast');
      expect(inferMealType('Breakfast', eveningTime)).toBe('Breakfast');
      expect(inferMealType(' BREAKFAST ', eveningTime)).toBe('Breakfast');
    });

    it('infers Snack from case variations', () => {
      const morningTime = new Date(2026, 9, 15, 8, 0);
      expect(inferMealType('snack', morningTime)).toBe('Snack');
      expect(inferMealType('Snack', morningTime)).toBe('Snack');
      expect(inferMealType(' SNACK ', morningTime)).toBe('Snack');
    });

    it('infers Pre-Workout and Post-Workout if passed', () => {
      const morningTime = new Date(2026, 9, 15, 8, 0);
      expect(inferMealType('Pre-Workout', morningTime)).toBe('Pre-Workout');
      expect(inferMealType('post-workout', morningTime)).toBe('Post-Workout');
    });
  });

  describe('no meal word in name (time-of-day inference)', () => {
    it('infers Breakfast at 08:00 local time', () => {
      const time = new Date(2026, 9, 15, 8, 0);
      expect(inferMealType(undefined, time)).toBe('Breakfast');
      expect(inferMealType('', time)).toBe('Breakfast');
      expect(inferMealType('Banana and Oats', time)).toBe('Breakfast');
    });

    it('infers Lunch at 12:30 local time', () => {
      const time = new Date(2026, 9, 15, 12, 30);
      expect(inferMealType(undefined, time)).toBe('Lunch');
      expect(inferMealType('', time)).toBe('Lunch');
      expect(inferMealType('Chicken Rice Bowl', time)).toBe('Lunch');
    });

    it('infers Dinner at 19:00 local time', () => {
      const time = new Date(2026, 9, 15, 19, 0);
      expect(inferMealType(undefined, time)).toBe('Dinner');
      expect(inferMealType('', time)).toBe('Dinner');
      expect(inferMealType('Steak and Potatoes', time)).toBe('Dinner');
    });

    it('infers Snack at 23:30 local time', () => {
      const time = new Date(2026, 9, 15, 23, 30);
      expect(inferMealType(undefined, time)).toBe('Snack');
      expect(inferMealType('', time)).toBe('Snack');
      expect(inferMealType('Greek Yogurt', time)).toBe('Snack');
    });
  });

  describe('exact boundary transitions', () => {
    it('10:59 local -> Breakfast', () => {
      const boundaryTime = new Date(2026, 9, 15, 10, 59);
      expect(inferMealType(undefined, boundaryTime)).toBe('Breakfast');
    });

    it('11:00 local -> Lunch', () => {
      const boundaryTime = new Date(2026, 9, 15, 11, 0);
      expect(inferMealType(undefined, boundaryTime)).toBe('Lunch');
    });

    it('15:59 local -> Lunch', () => {
      const boundaryTime = new Date(2026, 9, 15, 15, 59);
      expect(inferMealType(undefined, boundaryTime)).toBe('Lunch');
    });

    it('16:00 local -> Dinner', () => {
      const boundaryTime = new Date(2026, 9, 15, 16, 0);
      expect(inferMealType(undefined, boundaryTime)).toBe('Dinner');
    });

    it('21:59 local -> Dinner', () => {
      const boundaryTime = new Date(2026, 9, 15, 21, 59);
      expect(inferMealType(undefined, boundaryTime)).toBe('Dinner');
    });

    it('22:00 local -> Snack', () => {
      const boundaryTime = new Date(2026, 9, 15, 22, 0);
      expect(inferMealType(undefined, boundaryTime)).toBe('Snack');
    });

    it('23:59 local -> Snack', () => {
      const boundaryTime = new Date(2026, 9, 15, 23, 59);
      expect(inferMealType(undefined, boundaryTime)).toBe('Snack');
    });

    it('00:00 midnight local -> Breakfast', () => {
      const boundaryTime = new Date(2026, 9, 15, 0, 0);
      expect(inferMealType(undefined, boundaryTime)).toBe('Breakfast');
    });
  });

  describe('system clock fallback (no Date argument passed)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses system time when now is omitted', () => {
      vi.setSystemTime(new Date(2026, 9, 15, 19, 30));
      expect(inferMealType()).toBe('Dinner');

      vi.setSystemTime(new Date(2026, 9, 15, 8, 15));
      expect(inferMealType()).toBe('Breakfast');

      vi.setSystemTime(new Date(2026, 9, 15, 13, 0));
      expect(inferMealType()).toBe('Lunch');

      vi.setSystemTime(new Date(2026, 9, 15, 22, 30));
      expect(inferMealType()).toBe('Snack');
    });

    it('handles invalid date objects gracefully by falling back to system time', () => {
      vi.setSystemTime(new Date(2026, 9, 15, 12, 0));
      const invalidDate = new Date(NaN);
      expect(inferMealType(undefined, invalidDate)).toBe('Lunch');
    });
  });

  describe('type validation and canonicalization helpers', () => {
    it('validates canonical meal types correctly', () => {
      for (const mealType of CANONICAL_MEAL_TYPES) {
        expect(isValidMealType(mealType)).toBe(true);
        expect(isValidMealType(mealType.toLowerCase())).toBe(true);
        expect(isValidMealType(mealType.toUpperCase())).toBe(true);
      }
      expect(isValidMealType('Unknown')).toBe(false);
      expect(isValidMealType('')).toBe(false);
      expect(isValidMealType(null)).toBe(false);
      expect(isValidMealType(undefined)).toBe(false);
      expect(isValidMealType(123)).toBe(false);
    });

    it('canonicalizes valid strings and falls back to Breakfast for invalid', () => {
      expect(canonicalizeMealType('dinner')).toBe('Dinner');
      expect(canonicalizeMealType('  LUNCH  ')).toBe('Lunch');
      expect(canonicalizeMealType('breakfast')).toBe('Breakfast');
      expect(canonicalizeMealType('snack')).toBe('Snack');
      expect(canonicalizeMealType('pre-workout')).toBe('Pre-Workout');
      expect(canonicalizeMealType('post-workout')).toBe('Post-Workout');
      expect(canonicalizeMealType('invalid_value')).toBe('Breakfast');
      expect(canonicalizeMealType(null)).toBe('Breakfast');
      expect(canonicalizeMealType(undefined)).toBe('Breakfast');
    });
  });
});
