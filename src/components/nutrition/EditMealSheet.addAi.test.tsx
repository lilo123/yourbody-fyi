import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { EditMealSheet } from './EditMealSheet';
import type { NutritionLog } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';
import { createSupabaseBuilder, clearMockHistory } from '../../test/supabaseBuilderMock';
import { supabase } from '../../lib/supabase';

const mockUpdate = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const builder = createSupabaseBuilder(table, [{ id: 'log-1' }]);
      builder.update = vi.fn((payload: any) => {
        mockUpdate(payload);
        return createSupabaseBuilder(table, [{ id: 'log-1' }]);
      }) as any;
      return builder;
    }),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

function component(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'c1',
    name: 'Steak',
    quantity: 200,
    unit: 'g',
    displayPortion: '200 g',
    calories: 500,
    protein: 50,
    carbs: 0,
    fat: 30,
    fiber: 0,
    ...over,
  };
}

function sampleMeal(items: NutritionItem[] | null, over: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'log-1',
    user_id: 'u1',
    food_name: 'Dinner Steak',
    calories: 500,
    protein: 50,
    carbs: 0,
    fat: 30,
    fiber: 0,
    meal_type: 'Dinner',
    serving_size: 1,
    serving_unit: 'serving',
    logged_at: '2026-09-26T19:00:00.000Z',
    logged_date: '2026-09-26',
    items,
    ...over,
  };
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('EditMealSheet Add Items with AI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
  });

  it('adds items with AI to draft: appends items, updates totals, marks dirty, does NOT trigger toast', async () => {
    const client = createClient();
    const currentMeal = sampleMeal([component()]);
    const onClose = vi.fn();
    const triggerToast = vi.fn();

    // Mock parse response
    (supabase.functions.invoke as any).mockResolvedValueOnce({
      data: {
        items: [
          {
            name: 'Baked Potato',
            portion: '1 medium',
            quantity: 1,
            unit: 'unit',
            calories: 160,
            protein: 4,
            carbs: 37,
            fat: 0.2,
            fiber: 4,
          },
        ],
      },
      error: null,
    });

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={onClose}
          triggerToast={triggerToast}
        />
      </QueryClientProvider>
    );

    // Save button should initially be disabled (!isDirty)
    const saveBtn = screen.getByTestId('save-edit-meal-btn');
    expect(saveBtn).toBeDisabled();

    // 1. Click "+ Add" button to open composer
    const addBtn = screen.getByTestId('add-item-button');
    expect(addBtn.textContent?.trim()).toBe('+ Add');
    expect(addBtn.getAttribute('aria-label')).toBe('Add item');
    fireEvent.click(addBtn);

    const composer = screen.getByTestId('add-items-composer');
    expect(composer).toBeDefined();

    // 2. Type text in composer
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 baked potato' } });

    // 3. Click Analyze
    fireEvent.click(screen.getByTestId('analyze-items-button'));

    // 4. Composer closes, Baked Potato added to items
    await waitFor(() => {
      expect(screen.queryByTestId('add-items-composer')).toBeNull();
      const card = screen.getByTestId('staged-meal-card');
      expect(card.textContent).toContain('Baked Potato');
    });

    // 5. Totals updated: 500 + 160 = 660 kcal
    const totalsGrid = screen.getByTestId('staged-meal-totals-grid');
    expect(totalsGrid).toHaveTextContent('660');

    // 6. Save changes button is now enabled (dirty)
    expect(saveBtn).not.toBeDisabled();

    // 7. No toast triggered in edit mode
    expect(triggerToast).not.toHaveBeenCalled();
  });

  it('drops result if edit sheet is closed while parse is pending', async () => {
    const client = createClient();
    const currentMeal = sampleMeal([component()]);

    let resolveParse: any;
    (supabase.functions.invoke as any).mockReturnValueOnce(
      new Promise((res) => {
        resolveParse = res;
      })
    );

    const TestHarness = () => {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <QueryClientProvider client={client}>
          <EditMealSheet
            isOpen={isOpen}
            meal={currentMeal}
            onClose={() => setIsOpen(false)}
          />
        </QueryClientProvider>
      );
    };

    render(<TestHarness />);

    // Open composer
    fireEvent.click(screen.getByTestId('add-item-button'));
    const textarea = screen.getByPlaceholderText('e.g. a banana and 200 ml oat milk');
    fireEvent.change(textarea, { target: { value: '1 potato' } });

    // Click analyze (now pending)
    fireEvent.click(screen.getByTestId('analyze-items-button'));

    // Close the sheet
    fireEvent.click(screen.getByTestId('close-edit-meal-sheet-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('edit-meal-sheet')).toBeNull();
    });

    // Resolve parse
    resolveParse({
      data: {
        items: [{ name: 'Potato', calories: 150, protein: 3, carbs: 30, fat: 0, fiber: 2 }],
      },
      error: null,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Sheet remains closed without errors
    expect(screen.queryByTestId('edit-meal-sheet')).toBeNull();
  });
});
