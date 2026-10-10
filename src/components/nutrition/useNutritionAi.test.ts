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
    expect(setIsError).toHaveBeenCalledWith(false);
    expect(setStatus).toHaveBeenCalledWith('');
  });
});
