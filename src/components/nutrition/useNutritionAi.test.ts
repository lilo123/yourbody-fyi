import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNutritionAi } from './useNutritionAi';
import * as parseNutritionModule from './parseNutrition';

vi.mock('./parseNutrition', async (importOriginal) => {
  const actual = await importOriginal<typeof parseNutritionModule>();
  return {
    ...actual,
    parseNutrition: vi.fn(),
  };
});

vi.mock('../../offline', () => ({
  enqueueAiItem: vi.fn(),
  AiPhotoTooLargeError: class extends Error {},
}));

describe('useNutritionAi quota exceeded handling', () => {
  const setStatus = vi.fn();
  const setIsError = vi.fn();
  const onParsedSuccess = vi.fn();
  const onFallbackToManual = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupHook = () =>
    renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
      })
    );

  it('handles quota_exceeded with limit 0 (free plan)', async () => {
    const quotaErr: parseNutritionModule.ParseNutritionError = new Error(
      "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free."
    );
    quotaErr.is429 = true;
    quotaErr.status = 429;
    quotaErr.code = 'quota_exceeded';
    quotaErr.limit = 0;
    quotaErr.period = 'month';

    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(quotaErr);

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleForceAiAnalyze('banana smoothie');
    });

    expect(result.current.isRateLimited).toBe(false);
    expect(result.current.isQuotaExceeded).toBe(true);
    expect(setIsError).toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith(
      "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free."
    );
  });

  it('handles quota_exceeded with daily limit', async () => {
    const quotaErr: parseNutritionModule.ParseNutritionError = new Error(
      "You've used today's AI parses. Quick log and on-device parsing still work."
    );
    quotaErr.is429 = true;
    quotaErr.status = 429;
    quotaErr.code = 'quota_exceeded';
    quotaErr.limit = 30;
    quotaErr.period = 'day';

    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(quotaErr);

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleForceAiAnalyze('banana smoothie');
    });

    expect(result.current.isRateLimited).toBe(false);
    expect(result.current.isQuotaExceeded).toBe(true);
    expect(setIsError).toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith(
      "You've used today's AI parses. Quick log and on-device parsing still work."
    );
  });

  it('handles quota_exceeded with monthly limit', async () => {
    const quotaErr: parseNutritionModule.ParseNutritionError = new Error(
      "You've used this month's AI parses. Quick log and on-device parsing still work."
    );
    quotaErr.is429 = true;
    quotaErr.status = 429;
    quotaErr.code = 'quota_exceeded';
    quotaErr.limit = 100;
    quotaErr.period = 'month';

    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(quotaErr);

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleForceAiAnalyze('banana smoothie');
    });

    expect(result.current.isRateLimited).toBe(false);
    expect(result.current.isQuotaExceeded).toBe(true);
    expect(setIsError).toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith(
      "You've used this month's AI parses. Quick log and on-device parsing still work."
    );
  });

  it('sets isRateLimited to true for standard rate limit (15 RPM) errors', async () => {
    const rateLimitErr: parseNutritionModule.ParseNutritionError = new Error(
      'Gemini rate limit exceeded (15 RPM).'
    );
    rateLimitErr.is429 = true;
    rateLimitErr.status = 429;
    rateLimitErr.code = 'RATE_LIMITED';
    rateLimitErr.retryAfter = 15;

    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(rateLimitErr);

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleForceAiAnalyze('banana smoothie');
    });

    expect(result.current.isRateLimited).toBe(true);
    expect(result.current.isQuotaExceeded).toBe(false);
    expect(setIsError).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith('');
  });

  it('forwards forceAi: true to parseNutrition when handleForceAiAnalyze is called', async () => {
    vi.spyOn(parseNutritionModule, 'parseNutrition').mockResolvedValueOnce({
      name: 'Banana Smoothie',
      items: [],
      calories: 250,
      protein: 10,
      carbs: 45,
      fat: 3,
      fiber: 4,
      servingSize: 1,
      servingUnit: 'serving',
      source: 'ai',
    });

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleForceAiAnalyze('banana smoothie');
    });

    expect(parseNutritionModule.parseNutrition).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'banana smoothie',
        forceAi: true,
      })
    );
    expect(onParsedSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Banana Smoothie',
        source: 'ai',
      })
    );
    expect(setStatus).toHaveBeenCalledWith('Analyzed');
  });

  it('sets status to "Parsed locally" and source to "rules" when server returns source rules', async () => {
    vi.spyOn(parseNutritionModule, 'parseNutrition').mockResolvedValueOnce({
      name: 'Protein Shake',
      items: [],
      calories: 300,
      protein: 40,
      carbs: 10,
      fat: 5,
      fiber: 0,
      servingSize: 1,
      servingUnit: 'serving',
      source: 'rules',
      confidence: 'exact',
    });

    const { result } = setupHook();

    await act(async () => {
      await result.current.handleAnalyze({ overrideText: 'Protein Shake' });
    });

    expect(onParsedSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Protein Shake',
        source: 'rules',
      })
    );
    expect(setStatus).toHaveBeenCalledWith('Parsed locally');
  });
});
