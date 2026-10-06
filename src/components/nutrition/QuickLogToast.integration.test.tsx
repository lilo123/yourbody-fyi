import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NutritionEngine } from './NutritionEngine';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from '../../test/supabaseBuilderMock';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'athlete@example.com' },
    access_token: 'mock-jwt-token-123',
  },
}));

vi.mock('../../offline', async () => {
  const actual = await vi.importActual<typeof import('../../offline')>('../../offline');
  return {
    ...actual,
    newId: vi.fn().mockReturnValue('new-row-999'),
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

vi.mock('../../utils/unitConverter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/unitConverter')>();
  return {
    ...actual,
    convertPortion: vi.fn().mockImplementation((portion: string) => {
      const p = portion.toLowerCase().trim();
      if (p === '40g' || p === '40 g') return { quantity: 40, unit: 'g' };
      if (p === '1 serving') return { quantity: 1, unit: 'serving' };
      return actual.convertPortion(portion);
    }),
  };
});

describe('NutritionEngine QuickLogToast Integration', () => {
  let queryClient: QueryClient;
  let mockDeleteEq: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;
  let mockInsertSelect: ReturnType<typeof vi.fn>;
  let mockInsert: ReturnType<typeof vi.fn>;

  const dishes = [
    {
      id: 'dish-toast-fav-1',
      user_id: 'test-user-id',
      name: 'Roasted Almonds',
      calories: 160,
      protein: 6,
      carbs: 6,
      fat: 14,
      fiber: 3,
      use_count: 10,
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    clearMockHistory();

    mockDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
    mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });

    mockInsertSelect = vi.fn().mockResolvedValue({
      data: [{ id: 'new-row-999', food_name: 'Roasted Almonds', calories: 160 }],
      error: null,
    });
    mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return {
          delete: mockDelete,
          insert: mockInsert,
          upsert: mockInsert,
          select: vi.fn().mockReturnValue(createSupabaseBuilder('nutrition_logs', { data: [], error: null })),
        } as any;
      }
      if (table === 'custom_dishes') {
        return {
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          select: vi.fn().mockReturnValue(createSupabaseBuilder('custom_dishes', { data: dishes, error: null })),
        } as any;
      }
      return createSupabaseBuilder(table, { data: [], error: null }) as any;
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

  it('add while staged -> floating toast with Undo, staged card not shifted by inline banner', async () => {
    const user = userEvent.setup();
    renderComponent();

    // Stage a meal via Manual entry
    const manualBtn = await screen.findByRole('button', { name: /manual/i });
    fireEvent.click(manualBtn);

    const nameInput = screen.getByTestId('dish-name-input');
    await user.type(nameInput, 'Base Meal');
    const caloriesInput = screen.getByTestId('calories-input');
    await user.type(caloriesInput, '200');
    const proteinInput = screen.getByTestId('protein-input');
    await user.type(proteinInput, '20');
    const carbsInput = screen.getByTestId('carbs-input');
    await user.type(carbsInput, '20');
    const fatInput = screen.getByTestId('fat-input');
    await user.type(fatInput, '4');

    const logBtn = screen.getByText('Log Meal');
    fireEvent.click(logBtn);

    // Staged card is visible
    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    });

    const stagedCard = screen.getByTestId('staged-meal-card');
    const prevSiblingBefore = stagedCard.previousElementSibling;

    // Wait for favorites to load
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-toast-fav-1')).toBeInTheDocument();
    });

    // Tap "+" to add Roasted Almonds to staged meal
    const plusBtn = screen.getByTestId('quick-log-btn-dish-toast-fav-1');
    fireEvent.click(plusBtn);

    // Floating toast appears
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeInTheDocument();
    });

    const toast = screen.getByTestId('quick-log-toast');
    expect(toast).toHaveTextContent(/Added to meal/i);
    expect(toast).toHaveTextContent(/Roasted Almonds · \+160 kcal/i);

    // Staged card previous sibling is identical (no inline banner inserted into the flow before the card)
    const prevSiblingAfter = stagedCard.previousElementSibling;
    expect(prevSiblingAfter).toBe(prevSiblingBefore);

    // Totals updated: 200 + 160 = 360 kcal
    expect(screen.getByText(/Log Meal \(\+360 kcal\)/i)).toBeInTheDocument();

    // Undo button on floating toast
    const undoBtn = screen.getByTestId('toast-undo-btn');
    expect(undoBtn).toBeInTheDocument();
    fireEvent.click(undoBtn);

    // Staged meal reverts
    await waitFor(() => {
      expect(screen.getByText(/Log Meal \(\+200 kcal\)/i)).toBeInTheDocument();
    });
  }, 15000);

  it('direct log -> floating toast with Undo -> delete called on created row id', async () => {
    renderComponent();

    // Wait for favorites to load
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-toast-fav-1')).toBeInTheDocument();
    });

    // Direct log
    const quickLogBtn = screen.getByTestId('quick-log-btn-dish-toast-fav-1');
    fireEvent.click(quickLogBtn);

    // Insert mutation called
    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    // Toast appears
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeInTheDocument();
    });

    const toast = screen.getByTestId('quick-log-toast');
    expect(toast).toHaveTextContent(/Logged/i);
    expect(toast).toHaveTextContent(/Roasted Almonds · \+160 kcal/i);

    // Click Undo
    const undoBtn = screen.getByTestId('toast-undo-btn');
    fireEvent.click(undoBtn);

    // Delete mutation called for new-row-999
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteEq).toHaveBeenCalledWith('id', 'new-row-999');
    });

    // Toast dismissed
    await waitFor(() => {
      expect(screen.queryByTestId('quick-log-toast')).toBeNull();
    });
  }, 15000);
});
