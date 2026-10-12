import { useState, useCallback } from 'react';
import type { CustomDish } from '../../types/database';
import { formatCalories } from '../../utils/nutrition';
import { parseNutritionText } from '../../lib/nutrition/localParse';
import { buildStagedItem, type StagedMeal } from './nutritionEngineHelpers';
import { parseNutrition, formatQuotaExceededMessage } from './parseNutrition';
import { useNutritionPhotoPicker } from './useNutritionPhotoPicker';
import type { ManualMealPrefill } from './useManualMealForm';
import {
  getNutritionParserMode,
  type NutritionParserMode,
} from '../../hooks/useNutritionParserMode';

export interface UseNutritionAiOptions {
  customDishes: CustomDish[];
  targetUserId?: string;
  timeZone?: string;
  onParsedSuccess: (meal: StagedMeal) => void;
  onFallbackToManual: (dishName: string, prefill?: ManualMealPrefill) => void;
  setStatus: (msg: string) => void;
  setIsError: (err: boolean) => void;
  parserMode?: NutritionParserMode;
}

function buildStagedMealFromLocal(
  text: string,
  localResult: ReturnType<typeof parseNutritionText>,
  confidence: 'exact' | 'lenient'
): StagedMeal | null {
  const parsed = localResult.meal;
  if (!parsed) return null;
  const stagedItem = buildStagedItem({
    name: parsed.name || 'Meal',
    portion:
      parsed.servingSize && parsed.servingUnit
        ? `${parsed.servingSize} ${parsed.servingUnit}`
        : '1 serving',
    quantity: parsed.servingSize ?? 1,
    unit: (parsed.servingUnit as any) ?? 'serving',
    calories: parsed.calories,
    protein: parsed.protein,
    carbs: parsed.carbs,
    fat: parsed.fat,
    fiber: parsed.fiber ?? 0,
  });

  return {
    name: parsed.name || 'Meal',
    mealType: 'Breakfast',
    explanation: `${formatCalories(parsed.calories)} kcal (${parsed.name || 'Meal'})`,
    items: [stagedItem],
    calories: parsed.calories,
    protein: parsed.protein,
    carbs: parsed.carbs,
    fat: parsed.fat,
    fiber: parsed.fiber ?? 0,
    servingSize: parsed.servingSize ?? 1,
    servingUnit: parsed.servingUnit ?? 'serving',
    source: 'local',
    confidence,
    rawText: text.trim(),
  };
}

function extractPrefill(
  text: string,
  localResult: {
    meal?: {
      name?: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      fiber?: number;
      servingSize?: number;
      servingUnit?: string;
    };
    foundMacros?: Array<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber'>;
  } | null
): ManualMealPrefill {
  const prefill: ManualMealPrefill = {
    name: localResult?.meal?.name || text.trim(),
  };
  if (localResult?.foundMacros?.includes('calories') && localResult.meal?.calories !== undefined) {
    prefill.calories = localResult.meal.calories;
  }
  if (localResult?.foundMacros?.includes('protein') && localResult.meal?.protein !== undefined) {
    prefill.protein = localResult.meal.protein;
  }
  if (localResult?.foundMacros?.includes('carbs') && localResult.meal?.carbs !== undefined) {
    prefill.carbs = localResult.meal.carbs;
  }
  if (localResult?.foundMacros?.includes('fat') && localResult.meal?.fat !== undefined) {
    prefill.fat = localResult.meal.fat;
  }
  if (localResult?.foundMacros?.includes('fiber') && localResult.meal?.fiber !== undefined) {
    prefill.fiber = localResult.meal.fiber;
  }
  if (localResult?.meal?.servingSize !== undefined) {
    prefill.servingSize = localResult.meal.servingSize;
  }
  if (localResult?.meal?.servingUnit !== undefined) {
    prefill.servingUnit = localResult.meal.servingUnit;
  }
  return prefill;
}

export function useNutritionAi({
  customDishes,
  targetUserId,
  timeZone,
  onParsedSuccess,
  onFallbackToManual,
  setStatus,
  setIsError,
  parserMode: configuredParserMode,
}: UseNutritionAiOptions) {
  const [nlInput, setNlInput] = useState('');
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);

  const {
    selectedPhoto,
    setSelectedPhoto,
    fileInputRef,
    handlePickPhoto,
    handleFileChange,
    handleRemovePhoto,
  } = useNutritionPhotoPicker({
    onError: (msg) => {
      setIsError(true);
      setStatus(msg);
    },
    onClearError: () => {
      setIsError(false);
      setIsRateLimited(false);
      setIsQuotaExceeded(false);
    },
  });

  const handleAnalyze = async (options?: { forceAi?: boolean; overrideText?: string }) => {
    const textToAnalyze = options?.overrideText !== undefined ? options.overrideText : nlInput;
    if (!textToAnalyze.trim() && !selectedPhoto) return;

    setIsAnalyzing(true);
    setIsError(false);
    setIsRateLimited(false);
    setIsQuotaExceeded(false);

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const mode: NutritionParserMode = configuredParserMode ?? getNutritionParserMode();

    // 1. Text-only routing check (photos and explicit forceAi always use online AI parse)
    if (!options?.forceAi && !selectedPhoto && textToAnalyze.trim()) {
      if (mode === 'on_device') {
        setIsAnalyzing(false);
        const localResult = parseNutritionText(textToAnalyze.trim());
        const isSingle = !localResult.meal?.items || localResult.meal.items.length <= 1;

        if (localResult.confidence === 'exact' && isSingle && localResult.meal) {
          const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'exact');
          if (meal) {
            setStatus('Parsed locally');
            onParsedSuccess(meal);
            return;
          }
        }

        if (localResult.confidence === 'lenient' && isSingle && localResult.meal) {
          const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'lenient');
          if (meal) {
            setStatus('Parsed locally');
            onParsedSuccess(meal);
            return;
          }
        }

        if (localResult.confidence === 'partial') {
          const prefill = extractPrefill(textToAnalyze, localResult);
          setIsError(true);
          setStatus('Could not parse: use quick log');
          onFallbackToManual(prefill.name || textToAnalyze.trim(), prefill);
          return;
        }

        setIsError(true);
        setStatus('Could not parse: use quick log');
        return;
      }

      if (mode === 'always_ai') {
        if (!isOnline) {
          setIsAnalyzing(false);
          const localResult = parseNutritionText(textToAnalyze.trim());
          const isSingle = !localResult.meal?.items || localResult.meal.items.length <= 1;

          if (localResult.confidence === 'exact' && isSingle && localResult.meal) {
            const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'exact');
            if (meal) {
              setStatus('Parsed locally');
              onParsedSuccess(meal);
              return;
            }
          }

          if (localResult.confidence === 'lenient' && isSingle && localResult.meal) {
            const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'lenient');
            if (meal) {
              setStatus('Parsed locally');
              onParsedSuccess(meal);
              return;
            }
          }

          if (localResult.confidence === 'partial') {
            const prefill = extractPrefill(textToAnalyze, localResult);
            setIsError(true);
            setStatus('AI needs a connection: use quick log');
            onFallbackToManual(prefill.name || textToAnalyze.trim(), prefill);
            return;
          }

          setIsError(true);
          setStatus('AI needs a connection: use quick log');
          return;
        }
        // Online always_ai: fall through to online AI analysis with forceAi: true
      } else {
        // mode === 'auto': standard P3 routing
        const localResult = parseNutritionText(textToAnalyze.trim());
        const isSingle = !localResult.meal?.items || localResult.meal.items.length <= 1;

        // Exact single item: stage locally, zero network (both online and offline)
        if (localResult.confidence === 'exact' && isSingle && localResult.meal) {
          const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'exact');
          if (meal) {
            setIsAnalyzing(false);
            setStatus('Parsed locally');
            onParsedSuccess(meal);
            return;
          }
        }

        // Offline routing for non-exact text
        if (!isOnline) {
          setIsAnalyzing(false);

          if (localResult.confidence === 'lenient' && isSingle && localResult.meal) {
            const meal = buildStagedMealFromLocal(textToAnalyze, localResult, 'lenient');
            if (meal) {
              setStatus('Parsed locally');
              onParsedSuccess(meal);
              return;
            }
          }

          if (localResult.confidence === 'partial') {
            const prefill = extractPrefill(textToAnalyze, localResult);
            setIsError(true);
            setStatus('AI needs a connection: use quick log');
            onFallbackToManual(prefill.name || textToAnalyze.trim(), prefill);
            return;
          }

          setIsError(true);
          setStatus('AI needs a connection: use quick log');
          return;
        }
      }
    }

    // 2. Offline check for photo / forceAi
    if (!isOnline) {
      setIsAnalyzing(false);
      setIsError(true);
      setStatus('AI needs a connection: use quick log');
      return;
    }

    // 3. Online AI analysis
    setStatus(
      selectedPhoto
        ? 'Analyzing (this could take up to 45s)...'
        : 'Analyzing (this could take up to 30s)...'
    );

    const effectiveForceAi = Boolean(
      options?.forceAi || (mode === 'always_ai' && !selectedPhoto)
    );

    try {
      const parsed = await parseNutrition({
        text: textToAnalyze,
        photo: selectedPhoto,
        customDishes,
        forceAi: effectiveForceAi,
      });

      const meal = {
        name: parsed.name || textToAnalyze || (selectedPhoto ? 'Meal Photo' : 'Meal'),
        mealType: 'Breakfast',
        explanation:
          parsed.explanation ||
          parsed.items
            .map((it) => `${formatCalories(it.calories)} kcal (${it.name})`)
            .join(' + ') + ` = ${formatCalories(parsed.calories)} kcal`,
        items: parsed.items,
        calories: parsed.calories,
        protein: parsed.protein,
        carbs: parsed.carbs,
        fat: parsed.fat,
        fiber: parsed.fiber,
        servingSize: parsed.servingSize,
        servingUnit: parsed.servingUnit,
        photoUrl: selectedPhoto?.dataUrl,
        source: parsed.source === 'rules' ? 'rules' : 'ai',
        confidence: parsed.confidence,
        rawText: textToAnalyze.trim(),
      } as StagedMeal;

      setIsRateLimited(false);
      setStatus(parsed.source === 'rules' ? 'Parsed locally' : 'Analyzed');
      onParsedSuccess(meal);
      return;
    } catch (error: any) {
      console.warn('AI Edge function failed:', error);

      // Network / offline failure during online attempt -> do not enqueue, report connection requirement
      const isNetworkError =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        error?.name === 'TypeError' ||
        error?.message?.includes('fetch') ||
        error?.message?.includes('NetworkError') ||
        error?.message?.includes('Failed to fetch');

      if (isNetworkError) {
        setIsError(true);
        setStatus('AI needs a connection: use quick log');
        const localResult =
          textToAnalyze.trim() && !selectedPhoto ? parseNutritionText(textToAnalyze.trim()) : null;
        const prefill = extractPrefill(textToAnalyze, localResult);
        onFallbackToManual(
          prefill.name || textToAnalyze.trim() || (selectedPhoto ? 'Meal Photo' : ''),
          prefill
        );
        return;
      }

      if (error?.is429 || error?.context?.status === 429 || error?.status === 429) {
        if (error?.code === 'quota_exceeded') {
          setIsRateLimited(false);
          setIsError(true);
          setIsQuotaExceeded(true);
          const quotaMsg = error?.message || formatQuotaExceededMessage(error?.limit, error?.period);
          setStatus(quotaMsg);
          const localResult =
            textToAnalyze.trim() && !selectedPhoto ? parseNutritionText(textToAnalyze.trim()) : null;
          const prefill = extractPrefill(textToAnalyze, localResult);
          onFallbackToManual(
            prefill.name || textToAnalyze.trim() || (selectedPhoto ? 'Meal Photo' : ''),
            prefill
          );
          return;
        }

        setIsRateLimited(true);
        setIsError(false);
        setIsQuotaExceeded(false);
        setStatus('');
        return;
      }

      setIsError(true);
      const errorMsg = error?.message || (typeof error === 'string' ? error : 'Unknown error');
      setStatus(
        error?.code === 'NON_FOOD_DETECTED' ||
          error?.status === 422 ||
          error?.context?.status === 422
          ? `Meal Analysis: ${errorMsg}`
          : `AI service unavailable: ${errorMsg}`
      );
      onFallbackToManual(textToAnalyze.trim() || (selectedPhoto ? 'Meal Photo' : ''));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleForceAiAnalyze = useCallback(
    async (text?: string) => {
      await handleAnalyze({ forceAi: true, overrideText: text });
    },
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [nlInput, selectedPhoto, customDishes, targetUserId, timeZone, configuredParserMode]
  );

  return {
    nlInput,
    setNlInput,
    selectedPhoto,
    setSelectedPhoto,
    isRateLimited,
    setIsRateLimited,
    isQuotaExceeded,
    setIsQuotaExceeded,
    isAnalyzing,
    fileInputRef,
    handlePickPhoto,
    handleFileChange,
    handleRemovePhoto,
    handleAnalyze,
    handleForceAiAnalyze,
  };
}
