import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNutritionAi } from './useNutritionAi';
import { parseNutrition } from './parseNutrition';
import type { StagedMeal } from './nutritionEngineHelpers';
import { MACRO_KEYS } from '../../utils/itemModel';

vi.mock('./parseNutrition', () => ({
  parseNutrition: vi.fn(),
  formatQuotaExceededMessage: vi.fn().mockReturnValue('Quota exceeded'),
}));

vi.mock('../../offline', () => ({
  enqueueAndAwait: vi.fn(),
}));

describe('Device multi-item breakdown staging (P6)', () => {
  const setStatus = vi.fn();
  const setIsError = vi.fn();
  const onParsedSuccess = vi.fn();
  const onFallbackToManual = vi.fn();

  const exact2ItemInput = `Meal: High-Protein Lunch
Total Portion Size: 200 g

Component Breakdown:
* Grilled Chicken Breast: 100g | 165 kcal | 31g protein | 0g carbs | 3.6g fat | 0g fiber
* Brown Rice: 100g | 135 kcal | 3g protein | 28g carbs | 1g fat | 2g fiber

Total Calories: 300 kcal
Total Protein: 34 g
Total Carbs: 28 g
Total Fat: 4.6 g
Total Fiber: 2 g`;

  const exact3ItemInput = `Food Item: Power Plate
Total Portion Size: 350 g

Component Breakdown:
* Grilled Salmon: 150g | 312 kcal | 30g protein | 0g carbs | 20g fat | 0g fiber
* Steamed Quinoa: 100g | 120 kcal | 4g protein | 21g carbs | 2g fat | 3g fiber
* Steamed Broccoli: 100g | 35 kcal | 2.5g protein | 7g carbs | 0.5g fat | 3g fiber

Total Calories: 467 kcal
Total Protein: 36.5 g
Total Carbs: 28 g
Total Fat: 22.5 g
Total Fiber: 6 g`;

  const lenientMultiItemInput = `Meal: Lunch
Component Breakdown:
* Chicken Breast: 100g | 165 kcal | 31g protein | 0g carbs | 3.6g fat
* Brown Rice: 100g | 135 kcal | 3g protein | 28g carbs | 1g fat
Unrecognized garnish on top`;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  const setupHook = (options?: { parserMode?: 'auto' | 'always_ai' | 'on_device' }) =>
    renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
        parserMode: options?.parserMode,
      })
    );

  const verifyParentSumIntegrity = (staged: StagedMeal) => {
    expect(staged.items.length).toBeGreaterThanOrEqual(2);
    for (const macroKey of MACRO_KEYS) {
      const itemsSum = staged.items.reduce(
        (sum, item) => sum + (Number(item[macroKey]) || 0),
        0
      );
      const parentValue = Number(staged[macroKey]) || 0;
      const discrepancy = Math.abs(parentValue - itemsSum);
      expect(discrepancy).toBeLessThanOrEqual(0.05);
    }
  };

  describe('Offline exact multi-item staging', () => {
    it('stages a 2-item exact breakdown offline with correct items and totals', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'auto' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact2ItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(setIsError).toHaveBeenCalledWith(false);
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);

      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.source).toBe('local');
      expect(staged.confidence).toBe('exact');
      expect(staged.name).toBe('High-Protein Lunch');
      expect(staged.items).toHaveLength(2);

      const firstItem = staged.items[0];
      expect(firstItem.name).toBe('Grilled Chicken Breast');
      expect(firstItem.calories).toBe(165);
      expect(firstItem.protein).toBe(31);
      expect(firstItem.carbs).toBe(0);
      expect(firstItem.fat).toBe(3.6);
      expect(firstItem.fiber).toBe(0);

      const secondItem = staged.items[1];
      expect(secondItem.name).toBe('Brown Rice');
      expect(secondItem.calories).toBe(135);
      expect(secondItem.protein).toBe(3);
      expect(secondItem.carbs).toBe(28);
      expect(secondItem.fat).toBe(1);
      expect(secondItem.fiber).toBe(2);

      expect(staged.calories).toBe(300);
      expect(staged.protein).toBe(34);
      expect(staged.carbs).toBe(28);
      expect(staged.fat).toBe(4.6);
      expect(staged.fiber).toBe(2);

      verifyParentSumIntegrity(staged);
    });

    it('stages a 3-item exact breakdown offline with correct items and totals', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'auto' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact3ItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(setIsError).toHaveBeenCalledWith(false);
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);

      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.source).toBe('local');
      expect(staged.confidence).toBe('exact');
      expect(staged.name).toBe('Power Plate');
      expect(staged.items).toHaveLength(3);

      expect(staged.items[0].name).toBe('Grilled Salmon');
      expect(staged.items[0].calories).toBe(312);
      expect(staged.items[1].name).toBe('Steamed Quinoa');
      expect(staged.items[1].calories).toBe(120);
      expect(staged.items[2].name).toBe('Steamed Broccoli');
      expect(staged.items[2].calories).toBe(35);

      expect(staged.calories).toBe(467);
      expect(staged.protein).toBe(36.5);
      expect(staged.carbs).toBe(28);
      expect(staged.fat).toBe(22.5);
      expect(staged.fiber).toBe(6);

      verifyParentSumIntegrity(staged);
    });
  });

  describe('Online exact multi-item staging', () => {
    it('stages a 2-item exact breakdown online with 0 network calls', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'auto' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact2ItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);

      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.source).toBe('local');
      expect(staged.confidence).toBe('exact');
      expect(staged.items).toHaveLength(2);
      verifyParentSumIntegrity(staged);
    });

    it('stages a 3-item exact breakdown online with 0 network calls', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'auto' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact3ItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);

      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.source).toBe('local');
      expect(staged.confidence).toBe('exact');
      expect(staged.items).toHaveLength(3);
      verifyParentSumIntegrity(staged);
    });
  });

  describe('Parser modes interaction', () => {
    it('on_device mode: stages exact multi-item breakdown locally both online and offline', async () => {
      const { result: onlineResult } = setupHook({ parserMode: 'on_device' });
      await act(async () => {
        await onlineResult.current.handleAnalyze({ overrideText: exact2ItemInput });
      });
      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      verifyParentSumIntegrity(onParsedSuccess.mock.calls[0][0]);

      vi.clearAllMocks();
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result: offlineResult } = setupHook({ parserMode: 'on_device' });
      await act(async () => {
        await offlineResult.current.handleAnalyze({ overrideText: exact3ItemInput });
      });
      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      verifyParentSumIntegrity(onParsedSuccess.mock.calls[0][0]);
    });

    it('always_ai mode online: still sends forceAi: true to server without local staging', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Server Plate',
        calories: 300,
        protein: 34,
        carbs: 28,
        fat: 4.6,
        fiber: 2,
        items: [],
        source: 'ai',
        confidence: 'exact',
        servingSize: 1,
        servingUnit: 'serving',
      });

      const { result } = setupHook({ parserMode: 'always_ai' });
      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact2ItemInput });
      });

      expect(parseNutrition).toHaveBeenCalledTimes(1);
      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: exact2ItemInput,
          forceAi: true,
        })
      );
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });

    it('always_ai mode offline: falls back to staging exact multi-item breakdown locally', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'always_ai' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: exact2ItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      verifyParentSumIntegrity(onParsedSuccess.mock.calls[0][0]);
    });
  });

  describe('Lenient multi-item preserves existing behaviour', () => {
    it('auto mode online: sends lenient multi-item to server without forceAi', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Lunch',
        calories: 300,
        protein: 34,
        carbs: 28,
        fat: 4.6,
        fiber: 0,
        items: [],
        source: 'rules',
        confidence: 'lenient',
        servingSize: 1,
        servingUnit: 'serving',
      });

      const { result } = setupHook({ parserMode: 'auto' });
      await act(async () => {
        await result.current.handleAnalyze({ overrideText: lenientMultiItemInput });
      });

      expect(parseNutrition).toHaveBeenCalledTimes(1);
      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: lenientMultiItemInput,
          forceAi: false,
        })
      );
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.skippedLines).toEqual(['Unrecognized garnish on top']);
    });

    it('auto mode offline: rejects lenient multi-item with connection requirement', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
      const { result } = setupHook({ parserMode: 'auto' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: lenientMultiItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onParsedSuccess).not.toHaveBeenCalled();
    });

    it('on_device mode: rejects lenient multi-item with "Could not parse: use quick log"', async () => {
      const { result } = setupHook({ parserMode: 'on_device' });

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: lenientMultiItemInput });
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('Could not parse: use quick log');
      expect(onParsedSuccess).not.toHaveBeenCalled();
    });
  });
});
