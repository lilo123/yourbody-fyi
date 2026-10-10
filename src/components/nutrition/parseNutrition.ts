import { supabase } from '../../lib/supabase';
import type { CustomDish } from '../../types/database';
import type { CompressedImage } from '../../utils/imageCompression';
import { MAX_PHOTO_BYTES } from '../../utils/photoLimits';
import { roundTo1Decimal } from '../../utils/nutrition';
import { buildStagedItem, type StagedItem } from './nutritionEngineHelpers';

export interface ParseNutritionArgs {
  text?: string;
  photo?: CompressedImage | null;
  customDishes?: CustomDish[];
}

export interface ParseNutritionResult {
  name?: string;
  explanation?: string;
  items: StagedItem[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  servingSize: number;
  servingUnit: string;
}

export interface ParseNutritionError extends Error {
  is429?: boolean;
  retryAfter?: number;
  code?: string;
  status?: number;
  context?: any;
}

export async function parseNutrition({
  text = '',
  photo,
  customDishes = [],
}: ParseNutritionArgs): Promise<ParseNutritionResult> {
  const trimmed = text.trim();
  if (!trimmed && !photo) {
    throw new Error('Input is empty: please provide text or photo');
  }

  if (photo && photo.sizeBytes > MAX_PHOTO_BYTES) {
    const sizeErr: ParseNutritionError = new Error(
      'Photo is too large (max 1.5 MB). Please choose a smaller photo.'
    );
    sizeErr.code = 'image_too_large';
    sizeErr.status = 413;
    throw sizeErr;
  }

  let timeoutId: any;
  const timeoutMs = photo ? 45000 : 30000;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Edge function timeout after ${timeoutMs / 1000}s`)),
      timeoutMs
    );
  });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  const invokePromise = supabase.functions.invoke('parse-nutrition', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: {
      input: text,
      text,
      image_base64: photo ? photo.base64 : undefined,
      imageMimeType: photo ? photo.mimeType : undefined,
      custom_dishes: customDishes.map((d) => ({
        name: d.name,
        calories: d.calories,
        protein: d.protein,
        carbs: d.carbs,
        fat: d.fat,
        fiber: d.fiber ?? 0,
      })),
    },
  });

  let data: any;
  let error: any;
  try {
    const result = (await Promise.race([invokePromise, timeoutPromise])) as any;
    data = result?.data;
    error = result?.error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (error) {
    let serverMessage = '';
    let errorCode = '';
    let retryAfterSeconds: number | undefined;

    if (error?.context) {
      if (error.context.error) serverMessage = error.context.error;
      if (error.context.code) errorCode = error.context.code;
      if (error.context.retryAfter) retryAfterSeconds = Number(error.context.retryAfter);

      if (!serverMessage) {
        try {
          const ctxClone =
            typeof error.context?.clone === 'function' ? error.context.clone() : error.context;
          if (typeof ctxClone?.json === 'function') {
            const errData = await ctxClone.json();
            if (errData?.error) serverMessage = errData.error;
            if (errData?.code) errorCode = errData.code;
            if (errData?.retryAfter) retryAfterSeconds = Number(errData.retryAfter);
          }
        } catch {
          // ignore
        }
      }

      if (!serverMessage) {
        try {
          const ctxCloneText =
            typeof error.context?.clone === 'function' ? error.context.clone() : error.context;
          if (typeof ctxCloneText?.text === 'function') {
            const textData = await ctxCloneText.text();
            if (textData && textData.length < 500) {
              serverMessage = textData;
            }
          }
        } catch {
          // ignore
        }
      }

      if (!retryAfterSeconds && error.context?.headers) {
        const headers = error.context.headers;
        const headerRetry =
          typeof headers?.get === 'function'
            ? headers.get('Retry-After') || headers.get('retry-after')
            : headers['Retry-After'] || headers['retry-after'];
        if (headerRetry && !isNaN(parseInt(headerRetry, 10))) {
          retryAfterSeconds = parseInt(headerRetry, 10);
        }
      }
    }

    const is429 = error?.context?.status === 429 || error?.status === 429;
    if (is429) {
      const rateLimitMsg =
        serverMessage ||
        'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.';
      const rateErr: ParseNutritionError = new Error(rateLimitMsg);
      rateErr.is429 = true;
      rateErr.status = 429;
      rateErr.retryAfter = retryAfterSeconds || 15;
      throw rateErr;
    }

    const is413 =
      error?.context?.status === 413 ||
      error?.status === 413 ||
      errorCode === 'image_too_large';
    if (is413) {
      const tooLargeMsg =
        serverMessage ||
        'Photo is too large (max 1.5 MB). Please choose a smaller photo.';
      const sizeErr: ParseNutritionError = new Error(tooLargeMsg);
      sizeErr.code = 'image_too_large';
      sizeErr.status = 413;
      throw sizeErr;
    }

    if (serverMessage) {
      const customErr: ParseNutritionError = new Error(serverMessage);
      customErr.code = errorCode;
      customErr.status = error?.context?.status || error?.status;
      throw customErr;
    }

    throw error;
  }

  let parsed = data;
  if (typeof data === 'string') {
    const cleaned = data.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  }

  if (parsed?.error) {
    const is413 = parsed.code === 'image_too_large';
    const err: ParseNutritionError = new Error(
      is413
        ? (parsed.error || 'Photo is too large (max 1.5 MB). Please choose a smaller photo.')
        : parsed.error
    );
    if (parsed.code) err.code = parsed.code;
    if (is413) err.status = 413;
    throw err;
  }

  if (
    parsed &&
    (parsed.calories !== undefined || (Array.isArray(parsed.items) && parsed.items.length > 0))
  ) {
    let items: StagedItem[] = [];
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      items = parsed.items.map((it: any) =>
        buildStagedItem({
          name: it.name || 'Item',
          portion: it.portion,
          quantity: it.quantity,
          unit: it.unit,
          calories: it.calories,
          protein: it.protein,
          carbs: it.carbs,
          fat: it.fat,
          fiber: it.fiber,
        })
      );
    } else {
      items = [
        buildStagedItem({
          name: parsed.name || text || (photo ? 'Meal Photo' : 'Meal'),
          portion: '1 serving',
          calories: parsed.calories,
          protein: parsed.protein,
          carbs: parsed.carbs,
          fat: parsed.fat,
          fiber: parsed.fiber,
        }),
      ];
    }

    const totalCal = roundTo1Decimal(items.reduce((s, it) => s + it.calories, 0));
    const totalP = roundTo1Decimal(items.reduce((s, it) => s + it.protein, 0));
    const totalC = roundTo1Decimal(items.reduce((s, it) => s + it.carbs, 0));
    const totalF = roundTo1Decimal(items.reduce((s, it) => s + it.fat, 0));
    const totalFib = roundTo1Decimal(items.reduce((s, it) => s + it.fiber, 0));

    return {
      name: parsed.name,
      explanation: parsed.explanation,
      items,
      calories: totalCal,
      protein: totalP,
      carbs: totalC,
      fat: totalF,
      fiber: totalFib,
      servingSize: Number(parsed.serving_size ?? parsed.servingSize) || 1,
      servingUnit: parsed.serving_unit || parsed.servingUnit || 'serving',
    };
  }

  throw new Error('Invalid parsed response: missing nutrition data');
}
