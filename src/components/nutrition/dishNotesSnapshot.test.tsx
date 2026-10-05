import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NutritionEngine } from './NutritionEngine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables, getRecordedSelects } from '../../test/supabaseBuilderMock';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'athlete@example.com' },
    access_token: 'mock-jwt-token-123',
  },
}));

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: vi.fn(),
  },
  CameraResultType: {
    Base64: 'base64',
  },
  CameraSource: {
    Camera: 'CAMERA',
    Photos: 'PHOTOS',
  },
}));

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<typeof import('../../offline')>('../../offline');
  return {
    ...actual,
    enqueueAndAwait: vi.fn().mockImplementation(async (input: any) => {
      await (supabase.from('nutrition_logs') as any).upsert(input.payload);
      return { status: 'synced', opId: 'mock-op-1' };
    }),
  };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe('Snapshot Isolation: Custom Dish Notes', () => {
  let queryClient: QueryClient;
  let insertedLogPayloads: any[] = [];
  let updatedDishPayloads: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    insertedLogPayloads = [];
    updatedDishPayloads = [];

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  it('Hard Constraint 1: snapshots dish.notes into nutrition_logs.notes at stage/log time, preserving historical logs when dish note changes', async () => {
    let currentDishNotes = 'Original Note: add 1 scoop blueberries';

    const customDishes = [
      {
        id: 'dish-note-1',
        user_id: 'test-user-id',
        name: 'Blueberry Oatmeal',
        calories: 350,
        protein: 20,
        carbs: 50,
        fat: 6,
        fiber: 5,
        kind: 'food',
        use_count: 3,
        notes: currentDishNotes,
        created_at: '2026-09-01T12:00:00Z',
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const builder = createSupabaseBuilder(table, {
          data: customDishes.map((d) => ({ ...d, notes: currentDishNotes })),
          error: null,
        });
        const origUpdate = builder.update.bind(builder);
        builder.update = (payload: any) => {
          updatedDishPayloads.push(payload);
          if (payload.notes !== undefined) {
            currentDishNotes = payload.notes;
          }
          return origUpdate(payload);
        };
        return builder;
      }

      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder(table, { data: [], error: null });
        const origInsert = builder.insert.bind(builder);
        builder.insert = (payload: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          insertedLogPayloads.push(...arr);
          return origInsert(payload);
        };
        const origUpsert = builder.upsert.bind(builder);
        builder.upsert = (payload: any, options: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          insertedLogPayloads.push(...arr);
          return origUpsert(payload, options);
        };
        return builder;
      }

      return createSupabaseBuilder(table, { data: [], error: null });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <NutritionEngine />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    // 1. Verify dish card is rendered with original note
    await waitFor(() => {
      expect(screen.getByTestId('custom-dish-card-dish-note-1')).toBeDefined();
    });

    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });

    // 2. Stage the custom dish
    fireEvent.click(screen.getByTestId('custom-dish-card-dish-note-1'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // 3. Log the staged meal
    const logButton = screen.getByRole('button', { name: /Log Meal/i });
    fireEvent.click(logButton);

    await waitFor(() => {
      expect(insertedLogPayloads.length).toBe(1);
    });

    // Hard Constraint 1 Check: Snapshot copy of notes into nutrition_logs.notes
    const loggedMeal = insertedLogPayloads[0];
    expect(loggedMeal.notes).toBe('Original Note: add 1 scoop blueberries');

    // 4. Now modify the dish note in custom_dishes
    currentDishNotes = 'Updated Note: add 2 scoops strawberries instead';

    // 5. Assert the historical log record STILL preserves the original snapshot note!
    expect(loggedMeal.notes).toBe('Original Note: add 1 scoop blueberries');
    expect(loggedMeal.notes).not.toBe(currentDishNotes);
  });

  it('Hard Constraint 1: 1-tap quick log snapshots dish.notes into nutrition_logs.notes directly', async () => {
    const customDishes = [
      {
        id: 'dish-note-quick',
        user_id: 'test-user-id',
        name: 'Quick Oats',
        calories: 300,
        protein: 15,
        carbs: 45,
        fat: 5,
        fiber: 4,
        kind: 'food',
        use_count: 1,
        notes: 'Quick-logged note: 1 glass of water',
        created_at: '2026-09-01T12:00:00Z',
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder(table, { data: customDishes, error: null });
      }
      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder(table, { data: [], error: null });
        const origInsert = builder.insert.bind(builder);
        builder.insert = (payload: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          insertedLogPayloads.push(...arr);
          return origInsert(payload);
        };
        const origUpsert = builder.upsert.bind(builder);
        builder.upsert = (payload: any, options: any) => {
          const arr = Array.isArray(payload) ? payload : [payload];
          insertedLogPayloads.push(...arr);
          return origUpsert(payload, options);
        };
        return builder;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <NutritionEngine />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-note-quick')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('quick-log-btn-dish-note-quick'));

    await waitFor(() => {
      expect(insertedLogPayloads.length).toBe(1);
    });

    expect(insertedLogPayloads[0].notes).toBe('Quick-logged note: 1 glass of water');
  });
});
