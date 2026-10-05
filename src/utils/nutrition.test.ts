import { describe, it, expect } from 'vitest';
import {
  formatCalories,
  formatMacro,
  roundTo1Decimal,
  calculateRemainingFuel,
  formatPercentage,
  kcalMacroMismatch,
} from './nutrition';

describe('nutrition utility', () => {
  describe('formatCalories', () => {
    it('rounds numbers to whole integers', () => {
      expect(formatCalories(2200)).toBe('2200');
      expect(formatCalories(2199.6)).toBe('2200');
      expect(formatCalories(2199.4)).toBe('2199');
      expect(formatCalories(0.6)).toBe('1');
    });

    it('sanitizes zero, negative zero, and near-zero values (< 0.5)', () => {
      expect(formatCalories(0)).toBe('0');
      expect(formatCalories(-0)).toBe('0');
      expect(formatCalories(0.2)).toBe('0');
      expect(formatCalories(-0.4)).toBe('0');
    });

    it('handles null, undefined, NaN, and non-finite values gracefully', () => {
      expect(formatCalories(null)).toBe('0');
      expect(formatCalories(undefined)).toBe('0');
      expect(formatCalories(NaN)).toBe('0');
      expect(formatCalories(Infinity)).toBe('0');
      expect(formatCalories(-Infinity)).toBe('0');
    });

    it('handles string number inputs and invalid strings gracefully', () => {
      expect(formatCalories('2200')).toBe('2200');
      expect(formatCalories('2199.6')).toBe('2200');
      expect(formatCalories(' 45 ')).toBe('45');
      expect(formatCalories('')).toBe('0');
      expect(formatCalories('invalid')).toBe('0');
    });

    it('formats negative calorie values correctly', () => {
      expect(formatCalories(-15)).toBe('-15');
      expect(formatCalories(-15.6)).toBe('-16');
    });
  });

  describe('formatMacro', () => {
    it('strips trailing zeros for whole numbers', () => {
      expect(formatMacro(160)).toBe('160');
      expect(formatMacro(12.0)).toBe('12');
      expect(formatMacro(0)).toBe('0');
      expect(formatMacro(-0)).toBe('0');
    });

    it('formats decimals to at most 1 decimal place', () => {
      expect(formatMacro(12.5)).toBe('12.5');
      expect(formatMacro(12.54)).toBe('12.5');
      expect(formatMacro(12.56)).toBe('12.6');
    });

    it('handles IEEE-754 floating point arithmetic precision drift', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS
      expect(formatMacro(0.1 + 0.2)).toBe('0.3');
      // 159.99999999999997 from repeated additions
      expect(formatMacro(159.99999999999997)).toBe('160');
      // 12.000000000000002
      expect(formatMacro(12.000000000000002)).toBe('12');
      // 12.500000000000002
      expect(formatMacro(12.500000000000002)).toBe('12.5');
    });

    it('sanitizes near-zero drift (< 0.05 to 0)', () => {
      expect(formatMacro(0.04)).toBe('0');
      expect(formatMacro(0.01)).toBe('0');
      expect(formatMacro(0.00001)).toBe('0');
      expect(formatMacro(-0.04)).toBe('0');
      expect(formatMacro(-0.01)).toBe('0');
      // Threshold at 0.05 rounds to 0.1
      expect(formatMacro(0.05)).toBe('0.1');
      expect(formatMacro(-0.05)).toBe('-0.1');
    });

    it('handles null, undefined, NaN, and non-finite values gracefully', () => {
      expect(formatMacro(null)).toBe('0');
      expect(formatMacro(undefined)).toBe('0');
      expect(formatMacro(NaN)).toBe('0');
      expect(formatMacro(Infinity)).toBe('0');
      expect(formatMacro(-Infinity)).toBe('0');
    });

    it('handles string inputs and invalid strings gracefully', () => {
      expect(formatMacro('160')).toBe('160');
      expect(formatMacro('12.54')).toBe('12.5');
      expect(formatMacro('12.0')).toBe('12');
      expect(formatMacro('')).toBe('0');
      expect(formatMacro('invalid')).toBe('0');
    });

    it('formats negative macro values correctly', () => {
      expect(formatMacro(-5)).toBe('-5');
      expect(formatMacro(-5.2)).toBe('-5.2');
    });
  });

  describe('roundTo1Decimal', () => {
    it('rounds numbers to at most 1 decimal place', () => {
      expect(roundTo1Decimal(140.0024)).toBe(140);
      expect(roundTo1Decimal(24.0075)).toBe(24);
      expect(roundTo1Decimal(1.979999)).toBe(2);
      expect(roundTo1Decimal(3.465)).toBe(3.5);
      expect(roundTo1Decimal(140.002499999999)).toBe(140);
      expect(roundTo1Decimal(1.97999999999999)).toBe(2);
      expect(roundTo1Decimal(12.54)).toBe(12.5);
      expect(roundTo1Decimal(12.56)).toBe(12.6);
    });

    it('sanitizes zero, negative zero, and near-zero values (< 0.05)', () => {
      expect(roundTo1Decimal(0)).toBe(0);
      expect(roundTo1Decimal(-0)).toBe(0);
      expect(roundTo1Decimal(0.04)).toBe(0);
      expect(roundTo1Decimal(-0.04)).toBe(0);
      expect(roundTo1Decimal(0.05)).toBe(0.1);
      expect(roundTo1Decimal(-0.05)).toBe(-0.1);
    });

    it('handles null, undefined, NaN, and non-finite values gracefully', () => {
      expect(roundTo1Decimal(null)).toBe(0);
      expect(roundTo1Decimal(undefined)).toBe(0);
      expect(roundTo1Decimal(NaN)).toBe(0);
      expect(roundTo1Decimal(Infinity)).toBe(0);
      expect(roundTo1Decimal(-Infinity)).toBe(0);
    });

    it('handles string numbers and invalid strings gracefully', () => {
      expect(roundTo1Decimal('140.0024')).toBe(140);
      expect(roundTo1Decimal('3.465')).toBe(3.5);
      expect(roundTo1Decimal('')).toBe(0);
      expect(roundTo1Decimal('invalid')).toBe(0);
    });
  });

  describe('calculateRemainingFuel', () => {
    it('calculates remaining fuel accurately when under target budget', () => {
      const dailyTotals = {
        calories: 1800,
        protein: 120,
        carbs: 170,
        fat: 50,
        fiber: 20,
      };
      const targets = {
        calories: 2200,
        protein: 160,
        carbs: 220,
        fat: 70,
        fiber: 30,
      };

      const result = calculateRemainingFuel(dailyTotals, targets);

      // Calories
      expect(result.calories.isOver).toBe(false);
      expect(result.calories.rawDiff).toBe(400);
      expect(result.calories.formattedValue).toBe('400');
      expect(result.calories.badgeLabel).toBe('400 kcal');

      // Protein
      expect(result.protein.isOver).toBe(false);
      expect(result.protein.rawDiff).toBe(40);
      expect(result.protein.formattedValue).toBe('40');
      expect(result.protein.badgeLabel).toBe('40g P');

      // Carbs
      expect(result.carbs.isOver).toBe(false);
      expect(result.carbs.rawDiff).toBe(50);
      expect(result.carbs.formattedValue).toBe('50');
      expect(result.carbs.badgeLabel).toBe('50g C');

      // Fat
      expect(result.fat.isOver).toBe(false);
      expect(result.fat.rawDiff).toBe(20);
      expect(result.fat.formattedValue).toBe('20');
      expect(result.fat.badgeLabel).toBe('20g F');

      // Fiber
      expect(result.fiber.isOver).toBe(false);
      expect(result.fiber.rawDiff).toBe(10);
      expect(result.fiber.formattedValue).toBe('10');
      expect(result.fiber.badgeLabel).toBe('10g Fib');
    });

    it('displays over target badges (+X kcal over / +Xg P over) when over budget', () => {
      const dailyTotals = {
        calories: 2350,
        protein: 175.5,
        carbs: 240,
        fat: 75.2,
        fiber: 32,
      };
      const targets = {
        calories: 2200,
        protein: 160,
        carbs: 220,
        fat: 70,
        fiber: 30,
      };

      const result = calculateRemainingFuel(dailyTotals, targets);

      // Calories
      expect(result.calories.isOver).toBe(true);
      expect(result.calories.rawDiff).toBe(-150);
      expect(result.calories.formattedValue).toBe('150');
      expect(result.calories.badgeLabel).toBe('+150 kcal over');

      // Protein
      expect(result.protein.isOver).toBe(true);
      expect(result.protein.rawDiff).toBe(-15.5);
      expect(result.protein.formattedValue).toBe('15.5');
      expect(result.protein.badgeLabel).toBe('+15.5g P over');

      // Carbs
      expect(result.carbs.isOver).toBe(true);
      expect(result.carbs.rawDiff).toBe(-20);
      expect(result.carbs.formattedValue).toBe('20');
      expect(result.carbs.badgeLabel).toBe('+20g C over');

      // Fat
      expect(result.fat.isOver).toBe(true);
      expect(result.fat.rawDiff).toBe(-5.2);
      expect(result.fat.formattedValue).toBe('5.2');
      expect(result.fat.badgeLabel).toBe('+5.2g F over');

      // Fiber
      expect(result.fiber.isOver).toBe(true);
      expect(result.fiber.rawDiff).toBe(-2);
      expect(result.fiber.formattedValue).toBe('2');
      expect(result.fiber.badgeLabel).toBe('+2g Fib over');
    });

    it('sanitizes near-zero drift (< 0.05) and handles exact target match', () => {
      const dailyTotals = {
        calories: 2200.2, // diff -0.2 kcal -> rounds to 0
        protein: 160.03, // diff -0.03g -> near-zero drift (< 0.05)
        carbs: 219.97, // diff +0.03g -> near-zero drift (< 0.05)
        fat: 70,
        fiber: 30,
      };
      const targets = {
        calories: 2200,
        protein: 160,
        carbs: 220,
        fat: 70,
        fiber: 30,
      };

      const result = calculateRemainingFuel(dailyTotals, targets);

      expect(result.calories.isOver).toBe(false);
      expect(result.calories.rawDiff).toBe(0);
      expect(result.calories.badgeLabel).toBe('0 kcal');

      expect(result.protein.isOver).toBe(false);
      expect(result.protein.rawDiff).toBe(0);
      expect(result.protein.badgeLabel).toBe('0g P');

      expect(result.carbs.isOver).toBe(false);
      expect(result.carbs.rawDiff).toBe(0);
      expect(result.carbs.badgeLabel).toBe('0g C');

      expect(result.fat.isOver).toBe(false);
      expect(result.fat.rawDiff).toBe(0);
      expect(result.fat.badgeLabel).toBe('0g F');

      expect(result.fiber.isOver).toBe(false);
      expect(result.fiber.rawDiff).toBe(0);
      expect(result.fiber.badgeLabel).toBe('0g Fib');
    });

    it('supports user profile target property names (target_calories, etc.)', () => {
      const dailyTotals = {
        calories: 1500,
        protein: 100,
        carbs: 150,
        fat: 50,
        fiber: 20,
      };
      const targets = {
        target_calories: 2000,
        target_protein: 150,
        target_carbs: 200,
        target_fat: 65,
        target_fiber: 28,
      };

      const result = calculateRemainingFuel(dailyTotals, targets);

      expect(result.calories.badgeLabel).toBe('500 kcal');
      expect(result.protein.badgeLabel).toBe('50g P');
      expect(result.carbs.badgeLabel).toBe('50g C');
      expect(result.fat.badgeLabel).toBe('15g F');
      expect(result.fiber.badgeLabel).toBe('8g Fib');
    });

    it('rounds raw calorie diff to integer without floating point fractional artifacts', () => {
      const dailyTotals = {
        calories: 1849.6, // 2000 - 1849.6 = 150.4 -> rounds to 150
        protein: 100,
        carbs: 150,
        fat: 50,
        fiber: 20,
      };
      const targets = {
        calories: 2000,
        protein: 150,
        carbs: 200,
        fat: 65,
        fiber: 28,
      };

      const result = calculateRemainingFuel(dailyTotals, targets);
      expect(result.calories.rawDiff).toBe(150);
      expect(result.calories.formattedValue).toBe('150');
      expect(result.calories.badgeLabel).toBe('150 kcal');
    });

    it('handles null, undefined, and partial inputs gracefully without throwing', () => {
      const resultNull = calculateRemainingFuel(null, null);
      expect(resultNull.calories.rawDiff).toBe(0);
      expect(resultNull.calories.formattedValue).toBe('0');
      expect(resultNull.calories.isOver).toBe(false);
      expect(resultNull.calories.badgeLabel).toBe('0 kcal');
      expect(resultNull.protein.badgeLabel).toBe('0g P');

      const resultPartial = calculateRemainingFuel({}, {});
      expect(resultPartial.calories.rawDiff).toBe(0);
      expect(resultPartial.protein.rawDiff).toBe(0);
      expect(resultPartial.carbs.rawDiff).toBe(0);
      expect(resultPartial.fat.rawDiff).toBe(0);
      expect(resultPartial.fiber.rawDiff).toBe(0);
    });
  });

  describe('formatPercentage', () => {
    it('formats standard percentages rounded to whole numbers', () => {
      expect(formatPercentage(50, 100)).toBe('50%');
      expect(formatPercentage(25.4, 100)).toBe('25%');
      expect(formatPercentage(25.6, 100)).toBe('26%');
      expect(formatPercentage(100, 100)).toBe('100%');
      expect(formatPercentage(1, 100)).toBe('1%');
    });

    it('formats non-zero percentages strictly below 1% as <1%', () => {
      expect(formatPercentage(0.5, 100)).toBe('<1%');
      expect(formatPercentage(0.1, 100)).toBe('<1%');
      expect(formatPercentage(0.01, 100)).toBe('<1%');
      expect(formatPercentage(0.99, 100)).toBe('<1%');
    });

    it('formats zero or negative values as 0%', () => {
      expect(formatPercentage(0, 100)).toBe('0%');
      expect(formatPercentage(-5, 100)).toBe('0%');
      expect(formatPercentage(0, 0)).toBe('0%');
      expect(formatPercentage(50, 0)).toBe('0%');
      expect(formatPercentage(50, -100)).toBe('0%');
      expect(formatPercentage(1e-15, 100)).toBe('0%');
      expect(formatPercentage(0.00001, 100)).toBe('0%');
    });

    it('handles null, undefined, NaN, and string values gracefully', () => {
      expect(formatPercentage(null, 100)).toBe('0%');
      expect(formatPercentage(undefined, 100)).toBe('0%');
      expect(formatPercentage(50, null)).toBe('0%');
      expect(formatPercentage(50, undefined)).toBe('0%');
      expect(formatPercentage(NaN, 100)).toBe('0%');
      expect(formatPercentage(50, NaN)).toBe('0%');
      expect(formatPercentage('25', '100')).toBe('25%');
      expect(formatPercentage('0.5', '100')).toBe('<1%');
      expect(formatPercentage('invalid', '100')).toBe('0%');
    });
  });
  describe('kcalMacroMismatch (D23)', () => {
    it('returns null when any of kcal, protein, carbs, or fat is empty string', () => {
      expect(kcalMacroMismatch({ kcal: '', protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 200, protein: '', carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 200, protein: 25, carbs: '', fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 200, protein: 25, carbs: 0, fat: '' })).toBeNull();
      expect(kcalMacroMismatch({ calories: '', protein: 25, carbs: 0, fat: 0 })).toBeNull();
    });

    it('returns null when any input is unparseable or negative', () => {
      expect(kcalMacroMismatch({ kcal: 'abc', protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 200, protein: 'not-a-number', carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: -50, protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 200, protein: -10, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: null, protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: undefined, protein: 25, carbs: 0, fat: 0 })).toBeNull();
    });

    it('does not show hint when difference is exactly 15%', () => {
      // est = 4*100 + 4*150 + 9*0 = 1000
      // 15% of 1000 = 150
      // diff = 150 > 50, but 150 > 150 is false (strict > 15%)
      expect(kcalMacroMismatch({ kcal: 1150, protein: 100, carbs: 150, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 850, protein: 100, carbs: 150, fat: 0 })).toBeNull();
    });

    it('does not show hint when difference is just over 15% but diff <= 50', () => {
      // est = 4*25 + 4*0 + 9*0 = 100
      // 15% of 100 = 15
      // kcal = 120 -> diff = 20 > 15 (strict > 15%), but diff = 20 <= 50
      expect(kcalMacroMismatch({ kcal: 120, protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 80, protein: 25, carbs: 0, fat: 0 })).toBeNull();
    });

    it('does not show hint when difference is exactly 50', () => {
      // est = 4*50 + 4*0 + 9*0 = 200
      // 15% of 200 = 30
      // kcal = 250 -> diff = 50 > 30 (true), but diff = 50 > 50 is false (strict > 50)
      expect(kcalMacroMismatch({ kcal: 250, protein: 50, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 150, protein: 50, carbs: 0, fat: 0 })).toBeNull();
    });

    it('shows hint when diff is 51 and > 15%', () => {
      // est = 4*50 = 200. 15% = 30.
      // kcal = 251 -> diff = 51. 51 > 30 and 51 > 50 -> show.
      const resultHigher = kcalMacroMismatch({ kcal: 251, protein: 50, carbs: 0, fat: 0 });
      expect(resultHigher).toEqual({
        estimatedKcal: 200,
        diff: 51,
        message: 'Macros add up to ≈ 200 kcal',
      });

      // kcal = 149 -> diff = 51. 51 > 30 and 51 > 50 -> show.
      const resultLower = kcalMacroMismatch({ kcal: 149, protein: 50, carbs: 0, fat: 0 });
      expect(resultLower).toEqual({
        estimatedKcal: 200,
        diff: 51,
        message: 'Macros add up to ≈ 200 kcal',
      });
    });

    it('handles zero values correctly (all 0 + kcal 0 -> hidden; P/C/F 0 + kcal 60 -> shown ≈ 0; kcal 0 + macros est 100 -> shown)', () => {
      // all 0 + kcal 0 -> hidden
      expect(kcalMacroMismatch({ kcal: 0, protein: 0, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: '0', protein: '0', carbs: '0', fat: '0' })).toBeNull();

      // P/C/F 0 + kcal 60 -> shown ≈ 0
      // est = 0. est == 0 satisfies percentage condition. diff = 60 > 50 -> shown.
      expect(kcalMacroMismatch({ kcal: 60, protein: 0, carbs: 0, fat: 0 })).toEqual({
        estimatedKcal: 0,
        diff: 60,
        message: 'Macros add up to ≈ 0 kcal',
      });

      // kcal 0 + macros est 100 -> shown
      // est = 100. diff = 100 > 15 and 100 > 50 -> shown.
      expect(kcalMacroMismatch({ kcal: 0, protein: 25, carbs: 0, fat: 0 })).toEqual({
        estimatedKcal: 100,
        diff: 100,
        message: 'Macros add up to ≈ 100 kcal',
      });
    });

    it('ignores fiber (fiber > 0 does not change est)', () => {
      // est without fiber = 4*25 + 4*0 + 9*0 = 100
      // with fiber = 50, est must still be 100
      expect(kcalMacroMismatch({ kcal: 0, protein: 25, carbs: 0, fat: 0, fiber: 50 })).toEqual({
        estimatedKcal: 100,
        diff: 100,
        message: 'Macros add up to ≈ 100 kcal',
      });
    });

    it('handles decimal inputs and rounds estimated kcal to nearest whole integer', () => {
      // P = 10.5, C = 20.2, F = 5.1
      // est = 4*10.5 + 4*20.2 + 9*5.1 = 42 + 80.8 + 45.9 = 168.7
      // kcal = 300 -> diff = |300 - 168.7| = 131.3
      // 0.15 * 168.7 = 25.305 -> 131.3 > 25.305 and 131.3 > 50 -> shown.
      // Math.round(168.7) = 169
      expect(kcalMacroMismatch({ kcal: 300, protein: 10.5, carbs: 20.2, fat: 5.1 })).toEqual({
        estimatedKcal: 169,
        diff: 131.3,
        message: 'Macros add up to ≈ 169 kcal',
      });
    });

    it('supports calories property alias as alternative to kcal', () => {
      expect(kcalMacroMismatch({ calories: 300, protein: 10.5, carbs: 20.2, fat: 5.1 })).toEqual({
        estimatedKcal: 169,
        diff: 131.3,
        message: 'Macros add up to ≈ 169 kcal',
      });
    });

    it('covers exact spec boundary conditions (strict > 15% and strict > 50)', () => {
      // kcal 115 / est 100 (15% exactly, diff 15 -> hidden)
      expect(kcalMacroMismatch({ kcal: 115, protein: 25, carbs: 0, fat: 0 })).toBeNull();

      // kcal 460 / est 400 (15% exactly, diff 60 > 50, but 15% not > 15% -> hidden)
      expect(kcalMacroMismatch({ kcal: 460, protein: 100, carbs: 0, fat: 0 })).toBeNull();

      // kcal 461 / est 400 (diff 61 > 60 and > 50 -> shown)
      expect(kcalMacroMismatch({ kcal: 461, protein: 100, carbs: 0, fat: 0 })).toEqual({
        estimatedKcal: 400,
        diff: 61,
        message: 'Macros add up to ≈ 400 kcal',
      });

      // kcal 150 / est 100 (diff 50 exactly, diff > 15% but diff 50 not > 50 -> hidden)
      expect(kcalMacroMismatch({ kcal: 150, protein: 25, carbs: 0, fat: 0 })).toBeNull();

      // kcal 151 / est 100 (diff 51 > 15 and > 50 -> shown)
      expect(kcalMacroMismatch({ kcal: 151, protein: 25, carbs: 0, fat: 0 })).toEqual({
        estimatedKcal: 100,
        diff: 51,
        message: 'Macros add up to ≈ 100 kcal',
      });

      // kcal below est: 45 vs 452 (shown)
      expect(kcalMacroMismatch({ kcal: 45, protein: 50, carbs: 40, fat: 10.22 })).toEqual({
        estimatedKcal: 452,
        diff: 406.98,
        message: 'Macros add up to ≈ 452 kcal',
      });

      // huge fiber is ignored
      expect(kcalMacroMismatch({ kcal: 45, protein: 50, carbs: 40, fat: 10.22, fiber: 9999 })).toEqual({
        estimatedKcal: 452,
        diff: 406.98,
        message: 'Macros add up to ≈ 452 kcal',
      });

      // '1,5' vs '1.5' decimal handling: '1.5' parses, '1,5' is unparseable and returns null
      expect(kcalMacroMismatch({ kcal: '151', protein: '25.0', carbs: '0', fat: '0' })).toEqual({
        estimatedKcal: 100,
        diff: 51,
        message: 'Macros add up to ≈ 100 kcal',
      });
      expect(kcalMacroMismatch({ kcal: '151', protein: '25,0', carbs: '0', fat: '0' })).toBeNull();
      expect(kcalMacroMismatch({ kcal: '151,0', protein: '25', carbs: '0', fat: '0' })).toBeNull();

      // whitespace strings return null
      expect(kcalMacroMismatch({ kcal: '   ', protein: 25, carbs: 0, fat: 0 })).toBeNull();
      expect(kcalMacroMismatch({ kcal: 151, protein: '  	  ', carbs: 0, fat: 0 })).toBeNull();
    });
  });
});
