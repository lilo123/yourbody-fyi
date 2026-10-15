import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNutritionAi } from './useNutritionAi';
import { parseNutrition } from './parseNutrition';
import type { StagedMeal } from './nutritionEngineHelpers';
import { NUTRITION_PARSER_MODE_KEY } from '../../hooks/useNutritionParserMode';

vi.mock('./parseNutrition', () => ({
  parseNutrition: vi.fn(),
  formatQuotaExceededMessage: vi.fn().mockReturnValue('Quota exceeded'),
}));

vi.mock('../../offline', () => ({
  enqueueAndAwait: vi.fn(),
}));

describe('Nutrition parser mode routing (Auto, Always AI, On-device only)', () => {
  const mockUserId = 'user-test-parser-mode';
  const setStatus = vi.fn();
  const setIsError = vi.fn();
  const onParsedSuccess = vi.fn();
  const onFallbackToManual = vi.fn();

  const exactBlock = `Greek Yogurt
Serving size: 1 cup
Calories 130
Protein 15g
Total Carbohydrate 9g
Total Fat 2g
Dietary Fiber 0g`;

  const lenientBlock = `Protein Shake
Calories 200
Protein 30g
Carbohydrate 5g
Fat 3g
ate half`;

  const partialBlock = `Mystery Snack
Calories 180
Protein 12g`;

  const noneBlock = 'A hearty breakfast with scrambled eggs and toast';

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
        targetUserId: mockUserId,
        onParsedSuccess,
        onFallbackToManual,
        setStatus,
        setIsError,
        parserMode: options?.parserMode,
      })
    );

  describe('Auto mode (default P3 routing)', () => {
    it('online + exact: stages locally with 0 network calls', async () => {
      const { result } = setupHook({ parserMode: 'auto' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('exact');
      expect(staged.source).toBe('local');
    });

    it('online + lenient: sends to server parseNutrition without forceAi', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Protein Shake',
        calories: 100,
        protein: 15,
        carbs: 2.5,
        fat: 1.5,
        fiber: 0,
        items: [],
        source: 'rules',
        confidence: 'lenient',
      } as any);

      const { result } = setupHook({ parserMode: 'auto' });
      act(() => {
        result.current.setNlInput(lenientBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: lenientBlock,
          forceAi: false,
        })
      );
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });

    it('offline + lenient: stages locally with confidence "lenient"', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'auto' });
      act(() => {
        result.current.setNlInput(lenientBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('lenient');
      expect(staged.source).toBe('local');
    });

    it('offline + partial: prefills Quick Log with found macros only', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'auto' });
      act(() => {
        result.current.setNlInput(partialBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onFallbackToManual).toHaveBeenCalledWith(
        'Mystery Snack',
        expect.objectContaining({
          name: 'Mystery Snack',
          calories: 180,
          protein: 12,
        })
      );
      const passedPrefill = onFallbackToManual.mock.calls[0][1];
      expect(passedPrefill.carbs).toBeUndefined();
      expect(passedPrefill.fat).toBeUndefined();
    });

    it('offline + none: rejects with connection requirement message', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'auto' });
      act(() => {
        result.current.setNlInput(noneBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onParsedSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Always AI mode', () => {
    it('online + exact: sends to server with forceAi: true (skips device rules)', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Greek Yogurt',
        calories: 130,
        protein: 15,
        carbs: 9,
        fat: 2,
        fiber: 0,
        items: [],
        source: 'ai',
        confidence: 'exact',
      } as any);

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: exactBlock,
          forceAi: true,
        })
      );
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });

    it('online + lenient: sends to server with forceAi: true', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Protein Shake',
        calories: 200,
        protein: 30,
        carbs: 5,
        fat: 3,
        fiber: 0,
        items: [],
        source: 'ai',
        confidence: 'lenient',
      } as any);

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(lenientBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: lenientBlock,
          forceAi: true,
        })
      );
    });

    it('offline + exact: falls back to local staging (P3 offline routing)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('exact');
      expect(staged.source).toBe('local');
    });

    it('offline + lenient: falls back to local staging with confidence "lenient"', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(lenientBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('lenient');
    });

    it('offline + partial: falls back to Quick Log prefill with found macros', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(partialBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onFallbackToManual).toHaveBeenCalledWith(
        'Mystery Snack',
        expect.objectContaining({
          name: 'Mystery Snack',
          calories: 180,
          protein: 12,
        })
      );
    });

    it('offline + none: rejects with connection requirement message', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'always_ai' });
      act(() => {
        result.current.setNlInput(noneBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
    });
  });

  describe('On-device only mode', () => {
    it('online + exact: stages locally with zero network calls', async () => {
      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('exact');
      expect(staged.source).toBe('local');
    });

    it('online + lenient: stages locally with zero network calls and confidence "lenient"', async () => {
      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(lenientBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged: StagedMeal = onParsedSuccess.mock.calls[0][0];
      expect(staged.confidence).toBe('lenient');
      expect(staged.source).toBe('local');
    });

    it('online + partial: prefills Quick Log with found macros and custom message without network call', async () => {
      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(partialBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('Could not parse: use quick log');
      expect(onFallbackToManual).toHaveBeenCalledWith(
        'Mystery Snack',
        expect.objectContaining({
          name: 'Mystery Snack',
          calories: 180,
          protein: 12,
        })
      );
    });

    it('online + none: rejects with "Could not parse: use quick log" and zero network calls', async () => {
      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(noneBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('Could not parse: use quick log');
      expect(onParsedSuccess).not.toHaveBeenCalled();
    });

    it('offline + exact: stages locally with zero network calls', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledWith('Parsed locally');
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });

    it('offline + none: rejects with "Could not parse: use quick log" (not connection text)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(noneBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).not.toHaveBeenCalled();
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('Could not parse: use quick log');
    });

    it('photos always use AI parse even in on_device mode', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Meal Photo',
        calories: 450,
        protein: 30,
        carbs: 40,
        fat: 15,
        fiber: 5,
        items: [],
        source: 'ai',
        confidence: 'exact',
      } as any);

      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setSelectedPhoto({
          base64: 'photo',
          dataUrl: 'data:image/jpeg;base64,photo',
          mimeType: 'image/jpeg',
          width: 100,
          height: 100,
          sizeBytes: 1024,
        });
      });

      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledTimes(1);
      expect(onParsedSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Meal Photo',
          source: 'ai',
        })
      );
    });

    it('explicit forceAi ("Analyze with AI instead") remains available in on_device mode', async () => {
      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Greek Yogurt',
        calories: 130,
        protein: 15,
        carbs: 9,
        fat: 2,
        fiber: 0,
        items: [],
        source: 'ai',
        confidence: 'exact',
      } as any);

      const { result } = setupHook({ parserMode: 'on_device' });
      act(() => {
        result.current.setNlInput(exactBlock);
      });

      await act(async () => {
        await result.current.handleForceAiAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: exactBlock,
          forceAi: true,
        })
      );
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('localStorage integration', () => {
    it('reads mode from localStorage when option is omitted', async () => {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'always_ai');

      vi.mocked(parseNutrition).mockResolvedValueOnce({
        name: 'Greek Yogurt',
        calories: 130,
        protein: 15,
        carbs: 9,
        fat: 2,
        fiber: 0,
        items: [],
        source: 'ai',
        confidence: 'exact',
      } as any);

      const { result } = setupHook();
      act(() => {
        result.current.setNlInput(exactBlock);
      });
      await act(async () => {
        await result.current.handleAnalyze();
      });

      expect(parseNutrition).toHaveBeenCalledWith(
        expect.objectContaining({
          text: exactBlock,
          forceAi: true,
        })
      );
    });
  });
});
