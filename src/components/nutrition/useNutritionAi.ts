import { useState, useCallback } from 'react';
import type { CustomDish } from '../../types/database';
import { formatCalories } from '../../utils/nutrition';
import { formatLocalTimestamp, normalizeDateStr, getLocalDateStr } from '../../utils/date';
import { parseNutritionBlock } from '../../lib/nutrition/localParse';
import { enqueueAiItem, AiPhotoTooLargeError } from '../../offline';
import { buildStagedItem, type StagedMeal } from './nutritionEngineHelpers';
import { parseNutrition } from './parseNutrition';
import { useNutritionPhotoPicker } from './useNutritionPhotoPicker';

export interface UseNutritionAiOptions {
  customDishes: CustomDish[];
  targetUserId?: string;
  timeZone?: string;
  onParsedSuccess: (meal: StagedMeal) => void;
  onFallbackToManual: (dishName: string) => void;
  setStatus: (msg: string) => void;
  setIsError: (err: boolean) => void;
}

export function useNutritionAi({
  customDishes,
  targetUserId,
  timeZone,
  onParsedSuccess,
  onFallbackToManual,
  setStatus,
  setIsError,
}: UseNutritionAiOptions) {
  const [nlInput, setNlInput] = useState('');
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
    },
  });

  const enqueueToAiQueue = useCallback(
    async (text?: string, photo?: typeof selectedPhoto) => {
      if (!targetUserId) {
        throw new Error('User required to queue item');
      }
      const now = new Date();
      const capturedAt = formatLocalTimestamp(null, now, timeZone);
      const captureDate = normalizeDateStr(now, timeZone) || getLocalDateStr(now);

      await enqueueAiItem({
        userId: targetUserId,
        kind: photo ? 'photo' : 'text',
        text: text?.trim() || undefined,
        photo: photo ? { base64: photo.base64, mime: photo.mimeType } : undefined,
        capturedAt,
        captureDate,
      });

      setStatus('Queued for analysis when online');
      setNlInput('');
      setSelectedPhoto(null);
    },
    [targetUserId, timeZone, setSelectedPhoto, setStatus]
  );

  const handleAnalyze = async (options?: { forceAi?: boolean; overrideText?: string }) => {
    const textToAnalyze = options?.overrideText !== undefined ? options.overrideText : nlInput;
    if (!textToAnalyze.trim() && !selectedPhoto) return;

    setIsAnalyzing(true);
    setIsError(false);
    setIsRateLimited(false);

    // 1. Text-only local parse check (unless forceAi is requested)
    if (!options?.forceAi && !selectedPhoto && textToAnalyze.trim()) {
      const localResult = parseNutritionBlock(textToAnalyze.trim());
      if (localResult.ok) {
        const parsed = localResult.meal;
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

        const meal: StagedMeal = {
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
          rawText: textToAnalyze.trim(),
        };

        setIsAnalyzing(false);
        setStatus('Parsed locally');
        onParsedSuccess(meal);
        return;
      }
    }

    // 2. Offline check: if not online, enqueue to AI queue
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isOnline) {
      try {
        await enqueueToAiQueue(textToAnalyze, selectedPhoto);
        setIsAnalyzing(false);
        return;
      } catch (err: unknown) {
        console.warn('[useNutritionAi] Failed to enqueue to AI queue:', err);
        setIsAnalyzing(false);
        setIsError(true);
        if (err instanceof AiPhotoTooLargeError || (err as any)?.code === 'PHOTO_TOO_LARGE') {
          setStatus('Photo too large (max 4 MB)');
        } else {
          setStatus((err as Error)?.message || 'Failed to queue item');
        }
        return;
      }
    }

    // 3. Online AI analysis
    setStatus(
      selectedPhoto
        ? 'Analyzing (this could take up to 45s)...'
        : 'Analyzing (this could take up to 30s)...'
    );

    try {
      const parsed = await parseNutrition({
        text: textToAnalyze,
        photo: selectedPhoto,
        customDishes,
      });

      const meal: StagedMeal = {
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
        source: 'ai',
      };

      setIsRateLimited(false);
      setStatus('Analyzed');
      onParsedSuccess(meal);
      return;
    } catch (error: any) {
      console.warn('AI Edge function failed:', error);

      // Network / offline failure during online attempt -> fallback to AI queue
      const isNetworkError =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        error?.name === 'TypeError' ||
        error?.message?.includes('fetch') ||
        error?.message?.includes('NetworkError') ||
        error?.message?.includes('Failed to fetch');

      if (isNetworkError && targetUserId) {
        try {
          await enqueueToAiQueue(textToAnalyze, selectedPhoto);
          setIsAnalyzing(false);
          return;
        } catch (queueErr: unknown) {
          console.warn('[useNutritionAi] Failed to fallback-enqueue to AI queue:', queueErr);
          setIsError(true);
          if (queueErr instanceof AiPhotoTooLargeError || (queueErr as any)?.code === 'PHOTO_TOO_LARGE') {
            setStatus('Photo too large (max 4 MB)');
          } else {
            setStatus((queueErr as Error)?.message || 'Failed to queue item');
          }
          return;
        }
      }

      if (error?.is429 || error?.context?.status === 429 || error?.status === 429) {
        setIsRateLimited(true);
        setIsError(false);
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
    [nlInput, selectedPhoto, customDishes, targetUserId, timeZone]
  );

  return {
    nlInput,
    setNlInput,
    selectedPhoto,
    setSelectedPhoto,
    isRateLimited,
    setIsRateLimited,
    isAnalyzing,
    fileInputRef,
    handlePickPhoto,
    handleFileChange,
    handleRemovePhoto,
    handleAnalyze,
    handleForceAiAnalyze,
  };
}
