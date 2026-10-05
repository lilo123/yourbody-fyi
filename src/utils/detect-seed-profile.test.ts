import { describe, it, expect, beforeAll } from 'vitest';

type EvaluateSeedProfileFn = (facts: Record<string, unknown> | null | undefined) => string;

let evaluateSeedProfile: EvaluateSeedProfileFn;

beforeAll(async () => {
  const scriptPath = '../../scripts/detect-seed-profile.js';
  const mod = (await import(/* @vite-ignore */ scriptPath)) as {
    evaluateSeedProfile: EvaluateSeedProfileFn;
  };
  evaluateSeedProfile = mod.evaluateSeedProfile;
});

describe('detect-seed-profile pure decision logic (Seed Provenance)', () => {
  const validStressFacts = {
    setsCount: 752,
    maxWorkoutSets: 500,
    customDishesCount: 5,
    customDishesItemsBytes: 300000,
    nutritionLogsCount: 50,
    maxNutritionLogsItemsBytes: 100000,
    routineTemplatesCount: 75,
  };

  it('returns "payload-stress" when all criteria are at exact floor thresholds', () => {
    expect(evaluateSeedProfile(validStressFacts)).toBe('payload-stress');
  });

  it('returns "payload-stress" when all criteria comfortably exceed floor thresholds', () => {
    const generousFacts = {
      setsCount: 1500,
      maxWorkoutSets: 750,
      customDishesCount: 20,
      customDishesItemsBytes: 500000,
      nutritionLogsCount: 100,
      maxNutritionLogsItemsBytes: 250000,
      routineTemplatesCount: 120,
    };
    expect(evaluateSeedProfile(generousFacts)).toBe('payload-stress');
  });

  it('accepts snake_case property aliases produced by database queries', () => {
    const snakeCaseFacts = {
      sets_count: 752,
      max_workout_sets: 500,
      custom_dishes_count: 5,
      dishes_items_bytes: 336910,
      nutrition_logs_count: 50,
      max_nutrition_items_bytes: 134748,
      routine_templates_count: 75,
    };
    expect(evaluateSeedProfile(snakeCaseFacts)).toBe('payload-stress');
  });

  describe('individual criteria floor violations return "unspecified"', () => {
    it('fails when setsCount is below floor (751 < 752)', () => {
      const facts = { ...validStressFacts, setsCount: 751 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when maxWorkoutSets is below floor (499 < 500)', () => {
      const facts = { ...validStressFacts, maxWorkoutSets: 499 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when customDishesCount is below floor (4 < 5)', () => {
      const facts = { ...validStressFacts, customDishesCount: 4 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when customDishesItemsBytes is below floor (299999 < 300000) — weight criterion', () => {
      const facts = { ...validStressFacts, customDishesItemsBytes: 299999 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when nutritionLogsCount is below floor (49 < 50)', () => {
      const facts = { ...validStressFacts, nutritionLogsCount: 49 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when maxNutritionLogsItemsBytes is below floor (99999 < 100000) — weight criterion', () => {
      const facts = { ...validStressFacts, maxNutritionLogsItemsBytes: 99999 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });

    it('fails when routineTemplatesCount is below floor (74 < 75)', () => {
      const facts = { ...validStressFacts, routineTemplatesCount: 74 };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });
  });

  describe('empty, null, or malformed facts return "unspecified"', () => {
    it('returns "unspecified" for an empty facts object', () => {
      expect(evaluateSeedProfile({})).toBe('unspecified');
    });

    it('returns "unspecified" for null', () => {
      expect(evaluateSeedProfile(null)).toBe('unspecified');
    });

    it('returns "unspecified" for undefined', () => {
      expect(evaluateSeedProfile(undefined)).toBe('unspecified');
    });

    it('returns "unspecified" when facts contain NaN values', () => {
      const facts = { ...validStressFacts, setsCount: NaN };
      expect(evaluateSeedProfile(facts)).toBe('unspecified');
    });
  });
});
