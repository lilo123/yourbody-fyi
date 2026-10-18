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

  it('prefills Quick Log via onFallbackToManual on 429 quota_exceeded with only found macros', async () => {
    const quotaErr: parseNutritionModule.ParseNutritionError = new Error(
      "You've used today's AI parses. Quick log and on-device parsing still work."
    );
    quotaErr.is429 = true;
    quotaErr.status = 429;
    quotaErr.code = 'quota_exceeded';
    quotaErr.limit = 30;
    quotaErr.period = 'day';

    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(quotaErr);

    const partialText = 'Protein Bar\nCalories: 200 kcal\nProtein: 20g';
    const { result } = setupHook();

    await act(async () => {
      await result.current.handleAnalyze({ overrideText: partialText });
    });

    expect(result.current.isQuotaExceeded).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(
      "You've used today's AI parses. Quick log and on-device parsing still work."
    );
    expect(onFallbackToManual).toHaveBeenCalledTimes(1);
    expect(onFallbackToManual).toHaveBeenCalledWith(
      'Protein Bar',
      expect.objectContaining({
        name: 'Protein Bar',
        calories: 200,
        protein: 20,
      })
    );
    const prefill = onFallbackToManual.mock.calls[0][1];
    expect(prefill?.calories).toBe(200);
    expect(prefill?.protein).toBe(20);
    expect(prefill?.carbs).toBeUndefined();
    expect(prefill?.fat).toBeUndefined();
    expect(prefill?.fiber).toBeUndefined();
  });

  it('calls onFallbackToManual with prefill when unparseable text is analyzed in on_device mode', async () => {
    const { result } = renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
        parserMode: 'on_device',
      })
    );

    await act(async () => {
      await result.current.handleAnalyze({ overrideText: 'had lunch with friends' });
    });

    expect(setIsError).toHaveBeenCalledWith(true);
    expect(setStatus).toHaveBeenCalledWith('Could not parse: use quick log');
    expect(onFallbackToManual).toHaveBeenCalledTimes(1);
    expect(onFallbackToManual).toHaveBeenCalledWith(
      'had lunch with friends',
      expect.objectContaining({ name: 'had lunch with friends' })
    );
  });

  it('passes extracted prefill to onFallbackToManual on 504 / timeout / general AI failure', async () => {
    const timeoutErr = new Error('504 Gateway Timeout');
    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(timeoutErr);

    const { result } = renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
      })
    );

    await act(async () => {
      await result.current.handleAnalyze({
        overrideText: 'Protein Bar\nCalories: 200 kcal\nProtein: 20g',
      });
    });

    expect(setIsError).toHaveBeenCalledWith(true);
    expect(onFallbackToManual).toHaveBeenCalledTimes(1);
    expect(onFallbackToManual).toHaveBeenCalledWith(
      'Protein Bar',
      expect.objectContaining({
        name: 'Protein Bar',
        calories: 200,
        protein: 20,
      })
    );
  });

  it('stages lenient single-item meal locally instead of opening quick log on network error', async () => {
    const netErr = new TypeError('Failed to fetch');
    vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(netErr);

    const lenientText =
      'Greek Yogurt\nCalories: 130 kcal\nProtein: 15g\nCarbs: 9g\nFat: 2g\nextra line to ignore';

    const { result } = renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
      })
    );

    await act(async () => {
      await result.current.handleAnalyze({ overrideText: lenientText });
    });

    expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    expect(onParsedSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'local',
        confidence: 'lenient',
        skippedLines: ['extra line to ignore'],
      })
    );
    expect(setStatus).toHaveBeenCalledWith('Parsed locally');
    expect(onFallbackToManual).not.toHaveBeenCalled();
  });

  it('prevents concurrent double-submit in handleAnalyze when an analysis is already in flight', async () => {
    let resolveAnalysis: (val: any) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveAnalysis = resolve;
    });
    vi.spyOn(parseNutritionModule, 'parseNutrition').mockReturnValue(pendingPromise as any);

    const { result } = renderHook(() =>
      useNutritionAi({
        customDishes: [],
        setStatus,
        setIsError,
        onParsedSuccess,
        onFallbackToManual,
      })
    );

    let promise1: Promise<void>;
    let promise2: Promise<void>;
    act(() => {
      promise1 = result.current.handleAnalyze({ overrideText: 'salmon and rice' });
      promise2 = result.current.handleAnalyze({ overrideText: 'salmon and rice' });
    });

    expect(parseNutritionModule.parseNutrition).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAnalysis!({
        name: 'Salmon and Rice',
        items: [],
        calories: 500,
        protein: 40,
        carbs: 50,
        fat: 15,
        fiber: 2,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'ai',
      });
      await Promise.all([promise1!, promise2!]);
    });

    expect(parseNutritionModule.parseNutrition).toHaveBeenCalledTimes(1);
  });

  describe('auto mode online routing for lenient text', () => {
    it('stages noise-only lenient text locally without calling AI', async () => {
      const mockParse = vi.spyOn(parseNutritionModule, 'parseNutrition');

      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus,
          setIsError,
          onParsedSuccess,
          onFallbackToManual,
        })
      );

      // Noise-only prose text that parses leniently
      const text =
        'Here is my lunch breakdown:\nGrilled chicken breast\nCalories: 250 kcal\nProtein: 40g\nCarbs: 0g\nFat: 5g\nHope this helps!';

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: text });
      });

      // Local parse handled it -> AI was not called
      expect(mockParse).not.toHaveBeenCalled();
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0];
      expect(staged.calories).toBe(250);
      expect(staged.protein).toBe(40);
      expect(staged.confidence).toBe('lenient');
    });

    it('routes lenient text with ranges to AI in auto mode online', async () => {
      const mockParse = vi.spyOn(parseNutritionModule, 'parseNutrition').mockResolvedValueOnce({
        name: 'Turkey Sandwich',
        items: [],
        calories: 350,
        protein: 30,
        carbs: 40,
        fat: 10,
        fiber: 4,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'ai',
      });

      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus,
          setIsError,
          onParsedSuccess,
          onFallbackToManual,
        })
      );

      // Text with a calorie range (ranges -> must go to AI)
      const text =
        'Turkey Sandwich\nCalories: 300-400 kcal\nProtein: 30g\nCarbs: 40g\nFat: 10g';

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: text });
      });

      expect(mockParse).toHaveBeenCalledTimes(1);
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
      const staged = onParsedSuccess.mock.calls[0][0];
      expect(staged.source).toBe('ai');
    });

    it('routes lenient text with modifiers (e.g. ate half) to AI in auto mode online', async () => {
      const mockParse = vi.spyOn(parseNutritionModule, 'parseNutrition').mockResolvedValueOnce({
        name: 'Pizza slice',
        items: [],
        calories: 150,
        protein: 8,
        carbs: 20,
        fat: 5,
        fiber: 1,
        servingSize: 1,
        servingUnit: 'serving',
        source: 'ai',
      });

      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus,
          setIsError,
          onParsedSuccess,
          onFallbackToManual,
        })
      );

      // Text with a modifier "ate half"
      const text =
        'ate half\nPizza slice\nCalories: 300 kcal\nProtein: 16g\nCarbs: 40g\nFat: 10g';

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: text });
      });

      expect(mockParse).toHaveBeenCalledTimes(1);
      expect(onParsedSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('preserves existing staged meal on handleForceAiAnalyze failure', () => {
    it('does NOT call onFallbackToManual when handleForceAiAnalyze fails with quota_exceeded', async () => {
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
        await result.current.handleForceAiAnalyze('4 eggs');
      });

      expect(result.current.isQuotaExceeded).toBe(true);
      expect(setIsError).toHaveBeenCalledWith(true);
      expect(onFallbackToManual).not.toHaveBeenCalled();
    });

    it('does NOT call onFallbackToManual when handleForceAiAnalyze fails with server/timeout error', async () => {
      vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(new Error('504 Gateway Timeout'));

      const { result } = setupHook();

      await act(async () => {
        await result.current.handleForceAiAnalyze('4 eggs');
      });

      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI service unavailable: 504 Gateway Timeout');
      expect(onFallbackToManual).not.toHaveBeenCalled();
    });

    it('sets status to AI service unavailable without connection message on upstream 503 AI_SERVICE_UNAVAILABLE', async () => {
      const upstreamErr: any = new Error(
        'AI service is temporarily unavailable. Please try again or switch to manual entry.'
      );
      upstreamErr.status = 503;
      upstreamErr.code = 'AI_SERVICE_UNAVAILABLE';
      vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(upstreamErr);

      const { result } = setupHook();

      await act(async () => {
        await result.current.handleForceAiAnalyze('4 eggs');
      });

      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith(
        'AI service unavailable: AI service is temporarily unavailable. Please try again or switch to manual entry.'
      );
      expect(setStatus).not.toHaveBeenCalledWith(expect.stringContaining('check your connection'));
      expect(onFallbackToManual).not.toHaveBeenCalled();
    });

    it('preserves connection message on true offline network failure', async () => {
      const netErr = new TypeError('Failed to fetch');
      vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(netErr);

      const { result } = setupHook();

      await act(async () => {
        await result.current.handleAnalyze({
          overrideText: 'complex meal query with multiple ingredients that cannot be parsed locally',
        });
      });

      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onFallbackToManual).toHaveBeenCalled();
    });

    it('does NOT call onFallbackToManual when handleForceAiAnalyze fails with network error', async () => {
      const netErr = new TypeError('Failed to fetch');
      vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(netErr);

      const { result } = setupHook();

      await act(async () => {
        await result.current.handleForceAiAnalyze('4 eggs');
      });

      expect(setIsError).toHaveBeenCalledWith(true);
      expect(setStatus).toHaveBeenCalledWith('AI needs a connection: use quick log');
      expect(onFallbackToManual).not.toHaveBeenCalled();
    });

    it('does NOT call onFallbackToManual when hasExistingStagedMeal is true on handleAnalyze failure', async () => {
      vi.spyOn(parseNutritionModule, 'parseNutrition').mockRejectedValueOnce(new Error('500 Server Error'));

      const { result } = renderHook(() =>
        useNutritionAi({
          customDishes: [],
          setStatus,
          setIsError,
          onParsedSuccess,
          onFallbackToManual,
          hasExistingStagedMeal: true,
        })
      );

      await act(async () => {
        await result.current.handleAnalyze({ overrideText: 'Greek Yogurt' });
      });

      expect(setIsError).toHaveBeenCalledWith(true);
      expect(onFallbackToManual).not.toHaveBeenCalled();
    });
  });
});
