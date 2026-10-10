import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { parseNutrition } from './parseNutrition';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('parseNutrition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: { access_token: 'mock-token' } },
    });
  });

  it('parses multi-item response successfully with correct items and totals', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Fruit Bowl',
        explanation: '100 kcal (Banana) + 60 kcal (Apple) = 160 kcal',
        items: [
          {
            name: 'Banana',
            portion: '1 medium',
            quantity: 1,
            unit: 'unit',
            calories: 100,
            protein: 1.2,
            carbs: 27,
            fat: 0.3,
            fiber: 3.1,
          },
          {
            name: 'Apple',
            portion: '1 small',
            quantity: 1,
            unit: 'unit',
            calories: 60,
            protein: 0.5,
            carbs: 15,
            fat: 0.2,
            fiber: 2.4,
          },
        ],
      },
      error: null,
    });

    const result = await parseNutrition({
      text: 'a banana and an apple',
      customDishes: [],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].name).toBe('Banana');
    expect(result.items[1].name).toBe('Apple');
    expect(result.calories).toBe(160);
    expect(result.protein).toBe(1.7);
    expect(result.carbs).toBe(42);
    expect(result.fat).toBe(0.5);
    expect(result.fiber).toBe(5.5);
    expect(result.name).toBe('Fruit Bowl');
  });

  it('parses single-item response when items array is omitted', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Oatmeal',
        calories: 150,
        protein: 5,
        carbs: 27,
        fat: 3,
        fiber: 4,
        serving_size: 1,
        serving_unit: 'bowl',
      },
      error: null,
    });

    const result = await parseNutrition({
      text: 'a bowl of oatmeal',
      customDishes: [],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Oatmeal');
    expect(result.items[0].calories).toBe(150);
    expect(result.calories).toBe(150);
    expect(result.servingSize).toBe(1);
    expect(result.servingUnit).toBe('bowl');
  });

  it('handles markdown code fences in string response', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: '```json\n{"name":"Egg","calories":70,"protein":6,"carbs":0.5,"fat":5,"fiber":0}\n```',
      error: null,
    });

    const result = await parseNutrition({ text: '1 egg' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Egg');
    expect(result.calories).toBe(70);
  });

  it('unwraps 429 rate limit error with is429 and retryAfter', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 429,
          json: async () => ({
            code: 'RATE_LIMITED',
            retryAfter: 15,
            error: 'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.',
          }),
        },
      },
    });

    await expect(parseNutrition({ text: 'rice' })).rejects.toMatchObject({
      is429: true,
      retryAfter: 15,
      message: 'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.',
    });
  });

  it('unwraps 422 / NON_FOOD_DETECTED error', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 422,
          json: async () => ({
            code: 'NON_FOOD_DETECTED',
            error: 'The input does not appear to contain food items.',
          }),
        },
      },
    });

    await expect(parseNutrition({ text: 'pencil' })).rejects.toMatchObject({
      code: 'NON_FOOD_DETECTED',
      status: 422,
      message: 'The input does not appear to contain food items.',
    });
  });

  it('extracts server message from error context clone or text', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 500,
          clone: () => ({
            text: async () => 'Internal edge function failure',
          }),
        },
      },
    });

    await expect(parseNutrition({ text: 'test' })).rejects.toThrow('Internal edge function failure');
  });

  it('rejects oversized photo payload client-side before invoking edge function', async () => {
    const oversizePhoto = {
      base64: 'largebase64',
      dataUrl: 'data:image/jpeg;base64,largebase64',
      mimeType: 'image/jpeg',
      sizeBytes: 1.6 * 1024 * 1024,
      width: 1920,
      height: 1080,
    };

    await expect(
      parseNutrition({
        photo: oversizePhoto,
      })
    ).rejects.toMatchObject({
      code: 'image_too_large',
      status: 413,
      message: 'Photo is too large (max 1.5 MB). Please choose a smaller photo.',
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('unwraps 413 / image_too_large server error with friendly message', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 413,
          json: async () => ({
            code: 'image_too_large',
            maxBytes: 1572864,
            error: 'Meal photo exceeds the 1.5 MB limit (1.80 MB). Please upload a smaller photo.',
          }),
        },
      },
    });

    await expect(parseNutrition({ text: 'meal photo analysis' })).rejects.toMatchObject({
      code: 'image_too_large',
      status: 413,
      message: 'Meal photo exceeds the 1.5 MB limit (1.80 MB). Please upload a smaller photo.',
    });
  });

  it('throws on missing nutrition data', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {},
      error: null,
    });

    await expect(parseNutrition({ text: 'nothing' })).rejects.toThrow(
      'Invalid parsed response: missing nutrition data'
    );
  });
});
