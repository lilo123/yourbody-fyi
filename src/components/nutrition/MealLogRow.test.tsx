import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MealLogRow } from './MealLogRow';
import type { NutritionLog } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';
import { supabase } from '../../lib/supabase';
import {
  createSupabaseBuilder,
  getRecordedSelects,
  clearMockHistory,
} from '../../test/supabaseBuilderMock';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

function component(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    id: 'c1',
    name: 'Rolled oats',
    quantity: 80,
    unit: 'g',
    displayPortion: '1 cup',
    calories: 300,
    protein: 10,
    carbs: 54,
    fat: 5,
    fiber: 8,
    ...over,
  };
}

function log(items: NutritionItem[] | null): NutritionLog {
  const sum = (k: keyof NutritionItem) =>
    (items ?? []).reduce((a, i) => a + (i[k] as number), 0);
  return {
    id: 'log-1',
    user_id: 'u1',
    food_name: 'Office Breakfast',
    calories: items ? sum('calories') : 500,
    protein: items ? sum('protein') : 30,
    carbs: items ? sum('carbs') : 50,
    fat: items ? sum('fat') : 20,
    fiber: items ? sum('fiber') : 6,
    meal_type: 'Breakfast',
    logged_at: '2026-01-01T08:00:00Z',
    items,
  };
}

const noop = () => {};

describe('MealLogRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    (supabase.from as any).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { data: null, error: null })
    );
  });

  it('renders no accordion affordance for a single-component or plain log', () => {
    render(<MealLogRow log={log(null)} onEdit={noop} onDelete={noop} />);

    // Every pre-existing production log is a leaf. If they all looked
    // expandable the feature would look broken on day one.
    expect(screen.queryByTestId('meal-log-accordion-trigger')).toBeNull();
    expect(screen.queryByTestId('meal-log-count-badge')).toBeNull();
  });

  it('treats a one-item breakdown as a leaf, not a one-child accordion', () => {
    render(<MealLogRow log={log([component()])} onEdit={noop} onDelete={noop} />);
    expect(screen.queryByTestId('meal-log-accordion-trigger')).toBeNull();
  });

  it('renders no accordion affordance when items is omitted from projection (undefined)', () => {
    const rowWithoutItems: NutritionLog = {
      id: 'log-no-items',
      user_id: 'u1',
      food_name: 'Plain Rice',
      calories: 200,
      protein: 4,
      carbs: 45,
      fat: 1,
      fiber: 1,
      meal_type: 'Lunch',
      logged_at: '2026-01-01T12:00:00Z',
      // items omitted
    };
    render(<MealLogRow log={rowWithoutItems} onEdit={noop} onDelete={noop} />);
    expect(screen.queryByTestId('meal-log-accordion-trigger')).toBeNull();
    expect(screen.queryByTestId('meal-log-count-badge')).toBeNull();
  });

  it('expands a multi-component log and lists its components read-only', () => {
    const items = [component(), component({ id: 'c2', name: 'Whey', calories: 120, quantity: 30 })];
    render(<MealLogRow log={log(items)} onEdit={noop} onDelete={noop} />);

    const trigger = screen.getByTestId('meal-log-accordion-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('meal-log-count-badge').textContent).toBe('2');
    expect(screen.queryByTestId('meal-log-panel')).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const panel = screen.getByTestId('meal-log-panel');
    expect(within(panel).getAllByTestId('component-row')).toHaveLength(2);
    expect(trigger.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));

    // Read-only presentation, no scale bar, no quantity input, no unit chip
    expect(screen.queryByTestId('dish-scale-bar')).toBeNull();
    expect(screen.queryByTestId('component-quantity-input')).toBeNull();
    expect(screen.queryByTestId('component-unit-chip')).toBeNull();
    expect(screen.getByText('Rolled oats')).toBeDefined();
    expect(screen.getByText('80g')).toBeDefined();
    expect(screen.getByText('Whey')).toBeDefined();
    expect(screen.getByText('30g')).toBeDefined();
  });

  it('hides every mutating affordance when read-only', () => {
    const items = [component(), component({ id: 'c2' })];
    render(
      <MealLogRow log={log(items)} onEdit={noop} onDelete={noop} readOnly />
    );

    expect(screen.queryByTestId('meal-actions-log-1')).toBeNull();

    // Expanding is still permitted: a coach may read the breakdown.
    fireEvent.click(screen.getByTestId('meal-log-accordion-trigger'));
    expect(screen.getByTestId('meal-log-panel')).toBeDefined();
    expect(screen.queryByTestId('dish-scale-bar')).toBeNull();
    expect(screen.queryByTestId('component-quantity-input')).toBeNull();
    expect(screen.queryByTestId('component-unit-chip')).toBeNull();
  });

  it('renders expanded component rows strictly read-only with no scale bar and no action menus', () => {
    const items = [
      component({ id: 'c1', name: 'Oatmeal', quantity: 100, unit: 'g', calories: 380, protein: 13, carbs: 68, fat: 7, fiber: 10 }),
      component({ id: 'c2', name: 'Almond Milk', quantity: 200, unit: 'ml', calories: 60, protein: 2, carbs: 4, fat: 5, fiber: 1 }),
    ];
    render(<MealLogRow log={log(items)} onEdit={noop} onDelete={noop} />);

    fireEvent.click(screen.getByTestId('meal-log-accordion-trigger'));

    // No scale bar
    expect(screen.queryByTestId('dish-scale-bar')).toBeNull();

    // No editing inputs or unit chips
    expect(screen.queryAllByTestId('component-quantity-input')).toHaveLength(0);
    expect(screen.queryAllByTestId('component-unit-chip')).toHaveLength(0);

    // No component action menus (⋯)
    expect(screen.queryAllByTestId('component-actions')).toHaveLength(0);

    // Read-only quantities visible
    expect(screen.getByText('100g')).toBeDefined();
    expect(screen.getByText('200ml')).toBeDefined();
  });

  it('exposes edit and delete only after the overflow menu is opened', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<MealLogRow log={log(null)} onEdit={onEdit} onDelete={onDelete} />);

    expect(screen.queryByTestId('edit-meal-log-1')).toBeNull();

    fireEvent.click(screen.getByTestId('meal-actions-log-1'));
    fireEvent.click(screen.getByTestId('delete-meal-log-1'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows totals derived from components rather than the stored parent scalar', () => {
    const items = [component({ calories: 100 }), component({ id: 'c2', calories: 250 })];
    const drifted = { ...log(items), calories: 999 };
    render(<MealLogRow log={drifted} onEdit={noop} onDelete={noop} />);

    expect(screen.getByText(/350 kcal/)).toBeDefined();
    expect(screen.queryByText(/999 kcal/)).toBeNull();
  });

  it('ignores a malformed items payload instead of crashing', () => {
    const broken = { ...log(null), items: 'not an array' as unknown as NutritionItem[] };
    render(<MealLogRow log={broken} onEdit={noop} onDelete={noop} />);

    expect(screen.getByTestId('meal-log-item')).toBeDefined();
    expect(screen.queryByTestId('meal-log-accordion-trigger')).toBeNull();
    expect(screen.getByText(/500 kcal/)).toBeDefined();
  });

  it('updates displayed totals and components when log prop updates with new items', () => {
    const items = [component(), component({ id: 'c2', name: 'Whey', calories: 120, protein: 25 })];
    const { rerender } = render(
      <MealLogRow log={log(items)} onEdit={noop} onDelete={noop} />
    );

    expect(screen.getByText(/420 kcal/)).toBeDefined();

    // The meal is changed via EditMealSheet and query refetches with updated items
    const edited = [component({ calories: 999 }), component({ id: 'c2', name: 'Whey', calories: 1 })];
    rerender(<MealLogRow log={log(edited)} onEdit={noop} onDelete={noop} />);

    expect(screen.getByText(/1000 kcal/)).toBeDefined();
    expect(screen.queryByText(/420 kcal/)).toBeNull();
  });

  it('does not fan out queries on mount when items are omitted and fetches exactly 1 query on expand', async () => {
    const multiItems = [
      component({ id: 'c1', name: 'Salmon', calories: 300 }),
      component({ id: 'c2', name: 'Rice', calories: 200 }),
    ];

    const rows: (NutritionLog & { has_components?: boolean })[] = Array.from({ length: 10 }, (_, i) => ({
      id: `log-multi-${i}`,
      user_id: 'u1',
      food_name: `Meal ${i}`,
      calories: 500,
      protein: 40,
      carbs: 45,
      fat: 15,
      fiber: 5,
      meal_type: 'Dinner',
      logged_at: '2026-01-01T18:00:00Z',
      has_components: i === 0,
    }));

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: { id: 'log-multi-0', items: multiItems },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    render(
      <div>
        {rows.map((r) => (
          <MealLogRow key={r.id} log={r} onEdit={noop} onDelete={noop} />
        ))}
      </div>
    );

    // Assert zero queries before expand: eliminates the N+1 fan-out regression
    const queriesBefore = getRecordedSelects().filter((s) => s.table === 'nutrition_logs');
    expect(queriesBefore.length).toBe(0);

    // Assert honest conservative presentation: only row 0 has trigger, rows 1-9 render as leaves
    const triggers = screen.queryAllByTestId('meal-log-accordion-trigger');
    expect(triggers).toHaveLength(1);

    // Expand the single expandable row
    fireEvent.click(triggers[0]);

    // Assert exactly 1 query after one expand (lazy on-demand fetch)
    await waitFor(() => {
      const queriesAfter = getRecordedSelects().filter((s) => s.table === 'nutrition_logs');
      expect(queriesAfter.length).toBe(1);
    });

    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection: 'id, items',
    });

    // Components rendered in panel
    expect(await screen.findByTestId('meal-log-panel')).toBeDefined();
    expect(screen.getByText('Salmon')).toBeDefined();
    expect(screen.getByText('Rice')).toBeDefined();
  });

  it('surfaces an error state with retry button when on-demand fetch fails on expand and allows retry', async () => {
    const rowWithComponents: NutritionLog & { has_components?: boolean } = {
      id: 'log-fetch-error-test',
      user_id: 'u1',
      food_name: 'Failed Fetch Meal',
      calories: 400,
      protein: 30,
      carbs: 40,
      fat: 10,
      fiber: 4,
      meal_type: 'Lunch',
      logged_at: '2026-01-01T12:00:00Z',
      has_components: true,
    };

    // First attempt: on-demand fetch fails
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: null,
          error: { message: 'Network timeout loading components' },
        });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    const { container } = render(<MealLogRow log={rowWithComponents} onEdit={noop} onDelete={noop} />);

    // 0 queries on mount
    expect(getRecordedSelects().filter((s) => s.table === 'nutrition_logs').length).toBe(0);

    // Trigger is rendered because has_components is true
    const trigger = screen.getByTestId('meal-log-accordion-trigger');
    fireEvent.click(trigger);

    // Must surface error state with role="alert" in persistent live region and data-testid="meal-log-fetch-error"
    const errorAlert = await screen.findByTestId('meal-log-fetch-error');
    expect(errorAlert.textContent).toContain('Network timeout loading components');
    const alertRegions = container.querySelectorAll('[role="alert"]');
    const speakingAlert = Array.from(alertRegions).find((r) =>
      r.textContent?.includes('Network timeout loading components')
    );
    expect(speakingAlert).toBeDefined();

    // Must provide retry button
    const retryBtn = screen.getByTestId('meal-log-fetch-retry');
    expect(retryBtn).toBeDefined();

    // Second attempt: retry succeeds with 2 components
    const multiItems = [
      component({ id: 'c1', name: 'Chicken', calories: 250 }),
      component({ id: 'c2', name: 'Rice', calories: 150 }),
    ];
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'nutrition_logs') {
        return createSupabaseBuilder('nutrition_logs', {
          data: { id: 'log-fetch-error-test', items: multiItems },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    // Click retry
    fireEvent.click(retryBtn);

    // Error alert disappears, and panel expands
    await waitFor(() => {
      expect(screen.queryByTestId('meal-log-fetch-error')).toBeNull();
    });
    expect(await screen.findByTestId('meal-log-panel')).toBeDefined();
    expect(screen.getByText('Chicken')).toBeDefined();
    expect(screen.getByText('Rice')).toBeDefined();
  });

  it('maintains conservative leaf presentation (expandable = false) when has_components is omitted', () => {
    const leafRows: NutritionLog[] = Array.from({ length: 10 }, (_, i) => ({
      id: `log-leaf-${i}`,
      user_id: 'u1',
      food_name: `Plain Meal ${i}`,
      calories: 300,
      protein: 20,
      carbs: 30,
      fat: 10,
      fiber: 2,
      meal_type: 'Breakfast',
      logged_at: '2026-01-01T08:00:00Z',
    }));

    render(
      <div>
        {leafRows.map((r) => (
          <MealLogRow key={r.id} log={r} onEdit={noop} onDelete={noop} />
        ))}
      </div>
    );

    // No queries issued
    expect(getRecordedSelects().filter((s) => s.table === 'nutrition_logs').length).toBe(0);
    // 0 accordion triggers or badges rendered
    expect(screen.queryAllByTestId('meal-log-accordion-trigger')).toHaveLength(0);
    expect(screen.queryAllByTestId('meal-log-count-badge')).toHaveLength(0);
  });
});
