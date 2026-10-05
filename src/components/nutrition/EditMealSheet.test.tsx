import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditMealSheet } from './EditMealSheet';
import type { NutritionLog } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';
import { createSupabaseBuilder, clearMockHistory } from '../../test/supabaseBuilderMock';
import { supabase } from '../../lib/supabase';
import { expectNoA11yViolations } from '../../test/a11y';

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

function meal(items: NutritionItem[] | null, over: Partial<NutritionLog> = {}): NutritionLog {
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

describe('EditMealSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
  });

  it('renders AccessibleModal shell and focuses heading on open without focusing an input', async () => {
    const client = createClient();
    const currentMeal = meal([component()]);
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={onClose}
        />
      </QueryClientProvider>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'edit-meal-sheet-title');

    const heading = screen.getByRole('heading', { name: /Edit Meal/i });
    expect(heading).toBeInTheDocument();
    expect(heading.id).toBe('edit-meal-sheet-title');

    // Wait for animation frame / mount focus
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });

    // Heading has tabIndex -1 so soft keyboard does not pop up
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    expect(document.activeElement?.tagName).not.toBe('TEXTAREA');
  });

  it('restores focus to opener button on close', async () => {
    function TestWrapper() {
      const [open, setOpen] = useState(false);
      const client = createClient();
      return (
        <QueryClientProvider client={client}>
          <button data-testid="row-actions-btn" onClick={() => setOpen(true)}>
            ⋯
          </button>
          <EditMealSheet
            isOpen={open}
            meal={meal([component()])}
            onClose={() => setOpen(false)}
          />
        </QueryClientProvider>
      );
    }

    render(<TestWrapper />);
    const opener = screen.getByTestId('row-actions-btn');
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click Cancel button
    const cancelBtn = screen.getByTestId('cancel-edit-meal-btn');
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('does NOT close on Escape or backdrop click when draft is dirty, but closes on Cancel', async () => {
    const client = createClient();
    const currentMeal = meal([component()]);
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={onClose}
        />
      </QueryClientProvider>
    );

    // Make draft dirty by editing name input
    const nameInput = screen.getByTestId('dish-name-input');
    fireEvent.change(nameInput, { target: { value: 'Dirty Steak Name' } });

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    // Click backdrop overlay
    const overlay = screen.getByTestId('edit-meal-sheet-overlay');
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    // Click Cancel button: always closes
    const cancelBtn = screen.getByTestId('cancel-edit-meal-btn');
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('D46: Escape in the Scale box cancels the scale edit and keeps the sheet open', () => {
    const client = createClient();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <EditMealSheet isOpen={true} meal={meal([component()])} onClose={onClose} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('meal-scale-input')).toBeNull();
    expect(screen.getByTestId('component-quantity-input')).toHaveValue(200);
    expect(screen.getByTestId('save-edit-meal-btn')).toBeDisabled();
  });

  it('D46: Scale x0.5 marks the draft dirty, scale x1 makes it clean again, and Save writes the scaled item', async () => {
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <EditMealSheet isOpen={true} meal={meal([component()])} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    const scaleTo = (value: string) => {
      fireEvent.click(screen.getByTestId('meal-scale-button'));
      const input = screen.getByTestId('meal-scale-input');
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };

    scaleTo('0.5');
    expect(screen.getByTestId('component-quantity-input')).toHaveValue(100);
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('×0.5');
    expect(screen.getByTestId('save-edit-meal-btn')).not.toBeDisabled();

    scaleTo('1');
    expect(screen.getByTestId('component-quantity-input')).toHaveValue(200);
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('Scale');
    expect(screen.getByTestId('save-edit-meal-btn')).toBeDisabled();

    scaleTo('0.5');
    fireEvent.click(screen.getByTestId('save-edit-meal-btn'));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ calories: 250, protein: 25, fat: 15, serving_size: 100 })
      );
    });
  });

  it('closes on Escape and backdrop click when draft is NOT dirty', () => {
    const client = createClient();
    const currentMeal = meal([component()]);
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={onClose}
        />
      </QueryClientProvider>
    );

    // Press Escape on clean draft
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();

    // Click backdrop on clean draft
    const overlay = screen.getByTestId('edit-meal-sheet-overlay');
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('computes Day total as eaten that day excluding this meal + draft', () => {
    const client = createClient();
    const otherMeal = meal(null, {
      id: 'log-2',
      food_name: 'Lunch Salad',
      calories: 300,
      protein: 15,
      carbs: 20,
      fat: 10,
      fiber: 5,
      logged_date: '2026-09-26',
    });
    const currentMeal = meal([component({ calories: 500, protein: 50 })], {
      id: 'log-1',
      calories: 500,
      protein: 50,
      logged_date: '2026-09-26',
    });

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={vi.fn()}
          nutritionLogs={[otherMeal, currentMeal]}
          targets={{ calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 }}
        />
      </QueryClientProvider>
    );

    // Day total should be otherMeal (300 kcal) + currentMeal draft (500 kcal) = 800 kcal
    const dayTotalGrid = screen.getByTestId('day-total-grid');
    expect(dayTotalGrid).toBeInTheDocument();
    expect(dayTotalGrid.textContent).toContain('800');
  });

  it('renders nothing when readOnly is true (coach read-only)', () => {
    const client = createClient();
    const currentMeal = meal([component()]);

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={vi.fn()}
          readOnly={true}
        />
      </QueryClientProvider>
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing when readOnly is true (coach inspection mode) (D44)', () => {
    const client = createClient();
    const currentMeal = meal([component()]);

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={vi.fn()}
          readOnly={true}
        />
      </QueryClientProvider>
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const client = createClient();
    const currentMeal = meal([component()]);

    const { container } = render(
      <QueryClientProvider client={client}>
        <EditMealSheet
          isOpen={true}
          meal={currentMeal}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    await expectNoA11yViolations(container);
  });
  it('preserves user edits to meal name while on-demand items fetch resolves', async () => {
    let resolveItemsFetch: (value: any) => void = () => {};
    const itemsFetchPromise = new Promise((resolve) => {
      resolveItemsFetch = resolve;
    });

    const client = createClient();
    const currentMeal: NutritionLog = {
      id: 'log-multi',
      user_id: 'u1',
      food_name: 'Original Meal Name',
      calories: 400,
      protein: 27,
      carbs: 43,
      fat: 10,
      fiber: 0,
      meal_type: 'Breakfast',
      serving_size: 1,
      serving_unit: 'serving',
      logged_at: '2026-09-29T10:00:00.000Z',
      logged_date: '2026-09-29',
      has_components: true,
      items: undefined,
    };

    const originalFrom = supabase.from;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        const builder = createSupabaseBuilder(table);
        builder.maybeSingle = vi.fn(() => itemsFetchPromise as any);
        return builder;
      }
      return originalFrom(table as any);
    });

    render(
      <QueryClientProvider client={client}>
        <EditMealSheet isOpen={true} meal={currentMeal} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    const nameInput = screen.getByTestId('dish-name-input');
    expect(nameInput).toHaveValue('Original Meal Name');

    // User types new name while fetch is pending
    fireEvent.change(nameInput, { target: { value: 'Edited In History' } });
    expect(nameInput).toHaveValue('Edited In History');
    expect(screen.getByTestId('save-edit-meal-btn')).not.toBeDisabled();

    // Now resolve the async items fetch
    resolveItemsFetch({
      data: {
        id: 'log-multi',
        items: [
          component({ id: 'c1', name: 'Meal Item', calories: 300 }),
          component({ id: 'c2', name: 'Side Salad', calories: 100 }),
        ],
      },
      error: null,
    });

    // Await state updates
    await waitFor(() => {
      expect(screen.getByTestId('dish-name-input')).toHaveValue('Edited In History');
    });

    // Save button must remain enabled because name was edited!
    expect(screen.getByTestId('save-edit-meal-btn')).not.toBeDisabled();
  });
});
