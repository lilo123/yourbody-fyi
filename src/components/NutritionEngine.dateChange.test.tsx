import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NutritionEngine } from './nutrition/NutritionEngine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { isWithinDayBounds } from '../utils/date';
import { createSupabaseBuilder, clearMockHistory } from '../test/supabaseBuilderMock';
import { setFlusherSupabaseClient } from '../offline/flusher';

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

describe('NutritionEngine — Staged meal survives date change (D29)', () => {
  let queryClient: QueryClient;
  const dateX = '2026-09-25';
  const dateY = '2026-09-26';

  beforeEach(() => {
    // setupTests imports the flusher before this file's vi.mock('../lib/supabase') is registered,
    // so point the flusher at the mocked client explicitly.
    setFlusherSupabaseClient(supabase);
    vi.clearAllMocks();
    clearMockHistory();
    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

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
            <NutritionEngine />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  it('(a) AI path: stage a meal on date X -> change date to Y -> tap Log -> insert receives date Y', async () => {
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
        name: 'Avocado Toast & Poached Egg',
        calories: 350,
        protein: 15,
        carbs: 30,
        fat: 18,
        fiber: 6,
        explanation: 'Toast + Avocado + Egg = 350 kcal',
        items: [
          { name: 'Sourdough Toast', portion: '1 slice', calories: 120, protein: 4, carbs: 22, fat: 1, fiber: 1, quantity: 1, unit: 'unit' },
          { name: 'Avocado', portion: '50g', calories: 80, protein: 1, carbs: 4, fat: 7, fiber: 3, quantity: 50, unit: 'g' },
          { name: 'Poached Egg', portion: '1 large', calories: 150, protein: 10, carbs: 4, fat: 10, fiber: 2, quantity: 1, unit: 'unit' },
        ],
      },
      error: null,
    });

    renderComponent();

    // 1. Explicitly select date X
    const dateInput = screen.getByTestId('nutrition-date-input');
    fireEvent.change(dateInput, { target: { value: dateX } });
    expect((dateInput as HTMLInputElement).value).toBe(dateX);

    // 2. Stage meal via AI
    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'avocado toast and poached egg');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
      expect(screen.getByText('Log Meal (+350 kcal)')).toBeInTheDocument();
    });

    // 3. Change date to Y while meal is staged
    fireEvent.change(dateInput, { target: { value: dateY } });
    expect((dateInput as HTMLInputElement).value).toBe(dateY);

    // 4. Verify staged meal card is still present (c)
    expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();

    // 5. Tap Log
    fireEvent.click(screen.getByText('Log Meal (+350 kcal)'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    // Exact payload fields the app uses for log date (src/components/nutrition/NutritionEngine.tsx:162-163)
    expect(payload.logged_date).toBe(dateY);
    expect(isWithinDayBounds(payload.logged_at, dateY)).toBe(true);
    expect(isWithinDayBounds(payload.logged_at, dateX)).toBe(false);
    expect(payload.logged_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(new Date(payload.logged_at).toISOString()).toBe(payload.logged_at);
    expect(payload.food_name).toBe('Avocado Toast & Poached Egg');
    expect(payload.calories).toBe(350);
  });

  it('(a) Manual path: stage a meal on date X -> change date to Y -> tap Log -> insert receives date Y', async () => {
    const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) });
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      if (table === 'nutrition_logs') {
        b.insert = mockInsert;
      }
      return b;
    });

    renderComponent();

    // 1. Explicitly select date X
    const dateInput = screen.getByTestId('nutrition-date-input');
    fireEvent.change(dateInput, { target: { value: dateX } });
    expect((dateInput as HTMLInputElement).value).toBe(dateX);

    // 2. Open manual entry form
    fireEvent.click(screen.getByText('Manual Entry'));

    await userEvent.type(screen.getByTestId('dish-name-input'), 'Protein Oats');
    await userEvent.type(screen.getByTestId('calories-input'), '420');
    await userEvent.type(screen.getByTestId('protein-input'), '32');
    await userEvent.type(screen.getByTestId('carbs-input'), '55');
    await userEvent.type(screen.getByTestId('fat-input'), '8');
    await userEvent.type(screen.getByTestId('fiber-input'), '7');

    // Submit manual meal form to stage into StagedMealCard (D22)
    fireEvent.click(screen.getByText('Log Meal'));

    expect(mockInsert).not.toHaveBeenCalled();
    expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Protein Oats')).toBeInTheDocument();

    // 3. Change date to Y while meal is staged
    fireEvent.change(dateInput, { target: { value: dateY } });
    expect((dateInput as HTMLInputElement).value).toBe(dateY);

    // 4. Verify staged meal card survives date change (c)
    expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();

    // 5. Tap Log on the staged card
    fireEvent.click(screen.getByRole('button', { name: /log meal \(\+420 kcal\)/i }));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalled();
    });

    const payload = mockInsert.mock.calls[0][0][0];
    // Exact payload fields the app uses for log date (src/components/nutrition/NutritionEngine.tsx:162-163)
    expect(payload.logged_date).toBe(dateY);
    expect(isWithinDayBounds(payload.logged_at, dateY)).toBe(true);
    expect(isWithinDayBounds(payload.logged_at, dateX)).toBe(false);
    expect(payload.logged_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(new Date(payload.logged_at).toISOString()).toBe(payload.logged_at);
    expect(payload.food_name).toBe('Protein Oats');
    expect(payload.calories).toBe(420);
    expect(payload.protein).toBe(32);
  });

  it("(b) Day total row recomputes from date Y's logged intake after date change, not date X's", async () => {
    // Seed different logged intake for date X and date Y in the mocked query layer
    const mockLogs = [
      {
        id: 'log-x1',
        user_id: 'test-user-id',
        food_name: 'Breakfast Date X',
        meal_type: 'Breakfast',
        calories: 500,
        protein: 35,
        carbs: 50,
        fat: 18,
        fiber: 5,
        serving_size: 1,
        serving_unit: 'serving',
        logged_at: `${dateX}T08:00:00.000Z`,
        logged_date: dateX,
        created_at: `${dateX}T08:00:00.000Z`,
        has_components: false,
      },
      {
        id: 'log-y1',
        user_id: 'test-user-id',
        food_name: 'Breakfast Date Y',
        meal_type: 'Breakfast',
        calories: 1200,
        protein: 90,
        carbs: 110,
        fat: 40,
        fiber: 14,
        serving_size: 1,
        serving_unit: 'serving',
        logged_at: `${dateY}T08:00:00.000Z`,
        logged_date: dateY,
        created_at: `${dateY}T08:00:00.000Z`,
        has_components: false,
      },
    ];

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder(table, { data: mockLogs, error: null });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Salmon Bowl',
        calories: 600,
        protein: 45,
        carbs: 50,
        fat: 20,
        fiber: 4,
        explanation: 'Salmon + Rice = 600 kcal',
        items: [
          { name: 'Salmon', portion: '150g', calories: 300, protein: 35, carbs: 0, fat: 18, fiber: 0, quantity: 150, unit: 'g' },
          { name: 'Brown Rice', portion: '200g', calories: 300, protein: 10, carbs: 50, fat: 2, fiber: 4, quantity: 200, unit: 'g' },
        ],
      },
      error: null,
    });

    renderComponent();

    // 1. Start on date X
    const dateInput = screen.getByTestId('nutrition-date-input');
    fireEvent.change(dateInput, { target: { value: dateX } });

    // 2. Stage meal of 600 kcal, 45g protein
    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'salmon bowl');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-day-total')).toBeInTheDocument();
    });

    // On date X:
    // Intake on X = 500 kcal, 35g protein
    // Staged meal = 600 kcal, 45g protein
    // Day total = 500 + 600 = 1100 kcal, 35 + 45 = 80g protein
    expect(screen.getByTestId('day-total-label')).toHaveTextContent('Day total');
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1100');
    expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('80');

    // 3. Change date to Y
    fireEvent.change(dateInput, { target: { value: dateY } });

    // On date Y:
    // Intake on Y = 1200 kcal, 90g protein
    // Staged meal = 600 kcal, 45g protein
    // Day total recomputes to: 1200 + 600 = 1800 kcal, 90 + 45 = 135g protein
    await waitFor(() => {
      expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1800');
      expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('135');
    });

    // Verify it is NOT using date X's total (1100)
    expect(screen.getByTestId('day-total-val-calories')).not.toHaveTextContent('1100');
  });

  it('(c) staged card is still present after date change without discard or confirm modal (D29)', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Greek Yogurt Bowl',
        calories: 250,
        protein: 20,
        carbs: 25,
        fat: 5,
        fiber: 3,
        explanation: 'Yogurt + Berries = 250 kcal',
        items: [
          { name: 'Greek Yogurt', portion: '170g', calories: 150, protein: 18, carbs: 6, fat: 5, fiber: 0, quantity: 170, unit: 'g' },
          { name: 'Blueberries', portion: '100g', calories: 100, protein: 2, carbs: 19, fat: 0, fiber: 3, quantity: 100, unit: 'g' },
        ],
      },
      error: null,
    });

    renderComponent();

    // 1. Start on date X
    const dateInput = screen.getByTestId('nutrition-date-input');
    fireEvent.change(dateInput, { target: { value: dateX } });

    // 2. Stage meal
    const input = screen.getByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );
    await userEvent.type(input, 'greek yogurt bowl');
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    });

    // Verify initial staged card contents
    expect(screen.getByDisplayValue('Greek Yogurt Bowl')).toBeInTheDocument();
    expect(screen.getByText('Greek Yogurt')).toBeInTheDocument();
    expect(screen.getByText('Blueberries')).toBeInTheDocument();

    // 3. Change date from X to Y
    fireEvent.change(dateInput, { target: { value: dateY } });

    // 4. Assert staged card is still present, unmodified, with no confirmation prompt or discard
    expect(screen.getByTestId('staged-meal-card')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Greek Yogurt Bowl')).toBeInTheDocument();
    expect(screen.getByText('Greek Yogurt')).toBeInTheDocument();
    expect(screen.getByText('Blueberries')).toBeInTheDocument();
    expect(screen.getByText('Log Meal (+250 kcal)')).toBeInTheDocument();

    // Confirm no discard confirmation modal or alert is shown
    expect(screen.queryByText(/discard/i)).toBeNull();
    expect(screen.queryByText(/confirm/i)).toBeNull();
  });
});
