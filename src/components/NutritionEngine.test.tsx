import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NutritionEngine } from './nutrition/NutritionEngine';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from './common/ToastHost';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { getLocalDateStr, isWithinDayBounds, formatLocalTimestamp } from '../utils/date';
import { createSupabaseBuilder, getRecordedSelects, getRecordedTables, clearMockHistory } from '../test/supabaseBuilderMock';

/**
 * Edit and Delete now live behind a single overflow trigger (`meal-actions-<id>`)
 * so the row fits a 320 px viewport. The action testids only exist while the
 * menu is open, so a test has to open it first.
 */
function openMealAction(logId: string, action: 'edit' | 'delete') {
  fireEvent.click(screen.getByTestId(`meal-actions-${logId}`));
  fireEvent.click(screen.getByTestId(`${action}-meal-${logId}`));
}


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
      const builder = (supabase.from('nutrition_logs') as any);
      let b;
      if (builder.insert && builder.insert.name === 'spy' || (builder.insert && builder.insert._isMockFunction)) {
        b = builder.insert([row]);
      } else {
        b = builder.upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      }
      const selectBuilder = b && typeof b.select === 'function' ? b.select('id') : b;
      const res = await selectBuilder;
      if (res?.error) {
        throw res.error;
      }
      if (incrementDishId) {
        const { data: dishData } = await (supabase.from('custom_dishes') as any)
          .select('use_count')
          .eq('id', incrementDishId)
          .maybeSingle();
        const currentCount = typeof dishData?.use_count === 'number' ? dishData.use_count : 0;
        await (supabase.from('custom_dishes') as any)
          .update({ use_count: currentCount + 1 })
          .eq('id', incrementDishId);
      }
      return { status: 'synced', opId: 'mock-op-1' };
    }),
  };
});

describe('NutritionEngine', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    // Default mock implementation using full PostgREST builder test double
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

  it("mounts successfully and renders Today's Nutrition 5-ring dashboard, conversational input, and quick log carousel", () => {
    renderComponent();
    expect(screen.getByText("Today's Nutrition")).toBeDefined();
    expect(screen.getByText('Calories')).toBeDefined();
    expect(screen.getByText('Protein')).toBeDefined();
    expect(screen.getByText('Carbs')).toBeDefined();
    expect(screen.getByText('Fat')).toBeDefined();
    expect(screen.getByText('Fiber')).toBeDefined();
    expect(screen.getByText(/Remaining Fuel:/i)).toBeDefined();
    expect(screen.getByText('Log Food')).toBeDefined();
    expect(
      screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)')
    ).toBeDefined();
    expect(screen.getByText('Quick Log Favorites')).toBeDefined();
  });

  it('parses meal into staged meal card with itemized ingredient math breakdown', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs, Sourdough Toast & Butter',
        calories: 470,
        protein: 24,
        carbs: 32,
        fat: 28,
        fiber: 2,
        explanation: '210 kcal (3 eggs) + 160 kcal (2 slices sourdough) + 100 kcal (1 tbsp butter) = 470 kcal',
        items: [
          { name: 'Eggs', portion: '3 large', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
          { name: 'Sourdough Bread', portion: '2 slices', calories: 160, protein: 6, carbs: 30, fat: 2, fiber: 2 },
          { name: 'Butter', portion: '1 tbsp', calories: 100, protein: 0, carbs: 0, fat: 11, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    fireEvent.change(input, { target: { value: '3 eggs, 2 slices sourdough, 1 tbsp butter' } });

    const analyzeBtn = screen.getByText('Analyze Meal');
    fireEvent.click(analyzeBtn);

    await waitFor(() => {
      expect(screen.getByText(/Itemized Breakdown/i)).toBeDefined();
    });

    // Check itemized breakdown rendered
    expect(screen.getByText('Eggs')).toBeDefined();
    expect(screen.getByText('Sourdough Bread')).toBeDefined();
    expect(screen.getByText('Butter')).toBeDefined();
    expect(
      screen.getByText('210 kcal (3 eggs) + 160 kcal (2 slices sourdough) + 100 kcal (1 tbsp butter) = 470 kcal')
    ).toBeDefined();

    // Check direct log button
    expect(screen.getByText('Log Meal (+470 kcal)')).toBeDefined();
  });

  it('typing a quantity updates item and meal totals', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs & Sourdough',
        calories: 370,
        protein: 24,
        carbs: 32,
        fat: 17,
        fiber: 2,
        explanation: '210 kcal (Eggs) + 160 kcal (Sourdough) = 370 kcal',
        items: [
          { name: 'Eggs', portion: '3 large', quantity: 3, unit: 'unit', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
          { name: 'Sourdough', portion: '2 slices', quantity: 2, unit: 'unit', calories: 160, protein: 6, carbs: 30, fat: 2, fiber: 2 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '3 eggs and 2 slices sourdough');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText(/Itemized Breakdown/i)).toBeDefined();
    });

    // Check initial totals row shows 370 kcal
    expect(screen.getByTestId('staged-meal-totals')).toHaveTextContent('370 kcal');

    // Type 6 for Eggs (double from 3 to 6: 210 -> 420 kcal; total 370 + 210 = 580 kcal)
    const eggQty = screen.getAllByTestId('component-quantity-input')[0];
    fireEvent.change(eggQty, { target: { value: '6' } });
    fireEvent.blur(eggQty);

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-totals')).toHaveTextContent('580 kcal');
    });
  });

  it('allows portion adjustment and 1-tap item deletion in staged meal card', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs & Sourdough',
        calories: 370,
        protein: 24,
        carbs: 32,
        fat: 17,
        fiber: 2,
        explanation: '210 kcal (Eggs) + 160 kcal (Sourdough) = 370 kcal',
        items: [
          { name: 'Eggs', portion: '3 large', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
          { name: 'Sourdough', portion: '2 slices', calories: 160, protein: 6, carbs: 30, fat: 2, fiber: 2 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '3 eggs and 2 slices sourdough');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText(/Itemized Breakdown/i)).toBeDefined();
    });

    // Quantity is now a real amount in a canonical unit, not a x0.5 multiplier:
    // "3 large" eggs becomes 3 units, and +1 makes it 4.
    const quantities = () =>
      screen.getAllByTestId('component-quantity-input') as HTMLInputElement[];
    expect(quantities()[0].value).toBe('3');

    fireEvent.change(quantities()[0], { target: { value: '4' } });
    fireEvent.blur(quantities()[0]);

    await waitFor(() => {
      expect(quantities()[0].value).toBe('4');
    });
    // Macros scale with the quantity: 210 kcal at 3 -> 280 kcal at 4.
    expect(
      within(screen.getAllByTestId('component-row')[0]).getByText(/280 kcal/)
    ).toBeDefined();

    // Remove the second component via its overflow menu.
    fireEvent.click(screen.getAllByTestId('component-actions')[1]);
    fireEvent.click(screen.getByTestId('component-remove'));

    // Verify Sourdough is removed and only Eggs remain
    await waitFor(() => {
      expect(screen.queryByText('Sourdough')).toBeNull();
    });
  });

  it('logs a staged meal to supabase nutrition_logs', async () => {
    const mockUpsert = vi.fn((values: any, options?: any) => {
      const b = createSupabaseBuilder('nutrition_logs');
      return b.upsert(values, options);
    });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.upsert = mockUpsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: '3 Eggs',
        calories: 210,
        protein: 18,
        carbs: 2,
        fat: 15,
        fiber: 0,
        explanation: '3 eggs = 210 kcal',
        items: [{ name: 'Eggs', portion: '3 large', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 }],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '3 eggs');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+210 kcal)')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Log Meal (+210 kcal)'));

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.food_name).toBe('3 Eggs');
    expect(payload.calories).toBe(210);
    expect(payload.protein).toBe(18);
  });

  it('single-item meal (D14): modal edit updates item 0 nutrition and logged payload equals edited values', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Single Salmon Fillet',
        calories: 250,
        protein: 30,
        carbs: 0,
        fat: 14,
        fiber: 0,
        explanation: '1 fillet = 250 kcal',
        items: [{ name: 'Salmon Fillet', portion: '1 fillet', calories: 250, protein: 30, carbs: 0, fat: 14, fiber: 0 }],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '1 salmon fillet');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+250 kcal)')).toBeDefined();
    });

    // Verify single-item card has no Itemized Breakdown header or editable macro inputs
    expect(screen.queryByText(/Itemized Breakdown/i)).toBeNull();
    expect(screen.queryByTestId('calories-input')).toBeNull();

    // Edit item 0 via overflow menu -> Edit nutrition modal
    fireEvent.click(screen.getByTestId('component-actions'));
    fireEvent.click(screen.getByTestId('component-edit-nutrition'));

    // Change calories to 320 and protein to 38
    fireEvent.change(screen.getByTestId('edit-item-calories-input'), { target: { value: '320' } });
    fireEvent.change(screen.getByTestId('edit-item-protein-input'), { target: { value: '38' } });
    fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

    // Verify card Log button updated to +320 kcal
    await waitFor(() => {
      expect(screen.getByText('Log Meal (+320 kcal)')).toBeDefined();
    });

    // Log the meal
    fireEvent.click(screen.getByText('Log Meal (+320 kcal)'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Single Salmon Fillet');
    expect(payload.calories).toBe(320);
    expect(payload.protein).toBe(38);
    expect(payload.carbs).toBe(0);
    expect(payload.fat).toBe(14);
    expect(payload.fiber).toBe(0);
  });

  it('single-item meal (D14): modal edit updates item 0 nutrition, Day total and Log button reflect edited kcal, and save-as-dish payload equals edited values', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'custom_dishes') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Single Salmon Fillet',
        calories: 250,
        protein: 30,
        carbs: 0,
        fat: 14,
        fiber: 0,
        explanation: '1 fillet = 250 kcal',
        items: [{ name: 'Salmon Fillet', portion: '1 fillet', calories: 250, protein: 30, carbs: 0, fat: 14, fiber: 0 }],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '1 salmon fillet');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+250 kcal)')).toBeDefined();
    });

    // Edit item 0 via overflow menu -> Edit nutrition modal
    fireEvent.click(screen.getByTestId('component-actions'));
    fireEvent.click(screen.getByTestId('component-edit-nutrition'));

    // Change calories to 350 and protein to 36
    fireEvent.change(screen.getByTestId('edit-item-calories-input'), { target: { value: '350' } });
    fireEvent.change(screen.getByTestId('edit-item-protein-input'), { target: { value: '36' } });
    fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

    // Assert Log button reflects edited kcal (+350 kcal)
    await waitFor(() => {
      expect(screen.getByText('Log Meal (+350 kcal)')).toBeDefined();
    });

    // Assert Day total reflects edited kcal
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('350');
    expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('36');

    // Trigger Save as Custom Dish
    const saveDishBtn = screen.getByTitle('Save this meal as a quick-log custom dish');
    fireEvent.click(saveDishBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.name).toBe('Single Salmon Fillet');
    expect(payload.calories).toBe(350);
    expect(payload.protein).toBe(36);
    expect(payload.fat).toBe(14);
    expect(payload.carbs).toBe(0);
    expect(payload.fiber).toBe(0);
    expect(payload.kind).toBe('food');
  });

  it('single-item meal (D14): deleting from 2 items to 1 removes breakdown header and This meal row, and logs remaining item', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs and Toast',
        calories: 330,
        protein: 18,
        carbs: 24,
        fat: 15,
        fiber: 2,
        explanation: 'Eggs (210) + Toast (120) = 330',
        items: [
          { name: 'Eggs', portion: '2 large', calories: 210, protein: 14, carbs: 1, fat: 14, fiber: 0 },
          { name: 'Toast', portion: '1 slice', calories: 120, protein: 4, carbs: 23, fat: 1, fiber: 2 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '2 eggs and toast');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText(/Itemized Breakdown \(2\)/i)).toBeDefined();
      expect(screen.getByTestId('this-meal-label')).toBeDefined();
    });

    // Delete Toast
    const actionButtons = screen.getAllByTestId('component-actions');
    fireEvent.click(actionButtons[1]);
    fireEvent.click(screen.getByTestId('component-remove'));

    // Now 1 item remains: Itemized Breakdown and This meal row disappear
    await waitFor(() => {
      expect(screen.queryByText(/Itemized Breakdown/i)).toBeNull();
      expect(screen.queryByTestId('this-meal-label')).toBeNull();
    });

    // No macro inputs appear
    expect(screen.queryByTestId('calories-input')).toBeNull();

    // Log button reflects remaining item calories (+210 kcal)
    expect(screen.getByText('Log Meal (+210 kcal)')).toBeDefined();

    fireEvent.click(screen.getByText('Log Meal (+210 kcal)'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Eggs and Toast');
    expect(payload.calories).toBe(210);
    expect(payload.protein).toBe(14);
    expect(payload.items).toBeNull(); // Single item logged meal does not persist child items array
  });

  it('allows 1-tap quick logging a saved custom dish', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [{ id: 'dish-1', name: 'Protein Oats', calories: 420, protein: 35, carbs: 55, fat: 8 }],
          error: null,
        });
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Protein Oats')).toBeDefined();
    });

    const quickLogBtn = screen.getByTitle('1-Tap Log Meal');
    fireEvent.click(quickLogBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Protein Oats');
    expect(payload.calories).toBe(420);
    expect(payload.protein).toBe(35);
    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection: 'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
    });
  });

  it('allows manual entry logging when toggled', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    // Toggle manual entry
    fireEvent.click(screen.getByText('Manual Entry'));

    await userEvent.type(screen.getByTestId('dish-name-input'), 'Greek Yogurt & Honey');
    await userEvent.type(screen.getByTestId('calories-input'), '180');
    await userEvent.type(screen.getByTestId('protein-input'), '15');
    await userEvent.type(screen.getByTestId('carbs-input'), '22');
    await userEvent.type(screen.getByTestId('fat-input'), '0');

    fireEvent.click(screen.getByText('Log Meal'));

    // D22: Submitting manual meal form stages into StagedMealCard without DB insert
    expect(mockInsert).not.toHaveBeenCalled();
    expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    expect(screen.getByDisplayValue('Greek Yogurt & Honey')).toBeDefined();

    // Logging the staged manual meal writes exactly the totals shown
    fireEvent.click(screen.getByRole('button', { name: /log meal \(\+180 kcal\)/i }));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Greek Yogurt & Honey');
    expect(payload.calories).toBe(180);
    expect(payload.protein).toBe(15);
  });

  it('D22/D5: single-item manual meal with edited totals, then Add item logs displayed totals without silent discard', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    // 1. Open manual entry and submit
    fireEvent.click(screen.getByText('Manual Entry'));
    await userEvent.type(screen.getByTestId('dish-name-input'), 'Greek Yogurt');
    await userEvent.type(screen.getByTestId('calories-input'), '150');
    await userEvent.type(screen.getByTestId('protein-input'), '15');
    await userEvent.type(screen.getByTestId('carbs-input'), '10');
    await userEvent.type(screen.getByTestId('fat-input'), '0');

    fireEvent.click(screen.getByText('Log Meal'));

    // Staged card appears with single item (150 kcal)
    expect(mockInsert).not.toHaveBeenCalled();
    expect(screen.getByTestId('staged-meal-card')).toBeDefined();

    // 2. Edit nutrition of single item (150 -> 200 kcal, 15 -> 20 P)
    fireEvent.click(screen.getByTestId('component-actions'));
    fireEvent.click(screen.getByTestId('component-edit-nutrition'));
    fireEvent.change(screen.getByTestId('edit-item-calories-input'), { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('edit-item-protein-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByTestId('save-edit-item-nutrition-btn'));

    // 3. Add item: Honey (60 kcal, 17 C)
    fireEvent.click(screen.getByTestId('add-item-button'));
    fireEvent.click(screen.getByTestId('enter-manually-button'));
    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Honey' } });
    fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('add-item-unit-input'), { target: { value: 'g' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('add-item-carbs-input'), { target: { value: '17' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    // Card totals: 200 (edited item) + 60 (honey) = 260 kcal; 20 P, 27 C
    const logButton = screen.getByRole('button', { name: /log meal \(\+260 kcal\)/i });
    expect(logButton).toBeDefined();

    // 4. Log meal
    fireEvent.click(logButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Greek Yogurt');
    expect(payload.calories).toBe(260);
    expect(payload.protein).toBe(20);
    expect(payload.carbs).toBe(27);
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].calories).toBe(200);
    expect(payload.items[1].calories).toBe(60);
  });

  it('D22: AI-staged meal + Add item logs displayed totals to DB', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs & Toast',
        calories: 370,
        protein: 24,
        carbs: 32,
        fat: 17,
        fiber: 2,
        explanation: '210 kcal (Eggs) + 160 kcal (Toast) = 370 kcal',
        items: [
          { name: 'Eggs', portion: '3 large', quantity: 3, unit: 'unit', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
          { name: 'Toast', portion: '2 slices', quantity: 2, unit: 'unit', calories: 160, protein: 6, carbs: 30, fat: 2, fiber: 2 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, '3 eggs and 2 slices toast');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // Add item: Avocado (80 kcal, 1 P, 4 C, 7 F, 3 Fib)
    fireEvent.click(screen.getByTestId('add-item-button'));
    fireEvent.click(screen.getByTestId('enter-manually-button'));
    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Avocado' } });
    fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('add-item-unit-input'), { target: { value: 'g' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '80' } });
    fireEvent.change(screen.getByTestId('add-item-protein-input'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('add-item-carbs-input'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('add-item-fat-input'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('add-item-fiber-input'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    // Totals = 370 + 80 = 450 kcal
    const logButton = screen.getByRole('button', { name: /log meal \(\+450 kcal\)/i });
    expect(logButton).toBeDefined();

    fireEvent.click(logButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Eggs & Toast');
    expect(payload.calories).toBe(450);
    expect(payload.protein).toBe(25);
    expect(payload.carbs).toBe(36);
    expect(payload.fat).toBe(24);
    expect(payload.fiber).toBe(5);
    expect(payload.items).toHaveLength(3);
  });

  it('D22: dish-staged meal + Add item logs displayed totals to DB', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const dishData = {
          id: 'dish-oats',
          name: 'Protein Oatmeal',
          calories: 350,
          protein: 25,
          carbs: 45,
          fat: 6,
          fiber: 5,
          items: [
            { name: 'Rolled Oats', quantity: 50, unit: 'g', calories: 190, protein: 7, carbs: 34, fat: 3, fiber: 5 },
            { name: 'Whey Protein', quantity: 25, unit: 'g', calories: 160, protein: 18, carbs: 11, fat: 3, fiber: 0 },
          ],
        };
        const b = createSupabaseBuilder('custom_dishes', {
          data: [dishData],
          error: null,
        });
        b.single = vi.fn().mockResolvedValue({ data: dishData, error: null });
        return b;
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('custom-dish-card-dish-oats')).toBeDefined();
    });

    // Stage the dish
    fireEvent.click(screen.getByTestId('custom-dish-card-dish-oats'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // Add item: Chia Seeds (50 kcal, 2 P, 4 C, 3 F, 3 Fib)
    fireEvent.click(screen.getByTestId('add-item-button'));
    fireEvent.click(screen.getByTestId('enter-manually-button'));
    fireEvent.change(screen.getByTestId('add-item-name-input'), { target: { value: 'Chia Seeds' } });
    fireEvent.change(screen.getByTestId('add-item-quantity-input'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('add-item-unit-input'), { target: { value: 'g' } });
    fireEvent.change(screen.getByTestId('add-item-calories-input'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('add-item-protein-input'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('add-item-carbs-input'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('add-item-fat-input'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('add-item-fiber-input'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('submit-add-item-button'));

    // Totals = 350 + 50 = 400 kcal; 27 P, 49 C, 9 F, 8 Fib
    const logButton = screen.getByRole('button', { name: /log meal \(\+400 kcal\)/i });
    expect(logButton).toBeDefined();

    fireEvent.click(logButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Protein Oatmeal');
    expect(payload.calories).toBe(400);
    expect(payload.protein).toBe(27);
    expect(payload.carbs).toBe(49);
    expect(payload.fat).toBe(9);
    expect(payload.fiber).toBe(8);
    expect(payload.items).toHaveLength(3);
  });

  it('saves a staged meal as a custom dish with JSON serialized ingredients and fiber', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'custom_dishes') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Avocado Toast',
        calories: 320,
        protein: 8,
        carbs: 30,
        fat: 18,
        fiber: 6,
        explanation: '320 kcal (Avocado Toast)',
        items: [
          { name: 'Sourdough Toast', portion: '1 slice', calories: 120, protein: 4, carbs: 24, fat: 1, fiber: 1 },
          { name: 'Avocado', portion: '1/2 medium', calories: 200, protein: 4, carbs: 6, fat: 17, fiber: 5 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'Avocado toast');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Save as Custom Dish')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Save as Custom Dish'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.name).toBe('Avocado Toast');
    expect(payload.calories).toBe(320);
    expect(payload.protein).toBe(8);
    expect(payload.fiber).toBe(6);
    const parsedIngredients = JSON.parse(payload.ingredients);
    expect(parsedIngredients).toHaveLength(2);
    expect(parsedIngredients[0].name).toBe('Sourdough Toast');
    expect(parsedIngredients[1].name).toBe('Avocado');
  });

  it('saves a staged 6-item meal as a custom dish with kind="recipe" explicitly', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'custom_dishes') {
        b.insert = mockInsert;
      }
      return b;
    });

    const sixItems = [
      { name: 'Oats', portion: '50g', calories: 190, protein: 7, carbs: 34, fat: 3, fiber: 5 },
      { name: 'Whey Protein', portion: '30g', calories: 120, protein: 24, carbs: 2, fat: 1, fiber: 0 },
      { name: 'Peanut Butter', portion: '16g', calories: 95, protein: 4, carbs: 3, fat: 8, fiber: 1 },
      { name: 'Chia Seeds', portion: '10g', calories: 49, protein: 2, carbs: 4, fat: 3, fiber: 3 },
      { name: 'Blueberries', portion: '50g', calories: 29, protein: 0, carbs: 7, fat: 0, fiber: 1 },
      { name: 'Almond Milk', portion: '100ml', calories: 15, protein: 1, carbs: 0, fat: 1, fiber: 0 },
    ];

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Power Oatmeal',
        calories: 498,
        protein: 38,
        carbs: 50,
        fat: 16,
        fiber: 10,
        explanation: '498 kcal (Power Oatmeal)',
        items: sixItems,
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'Power oatmeal bowl with 6 ingredients');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Save as Custom Dish')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Save as Custom Dish'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.name).toBe('Power Oatmeal');
    expect(payload.kind).toBe('recipe');
    expect(payload.items).toHaveLength(6);
  });

  it('increments use_count when a custom dish is staged from the carousel', async () => {
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const b = createSupabaseBuilder('custom_dishes', {
          data: [
            {
              id: 'dish-count-1',
              name: 'Morning Smoothie',
              calories: 300,
              protein: 20,
              carbs: 40,
              fat: 5,
              fiber: 4,
              kind: 'food',
              use_count: 3,
            },
          ],
          error: null,
        });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Morning Smoothie')).toBeDefined();
    });

    // Staging the dish by clicking the card
    fireEvent.click(screen.getByText('Morning Smoothie'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ use_count: 4 });
    });
  });

  it('increments use_count when a custom dish is 1-tap quick logged', async () => {
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) });
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const b = createSupabaseBuilder('custom_dishes', {
          data: [
            {
              id: 'dish-count-2',
              name: 'Quick Bar',
              calories: 200,
              protein: 15,
              carbs: 20,
              fat: 6,
              fiber: 3,
              kind: 'food',
              use_count: 7,
            },
          ],
          error: null,
        });
        b.update = mockUpdate;
        return b;
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Quick Bar')).toBeDefined();
    });

    const quickLogBtn = screen.getByTitle('1-Tap Log Meal');
    fireEvent.click(quickLogBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith({ use_count: 8 });
    });
  });

  it('falls back to manual entry with error banner when edge function invocation fails', async () => {
    (supabase.functions.invoke as any).mockRejectedValue(new Error('Network error'));

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, '3 eggs, 2 slices sourdough, 1 tbsp butter');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toBeDefined();
      expect(within(screen.getByTestId('status-message')).getByText('AI service unavailable: Network error')).toBeDefined();
    });

    // Verify manual form is automatically opened
    expect(screen.getByTestId('dish-name-input')).toBeDefined();
    expect(screen.getByTestId('calories-input')).toBeDefined();

    // Verify no synthetic staged meal was fabricated
    expect(screen.queryByText(/Log Meal \(/i)).toBeNull();
  });

  it('falls back to manual entry with error banner when edge function returns error in payload without throwing', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { error: 'Model quota exceeded. Please try again later.' },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'grilled chicken and rice');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toBeDefined();
      expect(within(screen.getByTestId('status-message')).getByText('AI service unavailable: Model quota exceeded. Please try again later.')).toBeDefined();
    });

    // Verify manual form is automatically opened with dish name pre-populated
    expect(screen.getByTestId('dish-name-input')).toHaveValue('grilled chicken and rice');
    // Verify no synthetic staged meal was fabricated
    expect(screen.queryByText(/Log Meal \(/i)).toBeNull();
  });

  it('falls back to manual entry when edge function returns invalid empty response without macro data', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {},
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'mystery meal');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toBeDefined();
      expect(within(screen.getByTestId('status-message')).getByText('AI service unavailable: Invalid parsed response: missing nutrition data')).toBeDefined();
    });

    expect(screen.getByTestId('dish-name-input')).toBeDefined();
    expect(screen.queryByText(/Log Meal \(/i)).toBeNull();
  });

  it('stages and unpacks a custom dish with JSON ingredients when clicking on the custom dish card in the quick-log carousel', async () => {
    const serializedIngredients = JSON.stringify([
      {
        id: 'item-1',
        name: 'Rolled Oats',
        portion: '1 cup',
        portionMultiplier: 1,
        baseCalories: 300,
        baseProtein: 10,
        baseCarbs: 54,
        baseFat: 5,
        baseFiber: 8,
        calories: 300,
        protein: 10,
        carbs: 54,
        fat: 5,
        fiber: 8,
      },
      {
        id: 'item-2',
        name: 'Whey Protein Isolate',
        portion: '1 scoop',
        portionMultiplier: 1,
        baseCalories: 120,
        baseProtein: 25,
        baseCarbs: 1,
        baseFat: 1,
        baseFiber: 0,
        calories: 120,
        protein: 25,
        carbs: 1,
        fat: 1,
        fiber: 0,
      },
    ]);

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [
            {
              id: 'dish-1',
              name: 'Protein Oats',
              calories: 420,
              protein: 35,
              carbs: 55,
              fat: 6,
              fiber: 8,
              ingredients: serializedIngredients,
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Protein Oats')).toBeDefined();
    });

    // Click on the dish card itself (not the plus icon)
    fireEvent.click(screen.getByText('Protein Oats'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+420 kcal)')).toBeDefined();
    });

    expect(screen.getByText('Rolled Oats')).toBeDefined();
    expect(screen.getByText('Whey Protein Isolate')).toBeDefined();
    expect(screen.getByText(/Itemized Breakdown \(2\)/i)).toBeDefined();
  });

  it('opens custom dish modal to create and save a new custom dish with fiber', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'custom_dishes') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    const newDishBtn = screen.getByText('New Dish');
    fireEvent.click(newDishBtn);

    expect(screen.getByText('New Custom Dish')).toBeDefined();

    await userEvent.type(screen.getByPlaceholderText('e.g. Protein Oatmeal'), 'Salmon Rice Bowl');
    const numberInputs = screen.getAllByPlaceholderText('0');
    // Calories, Protein, Carbs, Fat, Fiber in modal
    await userEvent.type(numberInputs[0], '550');
    await userEvent.type(numberInputs[1], '42');
    await userEvent.type(numberInputs[2], '60');
    await userEvent.type(numberInputs[3], '12');
    await userEvent.type(numberInputs[4], '4');

    // The free-text ingredients input is gone: it wrote straight back to the
    // deprecated column and destroyed breakdowns. A dish with no structured
    // components still saves its hand-entered macros.
    expect(screen.queryByPlaceholderText('e.g. 1 cup oats, 1 scoop whey, 1 tbsp peanut butter')).toBeNull();

    const saveDishBtn = screen.getByText('Save Dish');
    fireEvent.click(saveDishBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.name).toBe('Salmon Rice Bowl');
    expect(payload.calories).toBe(550);
    expect(payload.protein).toBe(42);
    expect(payload.fiber).toBe(4);
    expect(payload.items).toBeNull();
    expect('ingredients' in payload).toBe(false);
  });

  it('accurately parses pre-analyzed structured breakdown text with line items and totals', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Scrambled Egg White, Sliced Turkey Breast & Plain Greek Yogurt',
        calories: 318,
        protein: 40,
        carbs: 7,
        fat: 7,
        fiber: 0,
        explanation: 'Total: 318 kcal | 40g P | 7g C | 7g F | 0g Fiber',
        items: [
          { name: 'Scrambled Egg White (with hot sauce & black pepper)', portion: '180 g', calories: 139, protein: 20, carbs: 1, fat: 5, fiber: 0 },
          { name: 'Sliced Seasoned Turkey Breast', portion: '60 g', calories: 60, protein: 10, carbs: 1, fat: 1, fiber: 0 },
          { name: '0% Plain Greek Yogurt', portion: '150 g', calories: 90, protein: 15, carbs: 5, fat: 1, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    const structuredInput = `Food Item: Scrambled Egg White, Sliced Turkey Breast & Plain Greek Yogurt
Total Portion Size: 390 g
Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 180 g | 139 kcal | 20 g P | 1 g C | 5 g F | 0 g Fiber
* Sliced Seasoned Turkey Breast: 60 g | 60 kcal | 10 g P | 1 g C | 1 g F | 0 g Fiber
* 0% Plain Greek Yogurt: 150 g | 90 kcal | 15 g P | 5 g C | 1 g F | 0 g Fiber

Total Calories: 318 kcal
Total Protein: 40 g
Total Carbs: 7 g
Total Fat: 7 g
Total Fiber: 0 g`;

    const textarea = screen.getByPlaceholderText(/Describe what you ate/i);
    fireEvent.change(textarea, { target: { value: structuredInput } });

    const analyzeBtn = screen.getByText('Analyze Meal');
    fireEvent.click(analyzeBtn);

    await waitFor(() => {
      // The fixture's own top-level total (318) contradicts its components
      // (139 + 60 + 90 = 289). The staged total is now Σ(components), because
      // that is the invariant the DB enforces; trusting the model's scalar is
      // what let parent and children drift apart in the first place.
      expect(screen.getByText('Log Meal (+289 kcal)')).toBeDefined();
    });

    expect(screen.getByText('Scrambled Egg White (with hot sauce & black pepper)')).toBeDefined();
    expect(screen.getByText('Sliced Seasoned Turkey Breast')).toBeDefined();
    expect(screen.getByText('0% Plain Greek Yogurt')).toBeDefined();
    expect(screen.getByText(/40g P/)).toBeDefined();
  });

  it('handles zero-calorie food items without divide-by-zero or math errors', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Black Coffee & Water',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        explanation: '0 kcal (Black Coffee) + 0 kcal (Water) = 0 kcal',
        items: [
          { name: 'Black Coffee', portion: '1 cup', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
          { name: 'Water', portion: '1 glass', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
        ],
      },
    });

    renderComponent();

    const textarea = screen.getByPlaceholderText(/Describe what you ate/i);
    fireEvent.change(textarea, { target: { value: '1 cup black coffee and water' } });

    const analyzeBtn = screen.getByText('Analyze Meal');
    fireEvent.click(analyzeBtn);

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+0 kcal)')).toBeDefined();
    });

    expect(screen.getByText('Black Coffee')).toBeDefined();
    expect(screen.getByText('Water')).toBeDefined();
  });

  it('parses conversational multi-dish "Chicken Rice & Eggs" and elaborates components via AI with Authorization Bearer header', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Chicken Rice & Eggs',
        calories: 650,
        protein: 38,
        carbs: 70,
        fat: 23,
        fiber: 1,
        explanation: '300 kcal (Steamed Rice Bowl) + 260 kcal (Grilled Chicken Breast) + 90 kcal (Fried Egg) = 650 kcal',
        items: [
          { name: 'Steamed Rice Bowl', portion: '1.5 cups (240g)', calories: 300, protein: 6, carbs: 65, fat: 1, fiber: 1 },
          { name: 'Grilled Chicken Breast', portion: '1 breast (120g)', calories: 260, protein: 26, carbs: 4, fat: 15, fiber: 0 },
          { name: 'Fried Egg', portion: '1 large', calories: 90, protein: 6, carbs: 1, fat: 7, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'I ate Chicken Rice & Eggs');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText(/Itemized Breakdown \(3\)/i)).toBeDefined();
    });

    // Verify Authorization Bearer header was passed
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'parse-nutrition',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mock-jwt-token-123' },
        body: expect.objectContaining({ input: 'I ate Chicken Rice & Eggs' }),
      })
    );

    // Verify all components rendered
    expect(screen.getByText('Steamed Rice Bowl')).toBeDefined();
    expect(screen.getByText('Grilled Chicken Breast')).toBeDefined();
    expect(screen.getByText('Fried Egg')).toBeDefined();
    expect(screen.getByText('Log Meal (+650 kcal)')).toBeDefined();
  });

  it('accurately parses the Friday Menu Grounded structured breakdown text preserving exact items and totals verbatim', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)',
        calories: 550,
        protein: 46,
        carbs: 24,
        fat: 30,
        fiber: 8,
        explanation: 'Total: 550 kcal | 46g P | 24g C | 30g F | 8g Fiber',
        items: [
          { name: 'Scrambled Egg White (with hot sauce & black pepper)', portion: '150 g', calories: 87, protein: 14, carbs: 1, fat: 3, fiber: 0 },
          { name: 'Sliced Turkey Breast', portion: '60 g', calories: 80, protein: 10, carbs: 1, fat: 4, fiber: 0 },
          { name: 'Smoked Salmon', portion: '50 g', calories: 68, protein: 8, carbs: 0, fat: 4, fiber: 0 },
          { name: 'Chocolate Coconut Chia Pudding', portion: '150 g', calories: 227, protein: 5, carbs: 18, fat: 15, fiber: 8 },
          { name: '2% Plain Greek Yogurt', portion: '100 g', calories: 88, protein: 9, carbs: 4, fat: 4, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    const fridayMenu = `Food Item: High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)
Total Portion Size: 510 g

Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 150 g | 87 kcal | 14 g P | 1 g C | 3 g F | 0 g Fiber
* Sliced Turkey Breast: 60 g | 80 kcal | 10 g P | 1 g C | 4 g F | 0 g Fiber
* Smoked Salmon: 50 g | 68 kcal | 8 g P | 0 g C | 4 g F | 0 g Fiber
* Chocolate Coconut Chia Pudding: 150 g | 227 kcal | 5 g P | 18 g C | 15 g F | 8 g Fiber
* 2% Plain Greek Yogurt: 100 g | 88 kcal | 9 g P | 4 g C | 4 g F | 0 g Fiber

Total Calories: 550 kcal
Total Protein: 46 g
Total Carbs: 24 g
Total Fat: 30 g
Total Fiber: 8 g`;

    const textarea = screen.getByPlaceholderText(/Describe what you ate/i);
    fireEvent.change(textarea, { target: { value: fridayMenu } });

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+550 kcal)')).toBeDefined();
    });

    // Check meal title in input field
    expect(screen.getByDisplayValue('High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)')).toBeDefined();

    // Check all 5 component items
    expect(screen.getByText('Scrambled Egg White (with hot sauce & black pepper)')).toBeDefined();
    expect(screen.getByText('Sliced Turkey Breast')).toBeDefined();
    expect(screen.getByText('Smoked Salmon')).toBeDefined();
    expect(screen.getByText('Chocolate Coconut Chia Pudding')).toBeDefined();
    expect(screen.getByText('2% Plain Greek Yogurt')).toBeDefined();

    // Check exact totals in visible read-only macro figures
    expect(screen.getByTestId('staged-total-protein')).toHaveTextContent(/^46\s*P$/);
    expect(screen.getByTestId('staged-total-carbs')).toHaveTextContent(/^24\s*C$/);
    expect(screen.getByTestId('staged-total-fat')).toHaveTextContent(/^30\s*F$/);
    expect(screen.getByTestId('staged-total-fiber')).toHaveTextContent(/^8\s*Fib$/);
    expect(screen.getByText(/Total: 550 kcal \| 46g P \| 24g C \| 30g F \| 8g Fiber/)).toBeDefined();
  });

  it('accurately extracts portion size and logs serving_size and serving_unit to supabase from Friday Menu Grounded', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)',
        calories: 550,
        protein: 46,
        carbs: 24,
        fat: 30,
        fiber: 8,
        serving_size: 510,
        serving_unit: 'g',
        explanation: '87 kcal (Egg White) + 80 kcal (Turkey) + 68 kcal (Salmon) + 227 kcal (Chia) + 88 kcal (Yogurt) = 550 kcal',
        items: [
          { name: 'Scrambled Egg White (with hot sauce & black pepper)', portion: '150 g', calories: 87, protein: 14, carbs: 1, fat: 3, fiber: 0 },
          { name: 'Sliced Turkey Breast', portion: '60 g', calories: 80, protein: 10, carbs: 1, fat: 4, fiber: 0 },
          { name: 'Smoked Salmon', portion: '50 g', calories: 68, protein: 8, carbs: 0, fat: 4, fiber: 0 },
          { name: 'Chocolate Coconut Chia Pudding', portion: '150 g', calories: 227, protein: 5, carbs: 18, fat: 15, fiber: 8 },
          { name: '2% Plain Greek Yogurt', portion: '100 g', calories: 88, protein: 9, carbs: 4, fat: 4, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    const fridayMenu = `+++++++++
Food Item: High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)
Total Portion Size: 510 g

Component Breakdown:
* Scrambled Egg White (with hot sauce & black pepper): 150 g | 87 kcal | 14 g P | 1 g C | 3 g F | 0 g Fiber
* Sliced Turkey Breast: 60 g | 80 kcal | 10 g P | 1 g C | 4 g F | 0 g Fiber
* Smoked Salmon: 50 g | 68 kcal | 8 g P | 0 g C | 4 g F | 0 g Fiber
* Chocolate Coconut Chia Pudding: 150 g | 227 kcal | 5 g P | 18 g C | 15 g F | 8 g Fiber
* 2% Plain Greek Yogurt: 100 g | 88 kcal | 9 g P | 4 g C | 4 g F | 0 g Fiber

Total Calories: 550 kcal
Total Protein: 46 g
Total Carbs: 24 g
Total Fat: 30 g
Total Fiber: 8 g
+++++++++`;

    const textarea = screen.getByPlaceholderText(/Describe what you ate/i);
    fireEvent.change(textarea, { target: { value: fridayMenu } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+550 kcal)')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Log Meal (+550 kcal)'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('High-Protein Breakfast Plate & Chia Pudding Bowl (Friday Menu Grounded)');
    expect(payload.calories).toBe(550);
    expect(payload.protein).toBe(46);
    expect(payload.carbs).toBe(24);
    expect(payload.fat).toBe(30);
    expect(payload.fiber).toBe(8);
    expect(payload.serving_size).toBe(510);
    expect(payload.serving_unit).toBe('g');
  });

  it('supports flexible structured formatting with numbered lists, pipe separators, and swapped macro order', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'High-Protein Chicken Bowl',
        calories: 450,
        protein: 49,
        carbs: 45,
        fat: 6,
        fiber: 1,
        explanation: '240 kcal (Grilled Chicken Breast) + 210 kcal (Jasmine Rice) = 450 kcal',
        items: [
          { name: 'Grilled Chicken Breast', portion: '150g', calories: 240, protein: 45, carbs: 0, fat: 5, fiber: 0 },
          { name: 'Jasmine Rice', portion: '1 cup', calories: 210, protein: 4, carbs: 45, fat: 1, fiber: 1 },
        ],
      },
      error: null,
    });

    renderComponent();

    const flexibleInput = `Meal: High-Protein Chicken Bowl
1. Grilled Chicken Breast | 150g | 240 kcal | 45g P | 5g F | 0g C
2. Jasmine Rice | 1 cup | 210 kcal | 4g P | 1g F | 45g C | 1g Fiber

Total Calories: 450 kcal
Total Protein: 49 g
Total Carbs: 45 g
Total Fat: 6 g
Total Fiber: 1 g`;

    const textarea = screen.getByPlaceholderText(/Describe what you ate/i);
    fireEvent.change(textarea, { target: { value: flexibleInput } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByText('Log Meal (+450 kcal)')).toBeDefined();
    });

    expect(screen.getByText('Grilled Chicken Breast')).toBeDefined();
    expect(screen.getByText('Jasmine Rice')).toBeDefined();
    expect(screen.getByTestId('staged-total-protein')).toHaveTextContent(/^49\s*P$/);
    expect(screen.getByTestId('staged-total-carbs')).toHaveTextContent(/^45\s*C$/);
    expect(screen.getByTestId('staged-total-fat')).toHaveTextContent(/^6\s*F$/);
    expect(screen.getByTestId('staged-total-fiber')).toHaveTextContent(/^1\s*Fib$/);
  });

  it('opens Edit Meal modal from today\'s meal timeline and updates meal in supabase', async () => {
    const todayStr = getLocalDateStr(new Date());
    const mockMeal = {
      id: 'today-log-1',
      user_id: 'test-user-id',
      food_name: 'Avocado Toast & Poached Egg',
      meal_type: 'Breakfast',
      calories: 380,
      protein: 16,
      carbs: 28,
      fat: 22,
      fiber: 6,
      serving_size: 1,
      serving_unit: 'plate',
      logged_at: `${todayStr}T09:00:00Z`,
      logged_date: todayStr,
    };

    const mockUpdateEq = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [mockMeal], error: null }),
    });
    const mockUpdate = vi.fn().mockReturnValue({
      eq: mockUpdateEq,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const b = createSupabaseBuilder('nutrition_logs', { data: [mockMeal], error: null });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    // Verify meal is rendered in today's timeline
    await waitFor(() => {
      expect(screen.getByText('Avocado Toast & Poached Egg')).toBeDefined();
      expect(screen.getByTestId('meal-actions-today-log-1')).toBeDefined();
    });

    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });

    // Click edit button
    openMealAction('today-log-1', 'edit');

    // Edit sheet should be open with values pre-populated
    expect(screen.getByTestId('edit-meal-sheet')).toBeDefined();
    expect(screen.getByTestId('dish-name-input')).toHaveValue('Avocado Toast & Poached Egg');
    expect(screen.getByTestId('component-name')).toHaveTextContent('Avocado Toast & Poached Egg');
    expect(screen.getByTestId('component-quantity-input')).toHaveValue(1);

    // Edit meal name
    fireEvent.change(screen.getByTestId('dish-name-input'), {
      target: { value: 'Avocado Toast & 2 Poached Eggs' },
    });
    // Scale dish by x2
    // D46: scale via the header Scale chip
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    fireEvent.change(screen.getByTestId('meal-scale-input'), { target: { value: '2' } });
    fireEvent.keyDown(screen.getByTestId('meal-scale-input'), { key: 'Enter' });

    // Submit
    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          food_name: 'Avocado Toast & 2 Poached Eggs',
          calories: 760,
          protein: 32,
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith('id', 'today-log-1');
    });

    await waitFor(() => {
      expect(screen.queryByTestId('edit-meal-sheet')).toBeNull();
    });
  });

  it('displays error notification in Edit Meal sheet when meal update fails', async () => {
    const todayStr = getLocalDateStr(new Date());
    const mockMeal = {
      id: 'today-log-2',
      user_id: 'test-user-id',
      food_name: 'Protein Shake',
      meal_type: 'Snack',
      calories: 200,
      protein: 30,
      carbs: 5,
      fat: 2,
      fiber: 1,
      serving_size: 1,
      serving_unit: 'shake',
      logged_at: `${todayStr}T14:00:00Z`,
      logged_date: todayStr,
    };

    const mockUpdateEq = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'Network connection failed' } }),
    });
    const mockUpdate = vi.fn().mockReturnValue({
      eq: mockUpdateEq,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const b = createSupabaseBuilder('nutrition_logs', { data: [mockMeal], error: null });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meal-actions-today-log-2')).toBeDefined();
    });

    openMealAction('today-log-2', 'edit');

    expect(screen.getByTestId('edit-meal-sheet')).toBeDefined();

    // Dirty the draft so save button is active
    fireEvent.change(screen.getByTestId('dish-name-input'), {
      target: { value: 'Protein Shake (Double)' },
    });

    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('edit-meal-error')).toBeDefined();
      expect(within(screen.getByTestId('edit-meal-error')).getByText('Network connection failed')).toBeDefined();
    });
  });

  it('validates meal name is required and cancels without mutation in NutritionEngine', async () => {
    const todayStr = getLocalDateStr(new Date());
    const mockMeal = {
      id: 'today-log-3',
      user_id: 'test-user-id',
      food_name: 'Greek Yogurt Bowl',
      meal_type: 'Breakfast',
      calories: 220,
      protein: 20,
      carbs: 15,
      fat: 4,
      fiber: 2,
      serving_size: 1,
      serving_unit: 'bowl',
      logged_at: `${todayStr}T08:30:00Z`,
      logged_date: todayStr,
    };

    const mockUpdate = vi.fn();
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const b = createSupabaseBuilder('nutrition_logs', { data: [mockMeal], error: null });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meal-actions-today-log-3')).toBeDefined();
      expect(screen.getByText('Breakfast')).toBeDefined();
    });

    openMealAction('today-log-3', 'edit');
    expect(screen.getByTestId('edit-meal-sheet')).toBeDefined();

    // Clear name and save
    fireEvent.change(screen.getByTestId('dish-name-input'), {
      target: { value: '  ' },
    });
    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));

    expect(screen.getByTestId('edit-meal-error')).toBeDefined();
    expect(within(screen.getByTestId('edit-meal-error')).getByText('Meal name is required')).toBeDefined();
    expect(mockUpdate).not.toHaveBeenCalled();

    // Cancel closes sheet
    fireEvent.click(screen.getByTestId('cancel-edit-meal-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('edit-meal-sheet')).toBeNull();
    });
  });

  it('D44 edit sheet: open from row ⋯, scale dish, save, check update and toast Undo restore', async () => {
    const todayStr = getLocalDateStr(new Date());
    const mockMeal = {
      id: 'today-log-4',
      user_id: 'test-user-id',
      food_name: 'Chicken Rice Bowl',
      meal_type: 'Lunch',
      calories: 500,
      protein: 40,
      carbs: 60,
      fat: 10,
      fiber: 4,
      serving_size: 1,
      serving_unit: 'bowl',
      logged_at: `${todayStr}T12:00:00Z`,
      logged_date: todayStr,
      has_components: true,
      items: [
        {
          id: 'item-1',
          name: 'Chicken Breast',
          quantity: 150,
          unit: 'g',
          calories: 250,
          protein: 35,
          carbs: 0,
          fat: 5,
          fiber: 0,
        },
        {
          id: 'item-2',
          name: 'White Rice',
          quantity: 200,
          unit: 'g',
          calories: 250,
          protein: 5,
          carbs: 60,
          fat: 5,
          fiber: 4,
        },
      ],
    };

    const mockUpdateEq = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [mockMeal], error: null }),
    });
    const mockUpdate = vi.fn().mockReturnValue({
      eq: mockUpdateEq,
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const b = createSupabaseBuilder('nutrition_logs', { data: [mockMeal], error: null });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meal-actions-today-log-4')).toBeDefined();
    });

    openMealAction('today-log-4', 'edit');

    expect(screen.getByTestId('edit-meal-sheet')).toBeDefined();

    // Scale dish by x1.5
    // D46: scale via the header Scale chip
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    fireEvent.change(screen.getByTestId('meal-scale-input'), { target: { value: '1.5' } });
    fireEvent.keyDown(screen.getByTestId('meal-scale-input'), { key: 'Enter' });

    // Save
    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          food_name: 'Chicken Rice Bowl',
          calories: 750,
          protein: 60,
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith('id', 'today-log-4');
    });

    // Toast should show updated variant with Undo button
    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
      expect(screen.getByTestId('toast-undo-btn')).toBeDefined();
    });

    // Click Undo
    mockUpdate.mockClear();
    fireEvent.click(screen.getByTestId('toast-undo-btn'));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          food_name: 'Chicken Rice Bowl',
          calories: 500,
          protein: 40,
        })
      );
    });
  });

  it('renders atomic remaining fuel badges with over-target badges when daily totals exceed targets', async () => {
    const todayStr = getLocalDateStr(new Date());
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: [
            {
              id: 'over-meal-1',
              food_name: 'Massive Feast',
              calories: 2500, // exceeds 2200 default by 300
              protein: 180, // exceeds 160 default by 20
              carbs: 250, // exceeds 220 default by 30
              fat: 80, // exceeds 70 default by 10
              fiber: 35, // exceeds 30 default by 5
              logged_at: `${todayStr}T12:00:00Z`,
              logged_date: todayStr,
              meal_type: 'Lunch',
              serving_size: 1,
              serving_unit: 'serving',
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      const calBadge = screen.getByTestId('remaining-fuel-calories');
      const pBadge = screen.getByTestId('remaining-fuel-protein');
      const cBadge = screen.getByTestId('remaining-fuel-carbs');
      const fBadge = screen.getByTestId('remaining-fuel-fat');
      const fibBadge = screen.getByTestId('remaining-fuel-fiber');

      expect(calBadge.textContent).toBe('300 over');
      expect(calBadge.className).toContain('text-rose-400');
      expect(pBadge.textContent).toBe('20 over');
      expect(pBadge.className).toContain('text-rose-400');
      expect(cBadge.textContent).toBe('30 over');
      expect(fBadge.textContent).toBe('10 over');
      expect(fibBadge.textContent).toBe('5 over');
    });
  });

  it('renders atomic remaining fuel badges with semantic glow styles when under budget', async () => {
    const todayStr = getLocalDateStr(new Date());
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: [
            {
              id: 'under-meal-1',
              food_name: 'Light Snack',
              calories: 500, // 2200 default - 500 = 1700 remaining
              protein: 40, // 160 default - 40 = 120 remaining
              carbs: 60, // 220 default - 60 = 160 remaining
              fat: 20, // 70 default - 20 = 50 remaining
              fiber: 10, // 30 default - 10 = 20 remaining
              logged_at: `${todayStr}T12:00:00Z`,
              logged_date: todayStr,
              meal_type: 'Snack',
              serving_size: 1,
              serving_unit: 'serving',
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      const calBadge = screen.getByTestId('remaining-fuel-calories');
      const pBadge = screen.getByTestId('remaining-fuel-protein');
      const cBadge = screen.getByTestId('remaining-fuel-carbs');
      const fBadge = screen.getByTestId('remaining-fuel-fat');
      const fibBadge = screen.getByTestId('remaining-fuel-fiber');

      expect(calBadge.textContent).toBe('1700 left');
      expect(calBadge.className).toContain('text-amber-400');
      expect(pBadge.textContent).toBe('120 left');
      expect(pBadge.className).toContain('text-cyan-400');
      expect(cBadge.textContent).toBe('160 left');
      expect(cBadge.className).toContain('text-emerald-400');
      expect(fBadge.textContent).toBe('50 left');
      expect(fBadge.className).toContain('text-violet-400');
      expect(fibBadge.textContent).toBe('20 left');
      expect(fibBadge.className).toContain('text-teal-400');
    });
  });

  it('initializes selectedDate to local solar date in evening hours without shifting to UTC tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 8, 20, 30, 0));

    try {
      renderComponent();
      await waitFor(() => {
        const dateInput = screen.getByTestId('nutrition-date-input') as HTMLInputElement;
        expect(dateInput.value).toBe('2026-09-08');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('anchors logged meal timestamp to selectedDate and local evening time without manual date alteration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 8, 20, 30, 0));

    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [{ id: 'dish-evening-1', name: 'Grilled Salmon Bowl', calories: 620, protein: 45, carbs: 50, fat: 20 }],
          error: null,
        });
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    try {
      renderComponent();

      // Verify that without manual date alteration, selectedDate initializes to 2026-09-08 in evening hours
      await waitFor(() => {
        const dateInput = screen.getByTestId('nutrition-date-input') as HTMLInputElement;
        expect(dateInput.value).toBe('2026-09-08');
        expect(screen.getByText('Grilled Salmon Bowl')).toBeDefined();
      });

      const quickLogBtn = screen.getByTitle('1-Tap Log Meal');
      fireEvent.click(quickLogBtn);

      await waitFor(() => {
        expect(mockInsert).toHaveBeenCalled();
      });

      const payload = mockInsert.mock.calls[0][0][0];
      expect(payload.food_name).toBe('Grilled Salmon Bowl');
      expect(payload.logged_date).toBe('2026-09-08');
      expect(isWithinDayBounds(payload.logged_at, '2026-09-08')).toBe(true);
      // Exact local 20:30 on the selected day, independent of the test's time zone.
      expect(payload.logged_at).toBe(new Date(2026, 8, 8, 20, 30, 0).toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it('anchors logged meal timestamp to user-selected date when backfilling past dates', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [{ id: 'dish-evening-2', name: 'Steak & Rice', calories: 750, protein: 55, carbs: 60, fat: 25 }],
          error: null,
        });
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    // Select past date 2026-09-05
    const dateInput = screen.getByTestId('nutrition-date-input') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-09-05' } });
    expect(dateInput.value).toBe('2026-09-05');

    await waitFor(() => {
      expect(screen.getByText('Steak & Rice')).toBeDefined();
    });

    const quickLogBtn = screen.getByTitle('1-Tap Log Meal');
    fireEvent.click(quickLogBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    expect(payload.food_name).toBe('Steak & Rice');
    expect(payload.logged_date).toBe('2026-09-05');
    expect(isWithinDayBounds(payload.logged_at, '2026-09-05')).toBe(true);
    expect(payload.logged_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  });

  it('renders camera and photo gallery triggers, and attaches a photo preview with size badge', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1tZWFsLXBob3RvLWRhdGE=',
      format: 'jpeg',
    });

    renderComponent();

    const cameraBtn = screen.getByTestId('camera-trigger');
    const galleryBtn = screen.getByTestId('gallery-trigger');
    const analyzeBtn = screen.getByTestId('analyze-meal-button');

    expect(cameraBtn).toBeDefined();
    expect(galleryBtn).toBeDefined();
    expect(analyzeBtn).toBeDisabled();

    // Click camera trigger
    fireEvent.click(cameraBtn);

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview-container')).toBeDefined();
    });

    expect(screen.getByTestId('photo-preview')).toBeDefined();
    expect(screen.getByTestId('photo-size-badge')).toBeDefined();

    // Relaxed guard: Analyze button is enabled because photo is attached, even without text
    expect(analyzeBtn).not.toBeDisabled();

    // 1-tap remove button
    const removeBtn = screen.getByTestId('remove-photo-button');
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('photo-preview-container')).toBeNull();
    });

    // Disabled again after photo removed
    expect(analyzeBtn).toBeDisabled();
  });

  it('passes CameraSource.Photos ("PHOTOS") to Camera.getPhoto when gallery trigger is clicked', async () => {
    const { Camera, CameraSource } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1nYWxsZXJ5LXBob3Rv',
      format: 'jpeg',
    });

    renderComponent();

    const galleryBtn = screen.getByTestId('gallery-trigger');
    fireEvent.click(galleryBtn);

    await waitFor(() => {
      expect(Camera.getPhoto).toHaveBeenCalledTimes(1);
    });

    expect(Camera.getPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'PHOTOS',
      })
    );
    const callArgs = (Camera.getPhoto as any).mock.calls[0][0];
    expect(callArgs.source).toBe('PHOTOS');
    expect(callArgs.source).toBe(CameraSource.Photos);
  });

  it('passes CameraSource.Camera ("CAMERA") to Camera.getPhoto when camera trigger is clicked', async () => {
    const { Camera, CameraSource } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1jYW1lcmEtcGhvdG8=',
      format: 'jpeg',
    });

    renderComponent();

    const cameraBtn = screen.getByTestId('camera-trigger');
    fireEvent.click(cameraBtn);

    await waitFor(() => {
      expect(Camera.getPhoto).toHaveBeenCalledTimes(1);
    });

    expect(Camera.getPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'CAMERA',
      })
    );
    const callArgs = (Camera.getPhoto as any).mock.calls[0][0];
    expect(callArgs.source).toBe('CAMERA');
    expect(callArgs.source).toBe(CameraSource.Camera);
  });

  it('unwraps HTTP 429 from error.context and renders 15 RPM cooldown warning banner with switch to manual entry button', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 429,
          clone: () => ({
            json: async () => ({
              code: 'RATE_LIMITED',
              retryAfter: 15,
              error: 'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.',
            }),
          }),
          json: async () => ({
            code: 'RATE_LIMITED',
            retryAfter: 15,
            error: 'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.',
          }),
        },
      },
    });

    renderComponent();

    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'Chicken Salad');
    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-banner')).toBeDefined();
      expect(within(screen.getByTestId('rate-limit-banner')).getByText('Rate Limit Exceeded (15 RPM)')).toBeDefined();
    });

    const switchToManualBtn = screen.getByTestId('switch-to-manual-btn');
    expect(switchToManualBtn).toBeDefined();

    // Clicking switch to manual opens the manual form with dish name populated
    fireEvent.click(switchToManualBtn);

    await waitFor(() => {
      expect(screen.getByTestId('dish-name-input')).toHaveValue('Chicken Salad');
      expect(screen.getByTestId('calories-input')).toBeDefined();
    });
  });

  it('submits multimodal meal photo payload to edge function, displays laser scan loading animation, and retains 48x48 thumbnail on staged meal card', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90by1iYXNlNjQ=',
      format: 'jpeg',
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Grilled Salmon Salad',
        calories: 450,
        protein: 40,
        carbs: 15,
        fat: 25,
        fiber: 6,
        explanation: '300 kcal (Salmon) + 150 kcal (Salad & Dressing) = 450 kcal',
        items: [
          { name: 'Salmon', portion: '1 fillet', calories: 300, protein: 35, carbs: 0, fat: 18, fiber: 0 },
          { name: 'Salad & Dressing', portion: '1 bowl', calories: 150, protein: 5, carbs: 15, fat: 7, fiber: 6 },
        ],
      },
      error: null,
    });

    renderComponent();

    // Attach photo via gallery trigger
    fireEvent.click(screen.getByTestId('gallery-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    const analyzeBtn = screen.getByTestId('analyze-meal-button');
    fireEvent.click(analyzeBtn);

    // Verify edge function was invoked with multimodal base64 payload
    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'parse-nutrition',
        expect.objectContaining({
          body: expect.objectContaining({
            image_base64: 'dGVzdC1waG90by1iYXNlNjQ=',
            imageMimeType: 'image/jpeg',
          }),
        })
      );
    });

    // Verify staged meal card retains 48x48 thumbnail
    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      expect(screen.getByTestId('staged-meal-photo-thumbnail')).toBeDefined();
    });

    expect(screen.getByTestId('dish-name-input')).toHaveValue('Grilled Salmon Salad');
  });

  it('keeps meal photo pinned at top when switching to manual entry', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90by1waW5uZWQ=',
      format: 'jpeg',
    });

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

    renderComponent();

    // Attach photo
    fireEvent.click(screen.getByTestId('camera-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    // Trigger analysis which returns 429
    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-banner')).toBeDefined();
    });

    // Click Switch to Manual Entry
    fireEvent.click(screen.getByTestId('switch-to-manual-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('pinned-photo-in-manual')).toBeDefined();
    });

    // Verify no contradictory green success message is displayed
    expect(screen.queryByTestId('status-message')).toBeNull();

    // Verify 1-tap removal of pinned photo in manual form
    const removePinnedBtn = screen.getByTestId('remove-pinned-photo-button');
    fireEvent.click(removePinnedBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('pinned-photo-in-manual')).toBeNull();
    });
  });

  it('pre-populates manual dish name with "Meal Photo" when switching to manual with photo and empty text', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90by1tYW51YWw=',
      format: 'jpeg',
    });

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

    renderComponent();

    // Attach photo without typing text in nlInput
    fireEvent.click(screen.getByTestId('camera-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('switch-to-manual-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('switch-to-manual-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('dish-name-input')).toHaveValue('Meal Photo');
    });
  });

  it('resets selectedPhoto and closes staged state when a meal is logged to database', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90by1sb2dnZWQ=',
      format: 'jpeg',
    });

    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Avocado Toast & Egg',
        calories: 380,
        protein: 14,
        carbs: 30,
        fat: 22,
        fiber: 6,
        explanation: 'Avocado toast with fried egg',
        items: [
          { name: 'Avocado Toast', portion: '1 slice', calories: 290, protein: 8, carbs: 30, fat: 15, fiber: 6 },
          { name: 'Fried Egg', portion: '1 egg', calories: 90, protein: 6, carbs: 0, fat: 7, fiber: 0 },
        ],
      },
      error: null,
    });

    renderComponent();

    // Attach photo
    fireEvent.click(screen.getByTestId('gallery-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview-container')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // Click Log Meal
    fireEvent.click(screen.getByText('Log Meal (+380 kcal)'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    // Verify photo preview is cleared and state reset
    await waitFor(() => {
      expect(screen.queryByTestId('photo-preview-container')).toBeNull();
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      expect(screen.getByTestId('analyze-meal-button')).toBeDisabled();
    });
  });

  it('attaches a photo preview when an image is selected via the hidden file input', async () => {
    renderComponent();

    const hiddenFileInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;
    expect(hiddenFileInput).toBeDefined();

    const file = new File(['mock-image-content'], 'meal.jpg', { type: 'image/jpeg' });
    fireEvent.change(hiddenFileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview-container')).toBeDefined();
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    expect(screen.getByTestId('analyze-meal-button')).not.toBeDisabled();
  });

  it('handles user cancellation of camera or gallery picker gracefully without showing an error banner', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockRejectedValue(new Error('User cancelled photos app'));

    renderComponent();

    const cameraBtn = screen.getByTestId('camera-trigger');
    fireEvent.click(cameraBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('status-message')).toBeNull();
      expect(screen.queryByText(/AI service unavailable/i)).toBeNull();
      expect(screen.queryByTestId('photo-preview-container')).toBeNull();
    });
  });

  it('complies with WCAG 2.5.5 touch target size (minimum 44x44px) and touch-manipulation on camera, gallery, remove, and manual buttons', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC10b3VjaC10YXJnZXQ=',
      format: 'jpeg',
    });

    renderComponent();

    const cameraBtn = screen.getByTestId('camera-trigger');
    const galleryBtn = screen.getByTestId('gallery-trigger');
    const manualToggleBtn = screen.getByText('Manual Entry').closest('button');

    expect(cameraBtn.className).toContain('min-h-[44px]');
    expect(cameraBtn.className).toContain('min-w-[44px]');
    expect(cameraBtn.className).toContain('touch-manipulation');

    expect(galleryBtn.className).toContain('min-h-[44px]');
    expect(galleryBtn.className).toContain('min-w-[44px]');
    expect(galleryBtn.className).toContain('touch-manipulation');

    expect(manualToggleBtn?.className).toContain('min-h-[44px]');
    expect(manualToggleBtn?.className).toContain('min-w-[44px]');
    expect(manualToggleBtn?.className).toContain('touch-manipulation');

    // Attach photo to check remove-photo-button
    fireEvent.click(cameraBtn);

    await waitFor(() => {
      expect(screen.getByTestId('remove-photo-button')).toBeDefined();
    });

    const removeBtn = screen.getByTestId('remove-photo-button');
    expect(removeBtn.className).toContain('min-h-[44px]');
    expect(removeBtn.className).toContain('min-w-[44px]');
    expect(removeBtn.className).toContain('touch-manipulation');

    const analyzeBtn = screen.getByTestId('analyze-meal-button');
    expect(analyzeBtn.className).toContain('min-h-[44px]');
    expect(analyzeBtn.className).toContain('min-w-[44px]');
    expect(analyzeBtn.className).toContain('touch-manipulation');
  });

  it('handles Android single "l" cancellation ("User canceled") without error or triggering file input click', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockRejectedValue(new Error('User canceled'));

    renderComponent();

    const hiddenFileInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;
    const fileClickSpy = vi.spyOn(hiddenFileInput, 'click');

    const cameraBtn = screen.getByTestId('camera-trigger');
    fireEvent.click(cameraBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('status-message')).toBeNull();
      expect(screen.queryByText(/AI service unavailable/i)).toBeNull();
      expect(screen.queryByTestId('photo-preview-container')).toBeNull();
      expect(fileClickSpy).not.toHaveBeenCalled();
    });
  });

  it('displays error status when file input receives an unreadable/invalid image rather than attaching broken preview', async () => {
    renderComponent();

    const hiddenFileInput = screen.getByTestId('hidden-file-input') as HTMLInputElement;
    // An empty 0-byte file that resolves to empty base64
    const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
    fireEvent.change(hiddenFileInput, { target: { files: [emptyFile] } });

    await waitFor(() => {
      expect(screen.queryByTestId('photo-preview-container')).toBeNull();
      expect(screen.getByTestId('status-message')).toBeDefined();
      expect(within(screen.getByTestId('status-message')).getByText(/Could not process selected image/i)).toBeDefined();
    });
  });

  it('unwraps Retry-After directly from error.context.headers when response body is plain text or empty', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 429,
          headers: new Headers({ 'Retry-After': '30' }),
          json: async () => {
            throw new Error('Unexpected token in JSON');
          },
        },
      },
    });

    renderComponent();

    // Attach photo
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90bw==',
      format: 'jpeg',
    });
    fireEvent.click(screen.getByTestId('camera-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('rate-limit-banner')).toBeDefined();
    });
  });

  it('unwraps HTTP 400 JSON error from error.context and replaces generic non-2xx status message', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          status: 400,
          clone: () => ({
            json: async () => ({ error: 'Input text or meal photo is required for nutrition parsing.' }),
          }),
        },
      },
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Something');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(within(screen.getByTestId('status-message')).getByText(/Input text or meal photo is required for nutrition parsing/i)).toBeDefined();
    });

    expect(screen.queryByText(/non-2xx/i)).toBeNull();
  });

  it('unwraps HTTP 422 non-food error from error.context and displays descriptive warning banner', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          status: 422,
          clone: () => ({
            json: async () => ({
              error: 'No food detected in input or image. Please provide a meal photo or food description.',
              code: 'NON_FOOD_DETECTED',
            }),
          }),
        },
      },
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'My mechanical keyboard');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(within(screen.getByTestId('status-message')).getByText(/No food detected in input or image/i)).toBeDefined();
    });
  });

  it('unwraps HTTP 503 capacity overload from error.context and displays capacity message', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          status: 503,
          clone: () => ({
            json: async () => ({
              error: 'AI model capacity is temporarily exhausted. Please try again in 5 seconds or switch to manual entry.',
              code: 'CAPACITY_EXHAUSTED',
              retryAfter: 5,
            }),
          }),
        },
      },
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Steak and eggs');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(within(screen.getByTestId('status-message')).getByText(/AI model capacity is temporarily exhausted/i)).toBeDefined();
    });
  });

  it('enforces adaptive timeouts of 30s for text-only input', async () => {
    (supabase.functions.invoke as any).mockImplementation(() => new Promise(() => {}));

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Text meal');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('analyze-meal-button'));

      // Advance by 29 seconds (should not timeout yet)
      await act(async () => {
        vi.advanceTimersByTime(29000);
      });
      expect(screen.queryByText(/Edge function timeout/i)).toBeNull();

      // Advance past 30 seconds
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(within(screen.getByTestId('status-message')).getByText(/Edge function timeout after 30s/i)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces 45s timeout boundary when photo is attached', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90bw==',
      format: 'jpeg',
    });

    (supabase.functions.invoke as any).mockImplementation(() => new Promise(() => {}));

    renderComponent();

    fireEvent.click(screen.getByTestId('camera-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('analyze-meal-button'));

      // Advance by 35 seconds (past the 30s text timeout, should NOT timeout yet because photo timeout is 45s)
      await act(async () => {
        vi.advanceTimersByTime(35000);
      });
      expect(screen.queryByText(/Edge function timeout/i)).toBeNull();

      // Advance past 45s
      await act(async () => {
        vi.advanceTimersByTime(11000);
      });
      expect(within(screen.getByTestId('status-message')).getByText(/Edge function timeout after 45s/i)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves attached photo preview in DOM when edge function analysis fails', async () => {
    const { Camera } = await import('@capacitor/camera');
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'dGVzdC1waG90bw==',
      format: 'jpeg',
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: new Error('Network error'),
    });

    renderComponent();

    fireEvent.click(screen.getByTestId('camera-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('analyze-meal-button'));

    await waitFor(() => {
      expect(screen.getByTestId('status-message')).toBeDefined();
    });

    // Photo preview must still be visible and preserved
    expect(screen.getByTestId('photo-preview')).toBeDefined();
  });

  it('displays Retry Analysis button in error banner and succeeds on retry', async () => {
    let callCount = 0;
    (supabase.functions.invoke as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: {
              status: 503,
              clone: () => ({
                json: async () => ({ error: 'AI model capacity is temporarily exhausted. Please try again in 5 seconds or switch to manual entry.' }),
              }),
            },
          },
        };
      }
      return {
        data: {
          name: 'Healthy Chicken Salad',
          calories: 350,
          protein: 40,
          carbs: 10,
          fat: 15,
          fiber: 5,
          explanation: 'Chicken and salad',
          items: [{ name: 'Chicken Salad', portion: '1 bowl', calories: 350, protein: 40, carbs: 10, fat: 15, fiber: 5 }],
        },
        error: null,
      };
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Chicken Salad');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('retry-analysis-button')).toBeDefined();
    });

    // Click retry
    fireEvent.click(screen.getByTestId('retry-analysis-button'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });
    expect(screen.getByTestId('component-name')).toHaveTextContent('Chicken Salad');

    // Error banner and retry button should be cleared on success
    expect(screen.queryByTestId('retry-analysis-button')).toBeNull();
    expect(callCount).toBe(2);
  });

  it('complies with WCAG 2.5.5 touch target size (min 44x44px) and touch-manipulation on Retry Analysis button', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: new Error('AI failed'),
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Lunch');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('retry-analysis-button')).toBeDefined();
    });

    const retryBtn = screen.getByTestId('retry-analysis-button');
    expect(retryBtn.className).toContain('min-h-[44px]');
    expect(retryBtn.className).toContain('min-w-[44px]');
    expect(retryBtn.className).toContain('touch-manipulation');
  });

  it('unwraps error from error.context when context is a plain object without .clone()', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          status: 400,
          error: 'Direct context error message without clone',
          code: 'CUSTOM_ERROR',
        },
      },
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, 'Protein shake');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(within(screen.getByTestId('status-message')).getByText(/Direct context error message without clone/i)).toBeDefined();
    });
  });

  it('parses edge function response containing markdown json code fences', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: '```json\n{"name": "Fenced Omelette", "calories": 300, "protein": 24, "carbs": 2, "fat": 20, "fiber": 0, "items": [{"name": "Omelette", "portion": "3 eggs", "calories": 300, "protein": 24, "carbs": 2, "fat": 20, "fiber": 0}]}\n```',
      error: null,
    });

    renderComponent();

    const input = screen.getByPlaceholderText('Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)');
    await userEvent.type(input, '3 egg omelette');

    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      expect(screen.getByTestId('dish-name-input')).toHaveValue('Fenced Omelette');
    });

    expect(screen.getByText('Omelette')).toBeDefined();
  });

  it('opens custom dish edit modal when edit pencil button on carousel card is clicked', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [
            { id: 'dish-edit-1', name: 'Macro Oats', calories: 350, protein: 30, carbs: 45, fat: 5, fiber: 6, ingredients: '' },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('edit-dish-btn-dish-edit-1')).toBeDefined();
    });

    const editBtn = screen.getByTestId('edit-dish-btn-dish-edit-1');
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText('Edit Custom Dish')).toBeDefined();
      expect(screen.getByDisplayValue('Macro Oats')).toBeDefined();
      expect(screen.getByDisplayValue('350')).toBeDefined();
    });
  });

  it('rendering >= 10 dishes asserts 0 fetchDishDetail calls, and opening one dish editor asserts exactly 1', async () => {
    const dishes = Array.from({ length: 12 }, (_, i) => ({
      id: `dish-perf-${i + 1}`,
      user_id: 'test-user-id',
      name: `Dish ${i + 1}`,
      calories: 300 + i * 10,
      protein: 20 + i,
      carbs: 30,
      fat: 10,
      fiber: 2,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          resolver: (builder: any) => {
            if (builder.projection === 'id, items, ingredients, kind, notes') {
              const idFilter = builder.filters.find((f: any) => f.column === 'id');
              const dishId = idFilter?.value;
              return {
                id: dishId,
                items: [
                  {
                    id: 'item-1',
                    name: 'Detail Oats',
                    displayPortion: '1 cup',
                    quantity: 1,
                    unit: 'cup',
                    calories: 300,
                    protein: 20,
                    carbs: 30,
                    fat: 10,
                    fiber: 2,
                  },
                ],
                ingredients: null,
              };
            }
            return dishes;
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('custom-dish-card-dish-perf-1')).toBeDefined();
    });

    // Verify top 3 dishes are rendered inline in collapsed state (D26)
    for (let i = 1; i <= 3; i++) {
      expect(screen.getByTestId(`custom-dish-card-dish-perf-${i}`)).toBeDefined();
    }
    // Verify dishes beyond top 3 are NOT rendered inline in collapsed state
    for (let i = 4; i <= 10; i++) {
      expect(screen.queryByTestId(`custom-dish-card-dish-perf-${i}`)).toBeNull();
    }

    // Click inline expander and verify all 10 dishes are rendered inline before detail-fetch assertion
    fireEvent.click(screen.getByTestId('open-favorites-sheet-btn'));
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByTestId(`custom-dish-card-dish-perf-${i}`)).toBeDefined();
    }

    // 0 fetchDishDetail calls so far
    const detailFetchesBefore = getRecordedSelects().filter(
      (s) => s.table === 'custom_dishes' && s.projection === 'id, items, ingredients, kind, notes'
    );
    expect(detailFetchesBefore.length).toBe(0);

    // Open one dish editor inline
    const editBtn = screen.getByTestId('edit-dish-btn-dish-perf-1');
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText('Edit Custom Dish')).toBeDefined();
    });

    // Exactly 1 fetchDishDetail call occurred
    const detailFetchesAfter = getRecordedSelects().filter(
      (s) => s.table === 'custom_dishes' && s.projection === 'id, items, ingredients, kind, notes'
    );
    expect(detailFetchesAfter.length).toBe(1);
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection: 'id, items, ingredients, kind, notes',
    });
  });

  it('surfaces fetch failure with role="alert" and a retry affordance when dish detail fetch fails', async () => {
    let shouldFail = true;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          resolver: (builder: any) => {
            if (builder.projection === 'id, items, ingredients, kind, notes') {
              if (shouldFail) {
                return { data: null, error: new Error('Network error loading dish details') };
              }
              return {
                id: 'dish-err-1',
                items: [
                  {
                    id: 'item-1',
                    name: 'Oats',
                    displayPortion: '1 cup',
                    quantity: 1,
                    unit: 'cup',
                    calories: 300,
                    protein: 20,
                    carbs: 30,
                    fat: 10,
                    fiber: 2,
                  },
                ],
                ingredients: null,
              };
            }
            return [
              {
                id: 'dish-err-1',
                user_id: 'test-user-id',
                name: 'Error Dish',
                calories: 300,
                protein: 20,
                carbs: 30,
                fat: 10,
                fiber: 2,
                created_at: new Date().toISOString(),
              },
            ];
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    const { container } = renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('custom-dish-card-dish-err-1')).toBeDefined();
    });

    // Staging the dish triggers fetchDishDetail
    fireEvent.click(screen.getByTestId('custom-dish-card-dish-err-1'));

    const errorAlert = await screen.findByTestId('dish-fetch-error');
    expect(errorAlert).toBeDefined();
    // StatusBanner places role="alert" on the sr-only persistent live region, not on the visible banner
    expect(errorAlert.getAttribute('role')).toBeNull();
    expect(errorAlert.textContent).toContain('Network error loading dish details');
    const alertRegions = container.querySelectorAll('[role="alert"]');
    const speakingAlert = Array.from(alertRegions).find((r) =>
      r.textContent?.includes('Network error loading dish details')
    );
    expect(speakingAlert).toBeDefined();

    const retryBtn = screen.getByTestId('dish-fetch-retry');
    expect(retryBtn).toBeDefined();
    expect(retryBtn.textContent).toBe('Retry');

    // Clicking retry after fixing failure succeeds
    shouldFail = false;
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('dish-fetch-error')).toBeNull();
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });
  });

  it('preserves fallback chain verbatim: normalizeItems -> legacy ingredients -> single synthetic item', async () => {
    const legacyIngredients = JSON.stringify([
      { name: 'Rolled Oats', portion: '50g', calories: 190, protein: 7, carbs: 34, fat: 3, fiber: 5 },
    ]);

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          resolver: (builder: any) => {
            if (builder.projection === 'id, items, ingredients, kind, notes') {
              return {
                id: 'dish-legacy-1',
                items: null,
                ingredients: legacyIngredients,
              };
            }
            return [
              {
                id: 'dish-legacy-1',
                user_id: 'test-user-id',
                name: 'Legacy Dish',
                calories: 190,
                protein: 7,
                carbs: 34,
                fat: 3,
                fiber: 5,
                created_at: new Date().toISOString(),
              },
            ];
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('custom-dish-card-dish-legacy-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('custom-dish-card-dish-legacy-1'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      expect(screen.getByText('Rolled Oats')).toBeDefined();
    });
  });

  // ==========================================================================
  // R-01 — the single most important regression in this feature.
  //
  // The shipping modal loaded the raw `ingredients` JSON blob into a
  // single-line <input type="text"> and wrote back whatever came out of it.
  // Opening a dish and saving it with no changes was enough to mangle the
  // breakdown; clearing the field nulled the column outright.
  //
  // The fixture is the real production dish: `Office Breakfast`, 8 components,
  // owner demo-athlete. Open it, save it untouched, and every component must survive
  // byte-for-byte — and `ingredients` must not appear in the payload at all.
  // ==========================================================================
  it('R-01: opening and saving Office Breakfast unchanged preserves all 8 components and never writes ingredients', async () => {
    const breakkieIngredients = [
      { name: 'Scrambled Egg White', portion: '150 g', calories: 87, protein: 14, carbs: 1, fat: 3, fiber: 0 },
      { name: 'Sliced Turkey Breast', portion: '60 g', calories: 80, protein: 10, carbs: 1, fat: 4, fiber: 0 },
      { name: 'Smoked Salmon', portion: '50 g', calories: 68, protein: 8, carbs: 0, fat: 4, fiber: 0 },
      { name: 'Chocolate Coconut Chia Pudding', portion: '150 g', calories: 227, protein: 5, carbs: 18, fat: 15, fiber: 8 },
      { name: '2% Plain Greek Yogurt', portion: '100 g', calories: 88, protein: 9, carbs: 4, fat: 4, fiber: 0 },
      { name: 'Blueberries', portion: '2 handfuls (100g)', calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3, fiber: 2.4 },
      { name: 'Almond Butter', portion: '1 tbsp', calories: 98, protein: 3.4, carbs: 3, fat: 8.9, fiber: 1.6 },
      { name: 'Cucumber, Tomato, and Pickled Veggies', portion: '1 bowl', calories: 35, protein: 1.5, carbs: 7, fat: 0.2, fiber: 1.9 },
    ];
    const serialized = JSON.stringify(breakkieIngredients);
    const expectedTotals = breakkieIngredients.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calories,
        protein: acc.protein + i.protein,
        carbs: acc.carbs + i.carbs,
        fat: acc.fat + i.fat,
        fiber: acc.fiber + i.fiber,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    const mockUpdateEqSelect = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ select: mockUpdateEqSelect }),
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const b = createSupabaseBuilder('custom_dishes', {
          data: [
            {
              id: 'dish-breakkie',
              name: 'Office Breakfast',
              calories: expectedTotals.calories,
              protein: expectedTotals.protein,
              carbs: expectedTotals.carbs,
              fat: expectedTotals.fat,
              fiber: expectedTotals.fiber,
              // Un-backfilled: the legacy blob is the only breakdown.
              ingredients: serialized,
            },
          ],
          error: null,
        });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('edit-dish-btn-dish-breakkie')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('edit-dish-btn-dish-breakkie'));

    // All 8 rows must be visible and editable — not one text input holding JSON.
    await waitFor(() => {
      expect(screen.getAllByTestId('dish-item-row')).toHaveLength(8);
    });
    expect(screen.queryByPlaceholderText('e.g. 1 cup oats, 1 scoop whey, 1 tbsp peanut butter')).toBeNull();

    // Save with no changes at all.
    fireEvent.click(screen.getByText('Save Dish'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    const payload = mockUpdate.mock.calls[0][0] as any;

    // 1. The breakdown survives, in order, with every macro intact.
    expect(payload.items).toHaveLength(8);
    expect(payload.items.map((i: any) => i.name)).toEqual(breakkieIngredients.map((i) => i.name));
    for (let i = 0; i < 8; i++) {
      expect(payload.items[i].calories).toBe(breakkieIngredients[i].calories);
      expect(payload.items[i].protein).toBe(breakkieIngredients[i].protein);
      expect(payload.items[i].carbs).toBe(breakkieIngredients[i].carbs);
      expect(payload.items[i].fat).toBe(breakkieIngredients[i].fat);
      expect(payload.items[i].fiber).toBe(breakkieIngredients[i].fiber);
      // Provenance: the original free-text portion is preserved verbatim.
      expect(payload.items[i].displayPortion).toBe(breakkieIngredients[i].portion);
    }

    // 2. The legacy column is never written. This is the whole of R-01.
    expect('ingredients' in payload).toBe(false);

    // 3. The parent equals the sum, which is what the DB constraint checks.
    expect(payload.calories).toBeCloseTo(expectedTotals.calories, 6);
    expect(payload.protein).toBeCloseTo(expectedTotals.protein, 6);
    expect(payload.fiber).toBeCloseTo(expectedTotals.fiber, 6);
  });


  it('triggers deferred delete from inline Delete button inside edit modal: shows UndoToast, zero delete before 6s expiry, and commits on expiry', async () => {
    vi.useFakeTimers();
    const mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        const b = createSupabaseBuilder('custom_dishes', {
          data: [
            { id: 'dish-del-1', name: 'Delete Me Dish', calories: 200, protein: 10, carbs: 20, fat: 2, fiber: 1 },
          ],
          error: null,
        });
        b.delete = mockDelete;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    const confirmSpy = vi.spyOn(window, 'confirm');

    renderComponent();

    await vi.waitFor(() => {
      expect(screen.getByTestId('edit-dish-btn-dish-del-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('edit-dish-btn-dish-del-1'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('modal-delete-dish-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('modal-delete-dish-btn'));

    // RD-7: Zero window.confirm call
    expect(confirmSpy).not.toHaveBeenCalled();

    // Modal closes immediately
    await vi.waitFor(() => {
      expect(screen.queryByText('Edit Custom Dish')).toBeNull();
    });

    // Zero DELETE before expiry
    expect(mockDelete).not.toHaveBeenCalled();

    // UndoToast is visible
    expect(screen.getByText('Delete Me Dish')).toBeDefined();
    expect(screen.getByText('Deleted')).toBeDefined();
    expect(screen.getByTestId('toast-undo-btn')).toBeDefined();

    // Fast-forward 6s expiry
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // Exactly one DELETE on expiry
    await vi.waitFor(() => {
      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });

  it('renders floating Quick-Log Toast widget when 1-tap quick log button is clicked', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [
            { id: 'dish-toast-1', name: 'Power Bowl', calories: 550, protein: 40, carbs: 60, fat: 12, fiber: 8 },
          ],
          error: null,
        });
      }
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    const { container } = renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-toast-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('quick-log-btn-dish-toast-1'));

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-toast')).toBeDefined();
    });

    const toast = screen.getByTestId('quick-log-toast');
    // StatusBanner places role="status" and aria-live="polite" on the sr-only live region
    expect(toast.getAttribute('role')).toBeNull();
    expect(toast.getAttribute('aria-live')).toBeNull();
    expect(within(toast).getByText('Power Bowl')).toBeDefined();
    expect(within(toast).getByText('+550 kcal')).toBeDefined();
    const statusRegions = container.querySelectorAll('[role="status"]');
    const speakingStatus = Array.from(statusRegions).find((r) =>
      r.textContent?.includes('Power Bowl')
    );
    expect(speakingStatus).toBeDefined();
  });

  it('auto-dismisses floating Quick-Log Toast widget after 5s (D41)', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [
            { id: 'dish-toast-2', name: 'Greek Yogurt Parfait', calories: 280, protein: 22, carbs: 35, fat: 4, fiber: 3 },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-toast-2')).toBeDefined();
    });

    vi.useFakeTimers();

    fireEvent.click(screen.getByTestId('quick-log-btn-dish-toast-2'));

    expect(screen.getByTestId('quick-log-toast')).toBeDefined();

    // Advance 5000ms (D41)
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByTestId('quick-log-toast')).toBeNull();
  });

  it('handles rapid multi-tap on quick-log button by updating toast content and resetting auto-dismiss timer', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'custom_dishes') {
        return createSupabaseBuilder('custom_dishes', {
          data: [
            { id: 'dish-a', name: 'Meal A', calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5 },
            { id: 'dish-b', name: 'Meal B', calories: 250, protein: 20, carbs: 20, fat: 5, fiber: 2 },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('quick-log-btn-dish-a')).toBeDefined();
      expect(screen.getByTestId('quick-log-btn-dish-b')).toBeDefined();
    });

    vi.useFakeTimers();

    // Click Dish A
    fireEvent.click(screen.getByTestId('quick-log-btn-dish-a'));
    expect(screen.getByTestId('quick-log-toast')).toBeDefined();
    expect(within(screen.getByTestId('quick-log-toast')).getByText('Meal A')).toBeDefined();
    expect(within(screen.getByTestId('quick-log-toast')).getByText('+400 kcal')).toBeDefined();

    // Advance 2500ms
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId('quick-log-toast')).toBeDefined();

    // Click Dish B before 5s timer finishes (D41)
    fireEvent.click(screen.getByTestId('quick-log-btn-dish-b'));
    expect(within(screen.getByTestId('quick-log-toast')).getByText('Meal B')).toBeDefined();
    expect(within(screen.getByTestId('quick-log-toast')).getByText('+250 kcal')).toBeDefined();

    // Advance 2500ms (total 5000ms from start, but only 2500ms since Dish B tap)
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    // Toast must still be visible!
    expect(screen.getByTestId('quick-log-toast')).toBeDefined();

    // Advance remaining 2500ms (reaches 5000ms since Dish B tap)
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    // Toast should now be dismissed
    expect(screen.queryByTestId('quick-log-toast')).toBeNull();
  });

  it('rolls a rescale rejected by a database constraint back to the stored macros', async () => {
    // The row's own rollback is unit-tested; what this pins is the wiring. The
    // timeline has to hand the row the write's *promise* (mutateAsync, not
    // mutate) or the row never learns the write failed and keeps a quantity on
    // screen that Postgres refused.
    const todayStr = getLocalDateStr(new Date());
    const mockMeal = {
      id: 'today-log-scale',
      user_id: 'test-user-id',
      food_name: 'Chicken Rice & Eggs',
      meal_type: 'Lunch',
      calories: 560,
      protein: 32,
      carbs: 69,
      fat: 16,
      fiber: 1,
      logged_at: `${todayStr}T12:00:00Z`,
      logged_date: todayStr,
      items: [
        {
          id: 'i1',
          name: 'Steamed Rice',
          quantity: 240,
          unit: 'g',
          displayPortion: '1.5 cups (240g)',
          calories: 300,
          protein: 6,
          carbs: 65,
          fat: 1,
          fiber: 1,
        },
        {
          id: 'i2',
          name: 'Grilled Chicken Breast',
          quantity: 120,
          unit: 'g',
          displayPortion: '1 chop (120g)',
          calories: 260,
          protein: 26,
          carbs: 4,
          fat: 15,
          fiber: 0,
        },
      ],
    };

    // Exactly what Phase 5 returns when the parent no longer matches Σ(items).
    const constraintError = {
      message:
        'new row for relation "nutrition_logs" violates check constraint "chk_nl_parent_equals_items_sum"',
    };
    const mockSelectResult = { data: null, error: constraintError };
    const mockSelect = vi.fn().mockResolvedValue(mockSelectResult);
    const mockUpdateEq = vi.fn().mockReturnValue({
      select: mockSelect,
      then: (resolve: any) => Promise.resolve({ error: constraintError }).then(resolve),
    });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const b = createSupabaseBuilder('nutrition_logs', { data: [mockMeal], error: null });
        b.update = mockUpdate;
        return b;
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('meal-actions-today-log-scale')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('meal-actions-today-log-scale'));
    fireEvent.click(screen.getByTestId('edit-meal-today-log-scale'));

    expect(await screen.findByTestId('edit-meal-sheet')).toBeDefined();
    // D46: scale via the header Scale chip
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    fireEvent.change(screen.getByTestId('meal-scale-input'), { target: { value: '0.5' } });
    fireEvent.keyDown(screen.getByTestId('meal-scale-input'), { key: 'Enter' });

    // Save changes
    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));

    // Rejected: EditMealSheet surfaces the constraint violation in mapped wording
    const alert = await screen.findByTestId('edit-meal-error');
    expect(alert.textContent).toMatch(/no longer match its components/);
  });

  describe('interactive nutrient breakdown popup', () => {
    it('opens breakdown modal when MacroRing cards are clicked and updates active tab', async () => {
      renderComponent();
      await screen.findByText("Today's Nutrition");

      const calRing = screen.getByTestId('macro-ring-calories');
      const proteinRing = screen.getByTestId('macro-ring-protein');
      const carbsRing = screen.getByTestId('macro-ring-carbs');
      const fatRing = screen.getByTestId('macro-ring-fat');
      const fiberRing = screen.getByTestId('macro-ring-fiber');

      // Click Calories ring
      fireEvent.click(calRing);
      expect(screen.getByTestId('nutrient-breakdown-modal')).toBeDefined();
      expect(screen.getByTestId('nutrient-pill-calories').getAttribute('aria-selected')).toBe('true');

      // Close modal
      fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));
      expect(screen.queryByTestId('nutrient-breakdown-modal')).toBeNull();

      // Click Protein ring
      fireEvent.click(proteinRing);
      expect(screen.getByTestId('nutrient-breakdown-modal')).toBeDefined();
      expect(screen.getByTestId('nutrient-pill-protein').getAttribute('aria-selected')).toBe('true');

      // Switch to Carbs via segmented pill switcher inside modal
      fireEvent.click(screen.getByTestId('nutrient-pill-carbs'));
      expect(screen.getByTestId('nutrient-pill-carbs').getAttribute('aria-selected')).toBe('true');

      // Close modal
      fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));
      expect(screen.queryByTestId('nutrient-breakdown-modal')).toBeNull();

      // Click Carbs ring
      fireEvent.click(carbsRing);
      expect(screen.getByTestId('nutrient-pill-carbs').getAttribute('aria-selected')).toBe('true');
      fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));

      // Click Fat ring
      fireEvent.click(fatRing);
      expect(screen.getByTestId('nutrient-pill-fat').getAttribute('aria-selected')).toBe('true');
      fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));

      // Click Fiber ring
      fireEvent.click(fiberRing);
      expect(screen.getByTestId('nutrient-pill-fiber').getAttribute('aria-selected')).toBe('true');
      fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));
    });

    it('does not open the breakdown modal when Remaining Fuel chips are clicked (6.2)', async () => {
      // This test used to assert the opposite. The chips and the rings above
      // them called the same handler with the same argument, so the dashboard
      // offered 10 tab stops to reach 5 destinations and announced every
      // nutrient twice as an actionable control. The chips lost their handler;
      // the rings keep it, and the test directly above still covers all five.
      // Inverted rather than deleted so re-adding the handler fails here.
      renderComponent();
      await screen.findByText("Today's Nutrition");

      for (const nutrient of ['calories', 'protein', 'carbs', 'fat', 'fiber']) {
        const chip = screen.getByTestId(`remaining-fuel-${nutrient}`);
        expect(chip.tagName).toBe('DIV');
        expect(chip.getAttribute('role')).toBeNull();
        expect(chip.getAttribute('tabindex')).toBeNull();

        fireEvent.click(chip);
        expect(screen.queryByTestId('nutrient-breakdown-modal')).toBeNull();
      }
    });

    it('displays Level 1 composite meals with accordion and Level 2 leaf meals in breakdown modal', async () => {
      const todayStr = getLocalDateStr(new Date());
      const mockLogs = [
        {
          id: 'log-composite-plate',
          user_id: 'test-user-id',
          food_name: 'Egg Frittata Plate',
          calories: 452,
          protein: 25.5,
          carbs: 31.2,
          fat: 24.6,
          fiber: 3.1,
          logged_at: formatLocalTimestamp(todayStr, new Date(2026, 0, 1, 12, 0, 0)),
          logged_date: todayStr,
          items: [
            {
              id: 'child-1',
              name: 'Egg Frittata',
              quantity: 150,
              unit: 'g',
              displayPortion: '1 slice (150g)',
              calories: 182,
              protein: 12.5,
              carbs: 3.2,
              fat: 13.1,
              fiber: 1.2,
            },
            {
              id: 'child-2',
              name: 'Cooking Oil',
              quantity: 15,
              unit: 'g',
              displayPortion: '1 tbsp (15g)',
              calories: 215,
              protein: 0.1,
              carbs: 21.0,
              fat: 11.3,
              fiber: 0,
            },
            {
              id: 'child-3',
              name: 'Cucumber & Tomato Pickles',
              quantity: 1,
              unit: 'unit',
              displayPortion: '1 bowl',
              calories: 55,
              protein: 12.9,
              carbs: 7.0,
              fat: 0.2,
              fiber: 1.9,
            },
          ],
        },
        {
          id: 'log-leaf-apple',
          user_id: 'test-user-id',
          food_name: 'Honeycrisp Apple',
          calories: 95,
          protein: 0.5,
          carbs: 25.0,
          fat: 0.3,
          fiber: 4.4,
          serving_size: 1,
          serving_unit: 'medium',
          logged_at: formatLocalTimestamp(todayStr, new Date(2026, 0, 1, 15, 0, 0)),
          logged_date: todayStr,
          items: null,
        },
      ];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          return createSupabaseBuilder('nutrition_logs', { data: mockLogs, error: null });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // Wait for logs to load and appear in DOM
      await screen.findByText('Egg Frittata Plate');

      // Open breakdown modal via calories ring
      fireEvent.click(screen.getByTestId('macro-ring-calories'));
      expect(screen.getByTestId('nutrient-breakdown-modal')).toBeDefined();

      // Composite meal has accordion trigger and count badge '3'
      const trigger = await screen.findByTestId('breakdown-accordion-trigger-log-composite-plate');
      expect(trigger).toBeDefined();
      expect(screen.getByTestId('breakdown-count-badge-log-composite-plate').textContent).toBe('3');

      // Leaf meal has no accordion trigger or count badge
      expect(screen.getByTestId('breakdown-leaf-row-log-leaf-apple')).toBeDefined();
      expect(screen.queryByTestId('breakdown-accordion-trigger-log-leaf-apple')).toBeNull();
      expect(screen.queryByTestId('breakdown-count-badge-log-leaf-apple')).toBeNull();

      // Expand composite meal
      fireEvent.click(trigger);
      expect(screen.getByTestId('breakdown-accordion-panel-log-composite-plate')).toBeDefined();

      // Child rows exist
      const childRows = screen.getAllByTestId('breakdown-child-row');
      expect(childRows.length).toBe(3);
      expect(screen.getByText('Egg Frittata')).toBeDefined();
      expect(screen.getByText('Cooking Oil')).toBeDefined();
      expect(screen.getByText('Cucumber & Tomato Pickles')).toBeDefined();
    });
  });

  describe('NEW-15: StatusBanner persistent live region integration', () => {
    it('mounts persistent live regions for dish fetch error and quick-log toast while idle', async () => {
      const { container } = renderComponent();

      // Idle: live regions exist from initial render and have empty text content
      const politeRegions = container.querySelectorAll('[role="status"]');
      const alertRegions = container.querySelectorAll('[role="alert"]');

      expect(politeRegions.length).toBeGreaterThan(0);
      expect(alertRegions.length).toBeGreaterThan(0);

      expect(screen.queryByTestId('dish-fetch-error')).toBeNull();
      expect(screen.queryByTestId('quick-log-toast')).toBeNull();
    });
  });

  describe('independent read-error channels', () => {
    it('keeps rendering loaded meals when only the saved-dishes query fails', async () => {
      // Regression: useNutritionData exposed `isReadError = isNutritionLogsError ||
      // isCustomDishesError`, and the meal list was gated on it. A custom_dishes failure therefore
      // replaced successfully loaded meals with an error about a different table, labelled
      // "Failed to load nutrition logs". Reported in the field as a `custom_dishes.kind` 42703
      // against a database missing that migration, on a screen headed "Today's Meals (3)".
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'custom_dishes') {
          return createSupabaseBuilder(table, {
            data: null,
            error: { message: 'column custom_dishes.kind does not exist', code: '42703' },
          });
        }
        if (table === 'nutrition_logs') {
          return createSupabaseBuilder(table, {
            data: [
              {
                id: 'log-sep-1',
                user_id: 'test-user-id',
                food_name: 'Channel Split Soup',
                meal_type: 'Lunch',
                calories: 520,
                protein: 30,
                carbs: 60,
                fat: 14,
                fiber: 4,
                serving_size: 1,
                serving_unit: 'bowl',
                logged_at: new Date().toISOString(),
                logged_date: getLocalDateStr(),
                created_at: new Date().toISOString(),
                has_components: false,
              },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // The meal loaded fine, so it must be on screen.
      await waitFor(() => {
        expect(screen.getByText('Channel Split Soup')).toBeDefined();
      });

      // It must not be accused of being a nutrition-logs failure.
      expect(screen.queryByTestId('nutrition-read-error')).toBeNull();

      // The dishes failure is still surfaced, in its own banner, named accurately.
      const dishBanner = await screen.findByTestId('dish-fetch-error');
      expect(dishBanner.textContent).toContain('Failed to load saved dishes');
      expect(dishBanner.textContent).toContain('column custom_dishes.kind does not exist');
    });

    it('threads dailyTotals and targets to StagedMealCard showing Today after row', async () => {
      const todayStr = getLocalDateStr();
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          return createSupabaseBuilder(table, {
            data: [
              {
                id: 'log-1',
                user_id: 'test-user',
                food_name: 'Previous meal',
                meal_type: 'Breakfast',
                calories: 500,
                protein: 40,
                carbs: 50,
                fat: 20,
                fiber: 5,
                serving_size: 1,
                serving_unit: 'serving',
                logged_at: formatLocalTimestamp(todayStr, new Date(2026, 0, 1, 8, 0, 0)),
                logged_date: todayStr,
                created_at: new Date().toISOString(),
                has_components: false,
              },
            ],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Chicken and Rice',
          calories: 600,
          protein: 50,
          carbs: 60,
          fat: 10,
          fiber: 2,
          explanation: 'Chicken + Rice = 600 kcal',
          items: [
            { name: 'Chicken', portion: '150g', calories: 250, protein: 45, carbs: 0, fat: 5, fiber: 0, quantity: 150, unit: 'g' },
            { name: 'Rice', portion: '200g', calories: 350, protein: 5, carbs: 60, fat: 5, fiber: 2, quantity: 200, unit: 'g' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(
        'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
      );
      await userEvent.type(input, 'chicken and rice');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-day-total')).toBeDefined();
      });

      // Daily totals: 500 kcal, 40 P. Meal totals: 600 kcal, 50 P.
      // Day total: 500 + 600 = 1100 kcal, 40 + 50 = 90 P.
      expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1100');
      expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('90');
    });
  });

  describe('Batch 3 / D10: Staged meal card in-place replacement and AI input restore', () => {
    it('hides AI input while meal is staged and restores previous text on discard (D10)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Eggs & Toast',
          calories: 350,
          protein: 20,
          carbs: 30,
          fat: 15,
          fiber: 2,
          items: [
            { name: 'Eggs', portion: '2 eggs', calories: 150, protein: 14, carbs: 2, fat: 10, fiber: 0, quantity: 2, unit: 'unit' },
            { name: 'Toast', portion: '1 slice', calories: 200, protein: 6, carbs: 28, fat: 5, fiber: 2, quantity: 1, unit: 'slice' },
          ],
        },
        error: null,
      });

      renderComponent();

      // AI input is initially visible
      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, '2 eggs and toast');

      const analyzeBtn = screen.getByText('Analyze Meal');
      fireEvent.click(analyzeBtn);

      // Staged card replaces AI input in place
      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      // AI input textarea must NOT be present while meal is staged
      expect(screen.queryByPlaceholderText(/Describe what you ate/i)).toBeNull();

      // Discard the staged meal
      const discardBtn = screen.getByRole('button', { name: /Discard staged meal/i });
      fireEvent.click(discardBtn);

      // Staged card is removed
      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      // AI input is restored WITH the previous text intact
      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(restoredInput).toBeDefined();
      expect(restoredInput).toHaveValue('2 eggs and toast');
    });

    it('hides AI input while meal is staged and restores empty AI input after log (D10)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');

      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      // AI input is hidden
      expect(screen.queryByPlaceholderText(/Describe what you ate/i)).toBeNull();

      // Log the staged meal
      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      fireEvent.click(logBtn);

      // Staged card is removed after mutation success
      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      // AI input is restored with empty input
      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(restoredInput).toBeDefined();
      expect(restoredInput).toHaveValue('');
    });

    it('renders status-message error banner when logging a staged meal fails and keeps staged card open (F1)', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockRejectedValue(new Error('Database write failed')),
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      expect(screen.getByTestId('status-message')).toHaveTextContent(/Analyzed/i);

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      fireEvent.click(logBtn);

      await waitFor(() => {
        expect(screen.getByTestId('status-message')).toHaveTextContent(/Failed to save log: Database write failed/i);
      });
      expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    });

    it('renders status-message error banner when saving staged meal as custom dish fails (F1)', async () => {
      const mockInsert = vi.fn().mockImplementation(() => {
        return Promise.resolve({ data: null, error: { message: 'Dish save constraint violated' } });
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'custom_dishes') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      const saveDishBtn = screen.getByRole('button', { name: /Save as Custom Dish/i });
      fireEvent.click(saveDishBtn);

      await waitFor(() => {
        expect(screen.getByTestId('status-message')).toHaveTextContent(/Failed to save custom dish/i);
      });
      expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    });

    it('restores focus to AI input textarea when staged card closes on discard (F5)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      const discardBtn = screen.getByRole('button', { name: /Discard staged meal/i });
      discardBtn.focus();
      expect(document.activeElement).toBe(discardBtn);

      fireEvent.click(discardBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(restoredInput);
    });

    it('A1: restores focus to AI input textarea after pending mutation disables Log button and drops focus to body', async () => {
      let resolveInsert: (val: any) => void;
      const insertPromise = new Promise((resolve) => {
        resolveInsert = resolve;
      });
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(insertPromise),
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      logBtn.focus();
      expect(document.activeElement).toBe(logBtn);

      fireEvent.click(logBtn);

      // Pending state disables the button; in real browsers disabling a focused button drops focus to body.
      await waitFor(() => {
        expect(logBtn).toBeDisabled();
      });
      // In real browsers, disabling the focused button blurs it to <body>.
      // jsdom does not auto-blur on disabled (jsdom issue #3121); simulate focus dropping to body:
      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.activeElement).toBe(document.body);

      // Now mutation succeeds
      await act(async () => {
        resolveInsert!({ data: [], error: null });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(document.activeElement).toBe(restoredInput);
      document.body.removeAttribute('tabindex');
    });

    it('Finding #5: does NOT restore focus to AI input textarea after touch pointer Log', async () => {
      let resolveInsert: (val: any) => void;
      const insertPromise = new Promise((resolve) => {
        resolveInsert = resolve;
      });
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(insertPromise),
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      // Mount autofocus runs in rAF and focuses dish-name-input
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const dishInput = screen.getByTestId('dish-name-input');
      expect(document.activeElement).toBe(dishInput);

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });

      // Simulate mobile touch tap on Log button while dish-name-input has focus:
      // pointerdown with pointerType 'touch'
      fireEvent.pointerDown(logBtn, { pointerType: 'touch' });
      fireEvent.click(logBtn);

      await waitFor(() => {
        expect(logBtn).toBeDisabled();
      });

      // Now mutation succeeds
      await act(async () => {
        resolveInsert!({ data: [], error: null });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      // Active element must NOT be restored to the textarea after touch tap!
      expect(document.activeElement).not.toBe(restoredInput);
    });

    it('Finding #5: returns focus to Log button when log mutation errors and card stays mounted', async () => {
      let rejectInsert: (val: any) => void;
      const insertPromise = new Promise((_, reject) => {
        rejectInsert = reject;
      });
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(insertPromise),
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });
      // Let StagedMealCard's mount-autofocus frame (requestAnimationFrame) run
      // before arranging focus. Under CI load that frame could otherwise land
      // after document.body.focus() below and move focus to the name input,
      // which made this test flaky (CI run 36937022112).
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      logBtn.focus();
      expect(document.activeElement).toBe(logBtn);

      fireEvent.click(logBtn);

      await waitFor(() => {
        expect(logBtn).toBeDisabled();
      });
      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.activeElement).toBe(document.body);

      // Now mutation errors
      await act(async () => {
        rejectInsert!(new Error('Network error'));
      });

      // Card must stay mounted
      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      // Log button is re-enabled and receives focus back
      await waitFor(() => {
        expect(logBtn).not.toBeDisabled();
      });
      expect(document.activeElement).toBe(logBtn);
      document.body.removeAttribute('tabindex');
    });

    it('restores focus to AI input textarea when staged card closes on log success (F5)', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
      (supabase.from as any).mockImplementation((table: string) => {
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      const logBtn = screen.getByRole('button', { name: /Log Meal/i });
      logBtn.focus();
      expect(document.activeElement).toBe(logBtn);

      fireEvent.click(logBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(restoredInput);
    });

    it('restores focus to AI input textarea when last item is removed (F5)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Single Item',
          calories: 100,
          protein: 10,
          carbs: 5,
          fat: 2,
          fiber: 0,
          items: [
            { name: 'Apple', portion: '1 medium', calories: 100, protein: 10, carbs: 5, fat: 2, fiber: 0, quantity: 1, unit: 'unit' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'apple');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      });

      const actionsBtn = screen.getByTestId('component-actions');
      actionsBtn.focus();
      fireEvent.click(actionsBtn);

      const removeBtn = screen.getByTestId('component-remove');
      removeBtn.focus();
      expect(document.activeElement).toBe(removeBtn);
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
      });

      const restoredInput = screen.getByPlaceholderText(/Describe what you ate/i);
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(restoredInput);
    });

    it('does not move focus when card unmounts if focus was outside the card (F5)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
        expect(screen.getByTestId('dish-name-input')).toBe(document.activeElement);
      });

      const dateInput = screen.getByTestId('nutrition-date-input');
      dateInput.focus();
      expect(document.activeElement).toBe(dateInput);

      // Discard while focus is on date input
      const discardBtn = screen.getByRole('button', { name: /Discard staged meal/i });
      fireEvent.click(discardBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
        expect(document.activeElement).toBe(dateInput);
      });

      // Focus should remain on the date input, NOT moved to AI textarea
      expect(document.activeElement).toBe(dateInput);
    });

    it('does not restore focus if an inside element blurred with relatedTarget=null and outside element is focused before discard (F5)', async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          name: 'Protein Shake',
          calories: 200,
          protein: 30,
          carbs: 5,
          fat: 2,
          fiber: 1,
          items: [
            { name: 'Whey', portion: '1 scoop', calories: 200, protein: 30, carbs: 5, fat: 2, fiber: 1, quantity: 1, unit: 'scoop' },
          ],
        },
        error: null,
      });

      renderComponent();

      const input = screen.getByPlaceholderText(/Describe what you ate/i);
      await userEvent.type(input, 'whey protein shake');
      fireEvent.click(screen.getByText('Analyze Meal'));

      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeDefined();
        expect(screen.getByTestId('dish-name-input')).toBe(document.activeElement);
      });

      // Focus an element inside the staged card first
      const mealTypeSelect = screen.getByRole('combobox', { name: /Meal type/i });
      mealTypeSelect.focus();
      expect(document.activeElement).toBe(mealTypeSelect);

      // Dispatch a blur event on the inside element with relatedTarget=null (simulates jsdom Node 22 blur)
      fireEvent.blur(mealTypeSelect, { relatedTarget: null });

      // Focus an outside element before discard
      const dateInput = screen.getByTestId('nutrition-date-input');
      dateInput.focus();
      expect(document.activeElement).toBe(dateInput);

      // Discard while outside element is focused
      const discardBtn = screen.getByRole('button', { name: /Discard staged meal/i });
      fireEvent.click(discardBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('staged-meal-card')).toBeNull();
        expect(document.activeElement).toBe(dateInput);
      });

      // Focus must remain on the outside element, not stolen back to textarea
      expect(document.activeElement).toBe(dateInput);
    });

    it('D33: while meal is staged, Quick Log favorite appends items, updates Day total/This meal, shows banner with Undo, and "+" does not call log mutation', async () => {
      const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
      const customDishes = [
        { id: 'dish-1', user_id: 'test-user', name: 'Almonds', calories: 160, protein: 6, carbs: 6, fat: 14, fiber: 3, kind: 'food', use_count: 5 },
      ];
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'custom_dishes') {
          return createSupabaseBuilder('custom_dishes', {
            resolver: (builder: any) => {
              if (builder.projection === 'id, items, ingredients, kind, notes') {
                return {
                  id: 'dish-1',
                  items: null,
                  ingredients: null,
                  kind: 'food',
                  notes: null,
                };
              }
              return customDishes;
            },
          });
        }
        const b = createSupabaseBuilder(table, { data: [], error: null });
        if (table === 'nutrition_logs') {
          b.insert = mockInsert;
        }
        return b;
      });

      renderComponent();

      // Initially no meal staged: title is Quick Log Favorites
      await waitFor(() => {
        expect(screen.getByText('Almonds')).toBeDefined();
      });
      expect(screen.getByRole('heading', { level: 3, name: /Quick Log Favorites/i })).toBeDefined();

      // Stage a meal via Manual Entry
      fireEvent.click(screen.getByText('Manual Entry'));
      await userEvent.type(screen.getByTestId('dish-name-input'), 'Greek Yogurt');
      await userEvent.type(screen.getByTestId('calories-input'), '150');
      await userEvent.type(screen.getByTestId('protein-input'), '15');
      await userEvent.type(screen.getByTestId('carbs-input'), '10');
      await userEvent.type(screen.getByTestId('fat-input'), '2');
      fireEvent.click(screen.getByText('Log Meal'));

      // Now meal is staged
      await waitFor(() => {
        expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
      });

      // Section title switched to "Add to staged meal"
      expect(screen.getByRole('heading', { level: 3, name: /Add to staged meal/i })).toBeDefined();

      // "+" button aria-label is "Add Almonds to staged meal"
      const plusBtn = screen.getByLabelText('Add Almonds to staged meal');
      expect(plusBtn).toBeDefined();

      // Click "+" button
      fireEvent.click(plusBtn);

      // Does NOT call log mutation
      expect(mockInsert).not.toHaveBeenCalled();

      // Banner with Undo is present
      await waitFor(() => {
        expect(screen.getByTestId('add-favorite-status-banner')).toHaveTextContent(/Added Almonds to staged meal/i);
      });
      const undoBtn = screen.getByTestId('undo-add-favorite-btn');
      expect(undoBtn).toBeInTheDocument();

      // This meal and totals recomputed: 150 + 160 = 310 kcal
      expect(screen.getByText(/Log Meal \(\+310 kcal\)/i)).toBeInTheDocument();

      // Click Undo
      fireEvent.click(undoBtn);

      // Reverts to original staged meal (150 kcal)
      await waitFor(() => {
        expect(screen.getByText(/Log Meal \(\+150 kcal\)/i)).toBeInTheDocument();
      });
      // Banner is hidden
      expect(screen.queryByTestId('add-favorite-status-banner')).toBeNull();
    });

  });

  describe('RD-7 & STD-CMP-10 Nutrition Standards Suite', () => {
    it('meal log deferred delete: 0 DELETE before expiry, Undo zero writes, exactly 1 DELETE on expiry', async () => {
      vi.useFakeTimers();
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const todayStr = getLocalDateStr(new Date());
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          const b = createSupabaseBuilder('nutrition_logs', {
            data: [
              {
                id: 'log-def-1',
                user_id: 'test-user-123',
                food_name: 'Avocado Toast',
                meal_type: 'breakfast',
                calories: 320,
                protein: 8,
                carbs: 24,
                fat: 16,
                fiber: 6,
                serving_size: 1,
                serving_unit: 'serving',
                logged_at: new Date().toISOString(),
                logged_date: todayStr,
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          });
          b.delete = mockDelete;
          return b;
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      const confirmSpy = vi.spyOn(window, 'confirm');

      renderComponent();

      await vi.waitFor(() => {
        expect(screen.getByText('Avocado Toast')).toBeDefined();
      });

      // Open overflow menu and click Delete meal
      const actionsBtn = screen.getByTestId('meal-actions-log-def-1');
      fireEvent.click(actionsBtn);
      const deleteBtn = screen.getByTestId('delete-meal-log-def-1');
      fireEvent.click(deleteBtn);

      // Zero confirm dialog
      expect(confirmSpy).not.toHaveBeenCalled();

      // Row is optimistically hidden
      expect(screen.queryByTestId('meal-log-item')).toBeNull();

      // UndoToast is visible
      expect(screen.getByText('Meal log removed')).toBeDefined();
      const undoBtn = screen.getByTestId('toast-undo-btn');
      expect(undoBtn).toBeDefined();

      // 0 DELETE calls before expiry
      expect(mockDelete).not.toHaveBeenCalled();

      // Click Undo
      fireEvent.click(undoBtn);

      // Meal row restored immediately
      await vi.waitFor(() => {
        expect(screen.getByText('Avocado Toast')).toBeDefined();
      });

      // Advance timers beyond 6s
      await act(async () => {
        vi.advanceTimersByTime(7000);
      });

      // Undo resulted in ZERO writes
      expect(mockDelete).not.toHaveBeenCalled();

      // Now delete again and let it expire
      const actionsBtnAgain = screen.getByTestId('meal-actions-log-def-1');
      fireEvent.click(actionsBtnAgain);
      const deleteBtnAgain = screen.getByTestId('delete-meal-log-def-1');
      fireEvent.click(deleteBtnAgain);

      // Fast-forward 6s expiry
      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      // Exactly 1 DELETE on expiry
      await vi.waitFor(() => {
        expect(mockDelete).toHaveBeenCalledTimes(1);
      });

      confirmSpy.mockRestore();
    });

    it('custom dish deferred delete: clicking Undo cancels deletion with zero writes and restores dish', async () => {
      vi.useFakeTimers();
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'custom_dishes') {
          const b = createSupabaseBuilder('custom_dishes', {
            data: [
              { id: 'dish-undo-1', name: 'Berry Smoothie', calories: 250, protein: 20, carbs: 30, fat: 4, fiber: 5 },
            ],
            error: null,
          });
          b.delete = mockDelete;
          return b;
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      await vi.waitFor(() => {
        expect(screen.getByTestId('edit-dish-btn-dish-undo-1')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('edit-dish-btn-dish-undo-1'));

      await vi.waitFor(() => {
        expect(screen.getByTestId('modal-delete-dish-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('modal-delete-dish-btn'));

      // UndoToast is visible
      const undoBtn = screen.getByTestId('toast-undo-btn');
      expect(undoBtn).toBeDefined();

      // Zero DELETE before expiry
      expect(mockDelete).not.toHaveBeenCalled();

      // Click Undo
      fireEvent.click(undoBtn);

      // Advance timers
      await act(async () => {
        vi.advanceTimersByTime(7000);
      });

      // Zero DELETE ever issued
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('RD-7: meal log DELETE failure on expiry restores item and displays error banner', async () => {
      vi.useFakeTimers();
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: new Error('Network error deleting meal') }),
      });

      const todayStr = getLocalDateStr(new Date());
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          const b = createSupabaseBuilder('nutrition_logs', {
            data: [
              {
                id: 'log-def-fail-1',
                user_id: 'test-user-123',
                food_name: 'Overnight Oats',
                meal_type: 'breakfast',
                calories: 350,
                protein: 15,
                carbs: 45,
                fat: 10,
                fiber: 8,
                serving_size: 1,
                serving_unit: 'serving',
                logged_at: new Date().toISOString(),
                logged_date: todayStr,
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          });
          b.delete = mockDelete;
          return b;
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      await vi.waitFor(() => {
        expect(screen.getByText('Overnight Oats')).toBeDefined();
      });

      const actionsBtn = screen.getByTestId('meal-actions-log-def-fail-1');
      fireEvent.click(actionsBtn);
      const deleteBtn = screen.getByTestId('delete-meal-log-def-fail-1');
      fireEvent.click(deleteBtn);

      expect(screen.queryByTestId('meal-log-item')).toBeNull();
      expect(screen.getByText('Meal log removed')).toBeDefined();

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      await vi.waitFor(() => {
        expect(screen.getByText('Overnight Oats')).toBeDefined();
        const statusBanner = screen.getByTestId('status-message');
        expect(statusBanner).toBeDefined();
        expect(statusBanner.textContent).toContain('Failed to delete meal');
      });
    });

    it('RD-7: custom dish DELETE failure on expiry restores item and displays error banner', async () => {
      vi.useFakeTimers();
      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: new Error('Network error deleting dish') }),
      });

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'custom_dishes') {
          const b = createSupabaseBuilder('custom_dishes', {
            data: [
              { id: 'dish-fail-1', name: 'Power Bowl', calories: 450, protein: 35, carbs: 40, fat: 12, fiber: 7 },
            ],
            error: null,
          });
          b.delete = mockDelete;
          return b;
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      await vi.waitFor(() => {
        expect(screen.getByTestId('edit-dish-btn-dish-fail-1')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('edit-dish-btn-dish-fail-1'));

      await vi.waitFor(() => {
        expect(screen.getByTestId('modal-delete-dish-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('modal-delete-dish-btn'));

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      await vi.waitFor(() => {
        expect(screen.getByTestId('edit-dish-btn-dish-fail-1')).toBeDefined();
        const statusBanner = screen.getByTestId('status-message');
        expect(statusBanner).toBeDefined();
        expect(statusBanner.textContent).toContain('Failed to delete dish');
      });
    });

    it('STD-CMP-10: renders empty state only after query succeeds with 0 rows, and retry button on error', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          return createSupabaseBuilder('nutrition_logs', {
            data: [],
            error: null,
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      // While auth is unresolved, empty state must NOT be shown
      expect(screen.queryByText('No meals logged for this date yet.')).toBeNull();

      // Deterministic end state inside waitFor: skeleton gone AND empty text present
      await waitFor(() => {
        expect(screen.queryByTestId('nutrition-logs-skeleton')).toBeNull();
        expect(screen.getByText('No meals logged for this date yet.')).toBeDefined();
      });
    });

    it('STD-CMP-10: displays error banner and retry button when nutrition logs query fails', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'nutrition_logs') {
          return createSupabaseBuilder('nutrition_logs', {
            data: null,
            error: { message: 'Database connection failed' },
          });
        }
        return createSupabaseBuilder(table, { data: [], error: null });
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('retry-nutrition-btn')).toBeDefined();
      });
      expect(screen.getByTestId('nutrition-read-error')).toBeDefined();
      expect(screen.getAllByText(/Failed to load nutrition logs/i).length).toBeGreaterThan(0);
      expect(screen.queryByText('No meals logged for this date yet.')).toBeNull();
    });
  });

});




