import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NutritionEngine } from './NutritionEngine';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder } from '../../test/supabaseBuilderMock';

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

describe('NutritionEngine Add Items with AI', () => {
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

  it('staged meal + "+ Add" + mocked parse -> items appended, totals recomputed, toast with Undo restores', async () => {
    // 1. Initial meal parse
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        name: 'Eggs & Toast',
        calories: 300,
        protein: 18,
        carbs: 25,
        fat: 12,
        fiber: 2,
        explanation: '300 kcal (Eggs & Toast) = 300 kcal',
        items: [
          { name: 'Eggs & Toast', portion: '1 plate', calories: 300, protein: 18, carbs: 25, fat: 12, fiber: 2 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    fireEvent.change(input, { target: { value: 'eggs & toast' } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // 2. Open inline composer via "+ Add"
    const addBtn = screen.getByTestId('add-item-button');
    expect(addBtn.textContent?.trim()).toBe('+ Add');
    expect(addBtn.getAttribute('aria-label')).toBe('Add item');
    fireEvent.click(addBtn);

    const composer = screen.getByTestId('add-items-composer');
    expect(composer).toBeDefined();

    // 3. Type into composer
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 banana' } });

    // Mock second parse for adding item
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        items: [
          {
            name: 'Banana',
            portion: '1 medium',
            quantity: 1,
            unit: 'unit',
            calories: 105,
            protein: 1.3,
            carbs: 27,
            fat: 0.3,
            fiber: 3.1,
          },
        ],
      },
      error: null,
    });

    // 4. Click Analyze in composer
    const analyzeBtn = screen.getByTestId('analyze-items-button');
    fireEvent.click(analyzeBtn);

    // 5. Verify composer closes, item appended, totals updated
    await waitFor(() => {
      expect(screen.queryByTestId('add-items-composer')).toBeNull();
      const card = screen.getByTestId('staged-meal-card');
      expect(card.textContent).toContain('Banana');
    });

    // Totals updated: 300 + 105 = 405 kcal
    const totalsGrid = screen.getByTestId('staged-meal-totals-grid');
    expect(totalsGrid).toHaveTextContent('405');

    // 6. Verify QuickLogToast
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
      expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Banana · +105 kcal');
    });

    // 7. Verify Undo restores exact pre-add meal
    const undoBtn = screen.getByTestId('toast-undo-btn');
    fireEvent.click(undoBtn);

    await waitFor(() => {
      const card = screen.getByTestId('staged-meal-card');
      expect(card.textContent).not.toContain('Banana');
    });
    expect(screen.getByTestId('staged-meal-card')).toBeDefined();
  });

  it('drops parse result silently if meal was discarded while parsing', async () => {
    // 1. Initial meal parse
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        name: 'Eggs',
        calories: 200,
        protein: 18,
        carbs: 2,
        fat: 14,
        fiber: 0,
        items: [{ name: 'Eggs', portion: '2 large', calories: 200, protein: 18, carbs: 2, fat: 14, fiber: 0 }],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    fireEvent.change(input, { target: { value: '2 eggs' } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // 2. Open composer and type
    fireEvent.click(screen.getByTestId('add-item-button'));
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 apple' } });

    // Mock delayed parse
    let resolveParse: any;
    (supabase.functions.invoke as any).mockReturnValueOnce(
      new Promise((res) => {
        resolveParse = res;
      })
    );

    fireEvent.click(screen.getByTestId('analyze-items-button'));

    // 3. While parse is pending, user discards the meal
    fireEvent.click(screen.getByLabelText('Discard staged meal'));

    await waitFor(() => {
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    });

    // 4. Now resolve the delayed parse
    resolveParse({
      data: {
        items: [{ name: 'Apple', calories: 80, protein: 0, carbs: 20, fat: 0, fiber: 3 }],
      },
      error: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Staged meal must NOT reappear and no toast shown
    expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    expect(screen.queryByTestId('quick-log-toast')).toBeNull();
  });
});
