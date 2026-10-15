import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NutritionEngine } from '../components/nutrition/NutritionEngine';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from '../components/common/ToastHost';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder } from './supabaseBuilderMock';

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

vi.mock('../lib/supabase', () => ({
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

vi.mock('../offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../offline')>();
  return {
    ...actual,
    enqueueAndAwait: vi.fn().mockImplementation(async (input: any) => {
      const { incrementDishId, ...row } = input.payload;
      const builder = supabase.from('nutrition_logs') as any;
      let b;
      if ((builder.insert && builder.insert.name === 'spy') || (builder.insert && builder.insert._isMockFunction)) {
        b = builder.insert([row]);
      } else {
        b = builder.upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      }
      const selectBuilder = b && typeof b.select === 'function' ? b.select('id') : b;
      const res = await selectBuilder;
      if (res?.error) {
        throw res.error;
      }
      return { status: 'synced', opId: 'mock-op-1' };
    }),
  };
});

describe('NutritionEngine Parse Toast Persistence on Log (Task PARSETOAST)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    (supabase.from as any).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { data: [], error: null })
    );

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <ToastProvider>
              <NutritionEngine />
              <ToastHost />
            </ToastProvider>
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  it('keeps parse toast visible when meal is logged immediately after parse until normal timeout', async () => {
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        name: 'Banana',
        calories: 105,
        protein: 1.3,
        carbs: 27,
        fat: 0.3,
        fiber: 3.1,
        quota: { remaining: 8, limit: 10, period: 'day' },
        explanation: '105 kcal (Banana) = 105 kcal',
        items: [
          { name: 'Banana', portion: '1 medium', calories: 105, protein: 1.3, carbs: 27, fat: 0.3, fiber: 3.1 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    fireEvent.change(input, { target: { value: '1 medium banana' } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // Verify parse toast is shown with quota balance
    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toBeDefined();
      expect(screen.getByTestId('status-message')).toHaveTextContent(/Analyzed with AI · 8 of 10 left today/i);
    });

    // User logs meal immediately (within ~1 s)
    const logButton = screen.getByRole('button', { name: /Log Meal/i });
    fireEvent.click(logButton);

    // Staged card closes after logging
    await waitFor(() => {
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    });

    // CRITICAL: The parse toast must STILL be shown (not dismissed and not overwritten by "Saved")
    expect(screen.getByTestId('status-message')).toBeDefined();
    expect(screen.getByTestId('status-message')).toHaveTextContent(/Analyzed with AI · 8 of 10 left today/i);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('auto-dismisses parse toast after its normal duration expires', async () => {
    vi.useFakeTimers();

    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        name: 'Apple',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
        fiber: 4.4,
        quota: { remaining: 7, limit: 10, period: 'day' },
        explanation: '95 kcal (Apple)',
        items: [
          { name: 'Apple', portion: '1 medium', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, fiber: 4.4 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    fireEvent.change(input, { target: { value: '1 apple' } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    // Advance microtasks for promise resolution
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(100);

    expect(screen.getByTestId('status-message')).toBeDefined();
    expect(screen.getByTestId('status-message')).toHaveTextContent(/Analyzed with AI · 7 of 10 left today/i);

    // Log meal immediately
    const logButton = screen.getByRole('button', { name: /Log Meal/i });
    fireEvent.click(logButton);

    await vi.advanceTimersByTimeAsync(50);

    // Parse toast is still visible after log
    expect(screen.getByTestId('status-message')).toBeDefined();

    // Advance time to 3999ms after toast creation: still visible
    act(() => {
      vi.advanceTimersByTime(3800);
    });
    expect(screen.getByTestId('status-message')).toBeDefined();

    // Advance time past 4000ms: toast auto-dismisses on normal timeout
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('status-message')).toBeNull();
  });

  it('shows "Saved" toast when logging a meal without an active parse toast', async () => {
    renderComponent();

    // Switch to manual meal form
    const manualBtn = screen.getByText('Manual Entry');
    fireEvent.click(manualBtn);

    // Fill manual form
    const nameInput = screen.getByTestId('dish-name-input');
    fireEvent.change(nameInput, { target: { value: 'Oatmeal' } });
    const calsInput = screen.getByTestId('calories-input');
    fireEvent.change(calsInput, { target: { value: '250' } });

    // Stage manual meal by clicking Log Meal in ManualMealForm
    const stageBtn = screen.getByRole('button', { name: 'Log Meal' });
    fireEvent.click(stageBtn);

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // Log the staged meal
    const logBtn = screen.getByRole('button', { name: /Log Meal/i });
    fireEvent.click(logBtn);

    // Because there was no parse toast, "Saved" toast is displayed as normal
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
      expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Saved');
    });
  });

  it('preserves existing Quick Log favorite "Logged ... Undo" toast behavior', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder(table, {
          data: [
            {
              id: 'dish-favorite-1',
              user_id: 'test-user-id',
              name: 'Protein Shake',
              calories: 220,
              protein: 30,
              carbs: 8,
              fat: 3,
              fiber: 2,
              created_at: new Date().toISOString(),
              kind: 'meal',
              use_count: 5,
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-favorite-1')).toBeDefined();
    });

    // 1-tap quick log
    fireEvent.click(screen.getByTestId('quick-log-btn-dish-favorite-1'));

    // Existing undo toast appears with dish name, calories, and Undo button
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
      expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Protein Shake');
      expect(screen.getByTestId('toast-undo-btn')).toBeDefined();
    });
  });
});
