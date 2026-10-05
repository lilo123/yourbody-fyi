import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NutritionDashboardRings, type NutritionDashboardRingsProps } from './NutritionDashboardRings';

function renderDashboard(propsOverride: Partial<NutritionDashboardRingsProps> = {}) {
  const defaultProps: NutritionDashboardRingsProps = {
    selectedDate: '2026-09-22',
    onDateChange: vi.fn(),
    dailyTotals: {
      calories: 1800,
      protein: 130,
      carbs: 180,
      fat: 60,
      fiber: 25,
    },
    targets: {
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 70,
      fiber: 30,
    },
    remainingFuel: {
      calories: { badgeLabel: '200 kcal', isOver: false },
      protein: { badgeLabel: '20g P', isOver: false },
      carbs: { badgeLabel: '20g C', isOver: false },
      fat: { badgeLabel: '10g F', isOver: false },
      fiber: { badgeLabel: '5g Fib', isOver: false },
    },
    onSelectBreakdownNutrient: vi.fn(),
  };

  const mergedProps = { ...defaultProps, ...propsOverride };
  const view = render(<NutritionDashboardRings {...mergedProps} />);
  return { ...view, props: mergedProps };
}

describe('NutritionDashboardRings', () => {
  it('renders exactly 5 actionable buttons in the dashboard (one per macro ring) and no separate fuel strip', () => {
    renderDashboard();

    const buttons = screen.getAllByRole('button');
    // Exactly 5 buttons for the 5 macro rings
    expect(buttons).toHaveLength(5);

    const testIds = buttons.map((b) => b.getAttribute('data-testid'));
    expect(testIds).toEqual([
      'macro-ring-calories',
      'macro-ring-protein',
      'macro-ring-carbs',
      'macro-ring-fat',
      'macro-ring-fiber',
    ]);

    // Verify separate remaining-fuel-container strip is completely removed
    expect(screen.queryByTestId('remaining-fuel-container')).toBeNull();

    // Verify each ring contains its remaining status div without button role
    const nutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;
    nutrients.forEach((nutrient) => {
      const statusEl = screen.getByTestId(`remaining-fuel-${nutrient}`);
      expect(statusEl.tagName.toLowerCase()).toBe('div');
      expect(statusEl.getAttribute('role')).toBeNull();
    });
  });

  it('calls onSelectBreakdownNutrient when macro rings are clicked', () => {
    const onSelect = vi.fn();
    renderDashboard({ onSelectBreakdownNutrient: onSelect });

    const nutrients = [
      { id: 'calories', testId: 'macro-ring-calories' },
      { id: 'protein', testId: 'macro-ring-protein' },
      { id: 'carbs', testId: 'macro-ring-carbs' },
      { id: 'fat', testId: 'macro-ring-fat' },
      { id: 'fiber', testId: 'macro-ring-fiber' },
    ] as const;

    nutrients.forEach(({ id, testId }) => {
      onSelect.mockClear();
      fireEvent.click(screen.getByTestId(testId));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(id);
    });
  });

  it('does not trigger onSelectBreakdownNutrient when inner status elements stop propagation', () => {
    const onSelect = vi.fn();
    renderDashboard({ onSelectBreakdownNutrient: onSelect });

    const nutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;
    nutrients.forEach((nutrient) => {
      onSelect.mockClear();
      fireEvent.click(screen.getByTestId(`remaining-fuel-${nutrient}`));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  it('renders under-budget styling, numbers, and aria labels correctly for each ring status', () => {
    renderDashboard({
      remainingFuel: {
        calories: { badgeLabel: '200 kcal', isOver: false },
        protein: { badgeLabel: '20g P', isOver: false },
        carbs: { badgeLabel: '20g C', isOver: false },
        fat: { badgeLabel: '10g F', isOver: false },
        fiber: { badgeLabel: '5g Fib', isOver: false },
      },
    });

    const expectedTokens = {
      calories: {
        text: '200 left',
        colorClass: 'text-amber-400',
        ariaLabel: 'Calories: 200 kcal left',
      },
      protein: {
        text: '20 left',
        colorClass: 'text-cyan-400',
        ariaLabel: 'Protein: 20g P left',
      },
      carbs: {
        text: '20 left',
        colorClass: 'text-emerald-400',
        ariaLabel: 'Carbs: 20g C left',
      },
      fat: {
        text: '10 left',
        colorClass: 'text-violet-400',
        ariaLabel: 'Fat: 10g F left',
      },
      fiber: {
        text: '5 left',
        colorClass: 'text-teal-400',
        ariaLabel: 'Fiber: 5g Fib left',
      },
    };

    (Object.keys(expectedTokens) as (keyof typeof expectedTokens)[]).forEach((nutrient) => {
      const statusEl = screen.getByTestId(`remaining-fuel-${nutrient}`);
      expect(statusEl.textContent).toBe(expectedTokens[nutrient].text);
      expect(statusEl.className).toContain(expectedTokens[nutrient].colorClass);
      expect(statusEl.className).toContain('font-normal');
      expect(statusEl.className).toContain('opacity-70');
      expect(statusEl.getAttribute('aria-label')).toBe(expectedTokens[nutrient].ariaLabel);
      expect(statusEl.className).not.toContain('after:content-');
      // Assert visible text contains no unit (no 'kcal', no 'g ')
      expect(statusEl.textContent).not.toContain('kcal');
      expect(statusEl.textContent).not.toContain('g ');
    });
  });

  it('renders over-budget styling in red with over-target aria labels correctly for all ring statuses', () => {
    renderDashboard({
      remainingFuel: {
        calories: { badgeLabel: '+100 kcal over', isOver: true },
        protein: { badgeLabel: '+5g P over', isOver: true },
        carbs: { badgeLabel: '+15g C over', isOver: true },
        fat: { badgeLabel: '+8g F over', isOver: true },
        fiber: { badgeLabel: '+2g Fib over', isOver: true },
      },
    });

    const expectedOver = {
      calories: {
        text: '100 over',
        ariaLabel: 'Calories: 100 kcal over target',
      },
      protein: {
        text: '5 over',
        ariaLabel: 'Protein: 5g P over target',
      },
      carbs: {
        text: '15 over',
        ariaLabel: 'Carbs: 15g C over target',
      },
      fat: {
        text: '8 over',
        ariaLabel: 'Fat: 8g F over target',
      },
      fiber: {
        text: '2 over',
        ariaLabel: 'Fiber: 2g Fib over target',
      },
    };

    (Object.keys(expectedOver) as (keyof typeof expectedOver)[]).forEach((nutrient) => {
      const statusEl = screen.getByTestId(`remaining-fuel-${nutrient}`);
      expect(statusEl.textContent).toBe(expectedOver[nutrient].text);
      expect(statusEl.className).toContain('text-rose-400');
      expect(statusEl.className).toContain('font-normal');
      expect(statusEl.className).not.toContain('opacity-70');
      expect(statusEl.getAttribute('aria-label')).toBe(expectedOver[nutrient].ariaLabel);
      // When over, does not have 'after:content' left suffix
      expect(statusEl.className).not.toContain("after:content-['_left']");
      // Assert visible text contains no unit (no 'kcal', no 'g ')
      expect(statusEl.textContent).not.toContain('kcal');
      expect(statusEl.textContent).not.toContain('g ');
    });
  });

  it('ensures ring labels and status texts are at least 12px (text-xs)', () => {
    renderDashboard();

    const ringNutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const;
    ringNutrients.forEach((nutrient) => {
      const ringBtn = screen.getByTestId(`macro-ring-${nutrient}`);
      // Find all text divs inside ring
      const textEls = ringBtn.querySelectorAll('div, span');
      textEls.forEach((el) => {
        // Assert no text element uses sub-12px classes
        expect(el.className).not.toContain('text-[8px]');
        expect(el.className).not.toContain('text-[9px]');
        expect(el.className).not.toContain('text-[10px]');
        expect(el.className).not.toContain('text-[11px]');
      });
    });
  });
});
