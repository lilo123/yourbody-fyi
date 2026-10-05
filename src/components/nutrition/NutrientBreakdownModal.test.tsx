import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  NutrientBreakdownModal,
  type BreakdownNutrient,
} from './NutrientBreakdownModal';
import type { NutritionLog } from '../../types/database';

describe('NutrientBreakdownModal', () => {
  const mockCompositeMeal: NutritionLog = {
    id: 'log-composite-1',
    user_id: 'user-1',
    food_name: 'Egg Frittata Plate',
    calories: 452,
    protein: 25.5,
    carbs: 31.2,
    fat: 24.6,
    fiber: 3.1,
    logged_at: '2026-09-14T12:00:00.000Z',
    items: [
      {
        id: 'item-1',
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
        id: 'item-2',
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
        id: 'item-3',
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
  };

  const mockSingleItemMeal: NutritionLog = {
    id: 'log-single-1',
    user_id: 'user-1',
    food_name: 'Whey Protein Shake',
    calories: 130,
    protein: 25.0,
    carbs: 3.0,
    fat: 1.5,
    fiber: 0.5,
    serving_size: 1,
    serving_unit: 'scoop',
    logged_at: '2026-09-14T08:00:00.000Z',
    items: [
      {
        id: 'item-single',
        name: 'Whey Protein Powder',
        quantity: 1,
        unit: 'unit',
        displayPortion: '1 scoop',
        calories: 130,
        protein: 25.0,
        carbs: 3.0,
        fat: 1.5,
        fiber: 0.5,
      },
    ],
  };

  const mockStandaloneLeafMeal: NutritionLog = {
    id: 'log-leaf-1',
    user_id: 'user-1',
    food_name: 'Apple',
    calories: 95,
    protein: 0.5,
    carbs: 25.0,
    fat: 0.3,
    fiber: 4.4,
    serving_size: 1,
    serving_unit: 'medium apple',
    logged_at: '2026-09-14T15:00:00.000Z',
    items: null,
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    selectedNutrient: 'protein' as BreakdownNutrient,
    onSelectNutrient: vi.fn(),
    logs: [mockCompositeMeal, mockSingleItemMeal, mockStandaloneLeafMeal],
    dailyTotals: {
      calories: 677,
      protein: 51.0,
      carbs: 59.2,
      fat: 26.4,
      fiber: 8.0,
    },
    targets: {
      calories: 2200,
      protein: 160,
      carbs: 220,
      fat: 70,
      fiber: 30,
    },
  };

  it('renders nothing when isOpen is false', () => {
    render(<NutrientBreakdownModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('nutrient-breakdown-modal')).toBeNull();
  });

  it('renders modal dialog with 2-row stacked header and mobile drag handle when open', () => {
    render(<NutrientBreakdownModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByTestId('nutrient-breakdown-modal')).toBeDefined();
    expect(screen.getByTestId('bottom-sheet-drag-handle')).toBeDefined();
    expect(screen.getByText('Nutrient Breakdown')).toBeDefined();
    expect(screen.getByTestId('close-breakdown-modal-btn')).toBeDefined();
  });

  it('calls onClose when close button or backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<NutrientBreakdownModal {...defaultProps} onClose={onClose} />);

    // Click close button
    fireEvent.click(screen.getByTestId('close-breakdown-modal-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click backdrop
    const modalContainer = screen.getByRole('dialog').parentElement!;
    fireEvent.click(modalContainer);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders 5-nutrient segmented pill switcher and triggers onSelectNutrient when clicked', () => {
    const onSelectNutrient = vi.fn();
    render(
      <NutrientBreakdownModal
        {...defaultProps}
        selectedNutrient="calories"
        onSelectNutrient={onSelectNutrient}
      />
    );

    const calPill = screen.getByTestId('nutrient-pill-calories');
    const proteinPill = screen.getByTestId('nutrient-pill-protein');
    const carbsPill = screen.getByTestId('nutrient-pill-carbs');
    const fatPill = screen.getByTestId('nutrient-pill-fat');
    const fiberPill = screen.getByTestId('nutrient-pill-fiber');

    expect(calPill.textContent).toBe('Cal');
    expect(calPill.getAttribute('aria-selected')).toBe('true');

    expect(proteinPill.textContent).toBe('Protein');
    expect(proteinPill.getAttribute('aria-selected')).toBe('false');

    expect(carbsPill.textContent).toBe('Carbs');
    expect(fatPill.textContent).toBe('Fat');
    expect(fiberPill.textContent).toBe('Fiber');

    fireEvent.click(proteinPill);
    expect(onSelectNutrient).toHaveBeenCalledWith('protein');

    fireEvent.click(fiberPill);
    expect(onSelectNutrient).toHaveBeenCalledWith('fiber');
  });

  it('renders daily summary for the selected nutrient with targets', () => {
    render(
      <NutrientBreakdownModal
        {...defaultProps}
        selectedNutrient="protein"
      />
    );

    expect(screen.getByText("Today's Protein")).toBeDefined();
    expect(screen.getByText('51g')).toBeDefined();
    expect(screen.getByText('/ 160g')).toBeDefined();
  });

  it('displays empty state when no logs are present', () => {
    render(
      <NutrientBreakdownModal
        {...defaultProps}
        logs={[]}
        dailyTotals={{ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }}
      />
    );

    expect(screen.getByTestId('breakdown-empty-state')).toBeDefined();
    expect(screen.getByText('No meals logged for this date.')).toBeDefined();
  });

  describe('Hierarchy requirements', () => {
    it('renders Level 1 composite meal with expandable accordion, count badge, and chevron', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="protein"
        />
      );

      const trigger = screen.getByTestId('breakdown-accordion-trigger-log-composite-1');
      expect(trigger).toBeDefined();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      // Count badge displays number of child items (3)
      const countBadge = screen.getByTestId('breakdown-count-badge-log-composite-1');
      expect(countBadge.textContent).toBe('3');

      // Panel is initially collapsed
      expect(screen.queryByTestId('breakdown-accordion-panel-log-composite-1')).toBeNull();

      // Expand accordion
      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      const panel = screen.getByTestId('breakdown-accordion-panel-log-composite-1');
      expect(panel).toBeDefined();

      // Displays each child ingredient
      const childRows = screen.getAllByTestId('breakdown-child-row');
      expect(childRows.length).toBe(3);

      expect(screen.getByText('Egg Frittata')).toBeDefined();
      expect(screen.getByText('Cooking Oil')).toBeDefined();
      expect(screen.getByText('Cucumber & Tomato Pickles')).toBeDefined();

      // Collapse accordion
      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('breakdown-accordion-panel-log-composite-1')).toBeNull();
    });

    it('renders Level 2 standalone / single-item meals as flat leaf rows without chevrons or count badges', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="protein"
        />
      );

      // Single item meal (1 item in items)
      const singleLeafRow = screen.getByTestId('breakdown-leaf-row-log-single-1');
      expect(singleLeafRow).toBeDefined();
      expect(screen.queryByTestId('breakdown-accordion-trigger-log-single-1')).toBeNull();
      expect(screen.queryByTestId('breakdown-count-badge-log-single-1')).toBeNull();

      // Standalone leaf meal (null items)
      const standaloneLeafRow = screen.getByTestId('breakdown-leaf-row-log-leaf-1');
      expect(standaloneLeafRow).toBeDefined();
      expect(screen.queryByTestId('breakdown-accordion-trigger-log-leaf-1')).toBeNull();
      expect(screen.queryByTestId('breakdown-count-badge-log-leaf-1')).toBeNull();
    });

    it('displays adaptive percentage formatting (<1% for tiny contributions) for child items', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="protein"
        />
      );

      // Expand composite meal
      fireEvent.click(screen.getByTestId('breakdown-accordion-trigger-log-composite-1'));

      // In Egg Frittata Plate (sorted descending by protein):
      // Total protein is 25.5g
      // Cucumber & Tomato Pickles: 12.9g -> (12.9 / 25.5) * 100 = 51%
      // Egg Frittata: 12.5g -> (12.5 / 25.5) * 100 = 49%
      // Cooking Oil: 0.1g -> (0.1 / 25.5) * 100 = 0.39% -> strictly < 1% -> '<1%'
      const childPctBadges = screen.getAllByTestId('breakdown-child-pct');
      expect(childPctBadges[0].textContent).toBe('51%');
      expect(childPctBadges[1].textContent).toBe('49%');
      expect(childPctBadges[2].textContent).toBe('<1%');
    });

    it('displays 0% for child items that contribute zero of the selected nutrient', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="fiber"
        />
      );

      // Expand composite meal
      fireEvent.click(screen.getByTestId('breakdown-accordion-trigger-log-composite-1'));

      // Total fiber is 3.1g (sorted descending by fiber):
      // Cucumber & Tomato Pickles: 1.9g -> 61%
      // Egg Frittata: 1.2g -> 39%
      // Cooking Oil: 0 fiber -> 0% (sorted to index 2)
      const childPctBadges = screen.getAllByTestId('breakdown-child-pct');
      expect(childPctBadges[2].textContent).toBe('0%');
    });
  });

  describe('Number formatting and WCAG touch target compliance', () => {
    it('formats calories with kcal unit and macros with g unit', () => {
      const { rerender } = render(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="calories"
        />
      );

      // Total calories
      expect(screen.getByText('677 kcal')).toBeDefined();

      // Switch to carbs
      rerender(
        <NutrientBreakdownModal
          {...defaultProps}
          selectedNutrient="carbs"
        />
      );

      expect(screen.getByText('59.2g')).toBeDefined();
    });

    it('ensures all clickable elements satisfy WCAG 2.5.5 min-h-[44px]', () => {
      render(<NutrientBreakdownModal {...defaultProps} />);

      const closeBtn = screen.getByTestId('close-breakdown-modal-btn');
      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('min-w-[44px]');

      const pillBtn = screen.getByTestId('nutrient-pill-calories');
      expect(pillBtn.className).toContain('min-h-[44px]');

      const accordionTrigger = screen.getByTestId('breakdown-accordion-trigger-log-composite-1');
      expect(accordionTrigger.className).toContain('min-h-[44px]');
    });

    it('cleans floating point drift using roundTo1Decimal when dailyTotals or items contain precision drift', () => {
      const noisyMeal: NutritionLog = {
        id: 'log-noisy',
        user_id: 'user-1',
        food_name: 'Noisy Meal',
        calories: 100,
        protein: 0.1 + 0.2, // 0.30000000000000004
        carbs: 10.000000000000002,
        fat: 5.05,
        fiber: 2.04,
        logged_at: '2026-09-14T12:00:00.000Z',
        items: [
          {
            id: 'item-noisy-1',
            name: 'Noisy Ingredient',
            quantity: 1,
            unit: 'unit',
            calories: 100,
            protein: 0.30000000000000004,
            carbs: 10.000000000000002,
            fat: 5.05,
            fiber: 2.0,
          },
          {
            id: 'item-noisy-2',
            name: 'Zero Ingredient',
            quantity: 1,
            unit: 'unit',
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            fiber: 0.04, // should round to 0g and 0%
          },
        ],
      };

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[noisyMeal]}
          dailyTotals={{
            calories: 100,
            protein: 0.30000000000000004,
            carbs: 10.000000000000002,
            fat: 5.05,
            fiber: 2.04,
          }}
          selectedNutrient="fiber"
        />
      );

      // Fiber total: 2.04g rounds to 2g, formatted as 2g
      expect(screen.getByText("Today's Fiber")).toBeDefined();
      expect(screen.getAllByText('2g').length).toBeGreaterThanOrEqual(2);

      // Expand accordion
      fireEvent.click(screen.getByTestId('breakdown-accordion-trigger-log-noisy'));
      const childPctBadges = screen.getAllByTestId('breakdown-child-pct');
      // Fiber 0.04g rounds to 0g, which contributes 0% (not <1%)
      expect(childPctBadges[1].textContent).toBe('0%');
    });
  });

  describe('Focus, accessibility, and dismiss behavior', () => {
    it('restores focus to the opener element when the modal is dismissed', () => {
      const opener = document.createElement('button');
      opener.setAttribute('data-testid', 'test-opener-ring');
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      const { rerender } = render(
        <NutrientBreakdownModal {...defaultProps} isOpen={true} />
      );

      // Focus moved into the modal
      expect(document.activeElement).not.toBe(opener);

      // Close modal
      rerender(<NutrientBreakdownModal {...defaultProps} isOpen={false} />);

      // Focus is restored to the opener ring
      expect(document.activeElement).toBe(opener);
      document.body.removeChild(opener);
    });

    it('dismisses modal when Escape key is pressed', () => {
      const onClose = vi.fn();
      render(<NutrientBreakdownModal {...defaultProps} isOpen={true} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('connects role=tabpanel and aria-controls between tabs and content panel', () => {
      render(<NutrientBreakdownModal {...defaultProps} />);

      const tab = screen.getByTestId('nutrient-pill-calories');
      expect(tab.getAttribute('aria-controls')).toBe('nutrient-breakdown-tabpanel');

      const panel = screen.getByRole('tabpanel');
      expect(panel.id).toBe('nutrient-breakdown-tabpanel');
      expect(panel.getAttribute('aria-label')).toBe('Protein breakdown');
    });

    it('handles long portion descriptions and fallbacks for missing names without crashing', () => {
      const fallbackMeal: NutritionLog = {
        id: 'log-fallback',
        user_id: 'user-1',
        food_name: '',
        calories: 120,
        protein: 10,
        carbs: 5,
        fat: 2,
        fiber: 1,
        serving_size: 1,
        serving_unit: 'extraordinarily long serving unit description that could blow out small screens',
        logged_at: '2026-09-14T12:00:00.000Z',
        items: [
          {
            id: 'child-fb-1',
            name: '',
            quantity: 1,
            unit: 'unit',
            displayPortion: 'very long portion specification string that needs truncation at 320px',
            calories: 60,
            protein: 5,
            carbs: 2,
            fat: 1,
            fiber: 0.5,
          },
          {
            id: 'child-fb-2',
            name: 'Child 2',
            quantity: 1,
            unit: 'unit',
            calories: 60,
            protein: 5,
            carbs: 3,
            fat: 1,
            fiber: 0.5,
          },
        ],
      };

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[fallbackMeal]}
          selectedNutrient="protein"
        />
      );

      // Fallback name is rendered
      expect(screen.getByText('Unnamed Meal')).toBeDefined();

      // Expand accordion
      fireEvent.click(screen.getByTestId('breakdown-accordion-trigger-log-fallback'));

      // Child fallback name is rendered
      expect(screen.getByText('Item')).toBeDefined();

      // Portion badge is truncated with max-w constraint
      const portionBadge = screen.getByTestId('breakdown-child-portion');
      expect(portionBadge.className).toContain('truncate');
      expect(portionBadge.className).toContain('max-w-[90px]');
    });
  });

  describe('Filtering 0g meals and descending sort order', () => {
    const mealHighProtein: NutritionLog = {
      id: 'log-high-p',
      user_id: 'user-1',
      food_name: 'Grilled Chicken Breast',
      calories: 250,
      protein: 45.0,
      carbs: 0.0,
      fat: 5.0,
      fiber: 0.0,
      logged_at: '2026-09-14T12:00:00.000Z',
      items: null,
    };

    const mealMediumProtein: NutritionLog = {
      id: 'log-med-p',
      user_id: 'user-1',
      food_name: 'Salmon Fillet',
      calories: 280,
      protein: 28.0,
      carbs: 0.0,
      fat: 15.0,
      fiber: 0.0,
      logged_at: '2026-09-14T13:00:00.000Z',
      items: null,
    };

    const mealLowProtein: NutritionLog = {
      id: 'log-low-p',
      user_id: 'user-1',
      food_name: 'Avocado Toast',
      calories: 220,
      protein: 5.0,
      carbs: 22.0,
      fat: 12.0,
      fiber: 7.0,
      logged_at: '2026-09-14T09:00:00.000Z',
      items: null,
    };

    const mealZeroProtein: NutritionLog = {
      id: 'log-zero-p',
      user_id: 'user-1',
      food_name: 'Olive Oil Dressing',
      calories: 120,
      protein: 0.0,
      carbs: 0.0,
      fat: 14.0,
      fiber: 0.0,
      logged_at: '2026-09-14T12:30:00.000Z',
      items: null,
    };

    const mealNearZeroProtein: NutritionLog = {
      id: 'log-near-zero-p',
      user_id: 'user-1',
      food_name: 'Diet Soda with Trace Aminos',
      calories: 0,
      protein: 0.03, // < 0.05, rounds to 0g
      carbs: 0.0,
      fat: 0.0,
      fiber: 0.0,
      logged_at: '2026-09-14T14:00:00.000Z',
      items: null,
    };

    it('filters out meals with 0g or near-zero (<0.05g) of the selected nutrient', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[
            mealZeroProtein,
            mealHighProtein,
            mealNearZeroProtein,
            mealLowProtein,
          ]}
          selectedNutrient="protein"
        />
      );

      // Contributing meals should be rendered
      expect(screen.getByTestId('breakdown-meal-name-log-high-p')).toBeDefined();
      expect(screen.getByTestId('breakdown-meal-name-log-low-p')).toBeDefined();

      // Non-contributing meals should NOT be rendered
      expect(screen.queryByTestId('breakdown-meal-name-log-zero-p')).toBeNull();
      expect(screen.queryByTestId('breakdown-meal-name-log-near-zero-p')).toBeNull();
    });

    it('filters out meals with 0 kcal or near-zero (<0.5 kcal) of calories', () => {
      const mealZeroCal: NutritionLog = {
        id: 'log-water',
        user_id: 'user-1',
        food_name: 'Spring Water',
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        logged_at: '2026-09-14T07:00:00.000Z',
        items: null,
      };

      const mealTraceCal: NutritionLog = {
        id: 'log-trace-cal',
        user_id: 'user-1',
        food_name: 'Black Coffee with Sweetener',
        calories: 0.4, // < 0.5 kcal, rounds to 0 kcal
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        logged_at: '2026-09-14T07:30:00.000Z',
        items: null,
      };

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[mealZeroCal, mealHighProtein, mealTraceCal]}
          selectedNutrient="calories"
        />
      );

      expect(screen.getByTestId('breakdown-meal-name-log-high-p')).toBeDefined();
      expect(screen.queryByTestId('breakdown-meal-name-log-water')).toBeNull();
      expect(screen.queryByTestId('breakdown-meal-name-log-trace-cal')).toBeNull();
    });

    it('sorts meals in descending order (most to least) by contribution to the selected nutrient', () => {
      // Pass meals in unsorted order: Low (5g), High (45g), Medium (28g)
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[mealLowProtein, mealHighProtein, mealMediumProtein]}
          selectedNutrient="protein"
        />
      );

      const mealNames = screen.getAllByTestId(/^breakdown-meal-name-/);
      expect(mealNames.length).toBe(3);
      expect(mealNames[0].textContent).toBe('Grilled Chicken Breast'); // 45g
      expect(mealNames[1].textContent).toBe('Salmon Fillet'); // 28g
      expect(mealNames[2].textContent).toBe('Avocado Toast'); // 5g
    });

    it('sorts child items within composite meals in descending order by that nutrient', () => {
      const compositeDish: NutritionLog = {
        id: 'log-bowl',
        user_id: 'user-1',
        food_name: 'Power Bowl',
        calories: 600,
        protein: 40,
        carbs: 60,
        fat: 20,
        fiber: 10,
        logged_at: '2026-09-14T18:00:00.000Z',
        items: [
          {
            id: 'item-rice',
            name: 'Brown Rice',
            quantity: 150,
            unit: 'g',
            calories: 180,
            protein: 4.0,
            carbs: 38.0,
            fat: 1.5,
            fiber: 2.0,
          },
          {
            id: 'item-chicken',
            name: 'Chicken Breast',
            quantity: 120,
            unit: 'g',
            calories: 200,
            protein: 32.0,
            carbs: 0.0,
            fat: 4.0,
            fiber: 0.0,
          },
          {
            id: 'item-broccoli',
            name: 'Steamed Broccoli',
            quantity: 100,
            unit: 'g',
            calories: 45,
            protein: 3.5,
            carbs: 8.0,
            fat: 0.5,
            fiber: 3.0,
          },
        ],
      };

      const { rerender } = render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[compositeDish]}
          selectedNutrient="protein"
        />
      );

      // Expand accordion
      fireEvent.click(screen.getByTestId('breakdown-accordion-trigger-log-bowl'));

      // In protein order: Chicken (32g) > Rice (4.0g) > Broccoli (3.5g)
      let childNames = screen.getAllByTestId('breakdown-child-name');
      expect(childNames[0].textContent).toBe('Chicken Breast');
      expect(childNames[1].textContent).toBe('Brown Rice');
      expect(childNames[2].textContent).toBe('Steamed Broccoli');

      // Now switch to carbs: Rice (38g) > Broccoli (8g) > Chicken (0g)
      rerender(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[compositeDish]}
          selectedNutrient="carbs"
        />
      );

      childNames = screen.getAllByTestId('breakdown-child-name');
      expect(childNames[0].textContent).toBe('Brown Rice');
      expect(childNames[1].textContent).toBe('Steamed Broccoli');
      expect(childNames[2].textContent).toBe('Chicken Breast');
    });

    it('displays empty state with specific message when all logged meals have 0g of the selected nutrient', () => {
      // Olive Oil has 0 protein and 0 carbs
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[mealZeroProtein]}
          selectedNutrient="protein"
        />
      );

      expect(screen.getByTestId('breakdown-empty-state')).toBeDefined();
      expect(screen.getByText('No meals with protein logged for this date.')).toBeDefined();
      expect(screen.queryByTestId('breakdown-meal-name-log-zero-p')).toBeNull();
    });

    it('displays empty state with general message when logs array is empty', () => {
      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[]}
          selectedNutrient="calories"
        />
      );

      expect(screen.getByTestId('breakdown-empty-state')).toBeDefined();
      expect(screen.getByText('No meals logged for this date.')).toBeDefined();
    });

    it('handles legacy/malformed items JSON strings gracefully by falling back to scalar nutrients and maintaining sort', () => {
      const mealWithBrokenJson: NutritionLog = {
        id: 'log-broken-json',
        user_id: 'user-1',
        food_name: 'Broken JSON Dish',
        calories: 300,
        protein: 30,
        carbs: 20,
        fat: 10,
        fiber: 5,
        logged_at: '2026-09-14T12:00:00.000Z',
        items: 'not a valid json string' as unknown as any,
      };

      const mealNormal: NutritionLog = {
        id: 'log-normal',
        user_id: 'user-1',
        food_name: 'Normal Dish',
        calories: 150,
        protein: 15,
        carbs: 10,
        fat: 5,
        fiber: 2,
        logged_at: '2026-09-14T12:00:00.000Z',
        items: null,
      };

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[mealNormal, mealWithBrokenJson]}
          selectedNutrient="protein"
        />
      );

      // Broken JSON meal should fall back to scalar protein (30g) and sort first
      const mealNames = screen.getAllByTestId(/^breakdown-meal-name-/);
      expect(mealNames.length).toBe(2);
      expect(mealNames[0].textContent).toBe('Broken JSON Dish');
      expect(mealNames[1].textContent).toBe('Normal Dish');

      // Should render as a flat leaf row (not crashing or rendering accordion)
      expect(screen.getByTestId('breakdown-leaf-row-log-broken-json')).toBeDefined();
    });

    it('safely handles non-finite (NaN, Infinity) or negative nutrients without crashing or breaking sort order', () => {
      const noisyMeals: NutritionLog[] = [
        {
          id: 'log-neg',
          user_id: 'user-1',
          food_name: 'Negative Protein Meal',
          calories: 100,
          protein: -10,
          carbs: 0,
          fat: 0,
          fiber: 0,
          logged_at: '2026-09-14T12:00:00.000Z',
          items: null,
        },
        {
          id: 'log-valid-high',
          user_id: 'user-1',
          food_name: 'Valid High Protein',
          calories: 300,
          protein: 40,
          carbs: 0,
          fat: 0,
          fiber: 0,
          logged_at: '2026-09-14T12:00:00.000Z',
          items: null,
        },
        {
          id: 'log-valid-low',
          user_id: 'user-1',
          food_name: 'Valid Low Protein',
          calories: 150,
          protein: 10,
          carbs: 0,
          fat: 0,
          fiber: 0,
          logged_at: '2026-09-14T12:00:00.000Z',
          items: null,
        },
        {
          id: 'log-nan',
          user_id: 'user-1',
          food_name: 'NaN Protein Meal',
          calories: 100,
          protein: NaN,
          carbs: 0,
          fat: 0,
          fiber: 0,
          logged_at: '2026-09-14T12:00:00.000Z',
          items: null,
        },
      ];

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={noisyMeals}
          selectedNutrient="protein"
        />
      );

      // Negative and NaN protein meals must be filtered out
      expect(screen.queryByTestId('breakdown-meal-name-log-neg')).toBeNull();
      expect(screen.queryByTestId('breakdown-meal-name-log-nan')).toBeNull();

      // Valid meals should be sorted descending
      const mealNames = screen.getAllByTestId(/^breakdown-meal-name-/);
      expect(mealNames.length).toBe(2);
      expect(mealNames[0].textContent).toBe('Valid High Protein');
      expect(mealNames[1].textContent).toBe('Valid Low Protein');
    });

    it('computes daily totals directly from logs when dailyTotals prop is omitted', () => {
      render(
        <NutrientBreakdownModal
          isOpen={true}
          onClose={vi.fn()}
          selectedNutrient="carbs"
          onSelectNutrient={vi.fn()}
          logs={[mealLowProtein]} // Avocado Toast: 22g carbs
          dailyTotals={undefined}
        />
      );

      // Summary header displays computed carbs from logs (and meal row also displays 22g)
      expect(screen.getByText("Today's Carbs")).toBeDefined();
      expect(screen.getAllByText('22g').length).toBe(2);
    });

    it('handles child items with missing/undefined calorie values without producing NaN in DOM', () => {
      const compositeWithMissingNutrient: NutritionLog = {
        id: 'log-missing-child-nutrient',
        user_id: 'user-1',
        food_name: 'Mixed Snack Plate',
        calories: 200,
        protein: 10,
        carbs: 20,
        fat: 10,
        fiber: 2,
        logged_at: '2026-09-14T12:00:00.000Z',
        items: [
          {
            id: 'item-defined',
            name: 'Defined Item',
            quantity: 1,
            unit: 'unit',
            calories: 150,
            protein: 8,
            carbs: 15,
            fat: 8,
            fiber: 1,
          },
          {
            id: 'item-undefined-cal',
            name: 'Undefined Cal Item',
            quantity: 1,
            unit: 'unit',
            calories: undefined as unknown as number,
            protein: 2,
            carbs: 5,
            fat: 2,
            fiber: 1,
          },
        ],
      };

      render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[compositeWithMissingNutrient]}
          selectedNutrient="calories"
        />
      );

      // Expand accordion
      fireEvent.click(
        screen.getByTestId('breakdown-accordion-trigger-log-missing-child-nutrient')
      );

      // Child row should format 0 kcal without displaying NaN
      expect(screen.queryByText(/NaN/)).toBeNull();
      expect(screen.getByText('0 kcal')).toBeDefined();
    });

    it('dynamically toggles between 0g empty state and descending list when switching nutrients', () => {
      // Whey Protein: 30g P, 0g fiber
      // Beef Broth: 20g P, 0g fiber
      const wheyProtein: NutritionLog = {
        id: 'log-whey',
        user_id: 'user-1',
        food_name: 'Whey Protein Powder',
        calories: 120,
        protein: 30,
        carbs: 1,
        fat: 1,
        fiber: 0,
        logged_at: '2026-09-14T08:00:00.000Z',
        items: null,
      };

      const beefBroth: NutritionLog = {
        id: 'log-broth',
        user_id: 'user-1',
        food_name: 'Hearty Beef Stew with Vegetables',
        calories: 100,
        protein: 20,
        carbs: 0,
        fat: 1,
        fiber: 0,
        logged_at: '2026-09-14T12:00:00.000Z',
        items: null,
      };

      const { rerender } = render(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[beefBroth, wheyProtein]}
          selectedNutrient="fiber"
        />
      );

      // On fiber: both meals contribute 0g fiber, so empty state is displayed
      expect(screen.getByTestId('breakdown-empty-state')).toBeDefined();
      expect(screen.getByText('No meals with fiber logged for this date.')).toBeDefined();
      expect(screen.queryByTestId('breakdown-meal-name-log-whey')).toBeNull();
      expect(screen.queryByTestId('breakdown-meal-name-log-broth')).toBeNull();

      // Switch to protein: both contribute and should sort descending (Whey 30g > Broth 20g)
      rerender(
        <NutrientBreakdownModal
          {...defaultProps}
          logs={[beefBroth, wheyProtein]}
          selectedNutrient="protein"
        />
      );

      expect(screen.queryByTestId('breakdown-empty-state')).toBeNull();
      const mealNames = screen.getAllByTestId(/^breakdown-meal-name-/);
      expect(mealNames.length).toBe(2);
      expect(mealNames[0].textContent).toBe('Whey Protein Powder');
      expect(mealNames[1].textContent).toBe('Hearty Beef Stew with Vegetables');
    });
  });
});

