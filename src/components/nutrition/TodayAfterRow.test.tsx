import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayTotalRow } from './TodayAfterRow';
import type { MacroColumnKey } from './macroColumns';

describe('DayTotalRow', () => {
  const columns: MacroColumnKey[] = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
  const mealTotals = {
    calories: 500,
    protein: 40,
    carbs: 50,
    fat: 15,
    fiber: 5,
  };

  it('renders Day total label and values equal to consumed + meal totals in column grid', () => {
    const dailyTotals = {
      calories: 1000,
      protein: 60,
      carbs: 100,
      fat: 35,
      fiber: 10,
    };
    const targets = {
      calories: 2000,
      protein: 140,
      carbs: 250,
      fat: 70,
      fiber: 30,
    };

    render(
      <DayTotalRow
        macroColumns={columns}
        mealTotals={mealTotals}
        dailyTotals={dailyTotals}
        targets={targets}
      />
    );

    expect(screen.getByTestId('day-total-label')).toHaveTextContent('Day total');

    // Calories: 1000 consumed + 500 meal = 1500
    expect(screen.getByTestId('day-total-val-calories')).toHaveTextContent('1500');
    // Protein: 60 + 40 = 100
    expect(screen.getByTestId('day-total-val-protein')).toHaveTextContent('100');
    // Carbs: 100 + 50 = 150
    expect(screen.getByTestId('day-total-val-carbs')).toHaveTextContent('150');
    // Fat: 35 + 15 = 50
    expect(screen.getByTestId('day-total-val-fat')).toHaveTextContent('50');
    // Fiber: 10 + 5 = 15
    expect(screen.getByTestId('day-total-val-fiber')).toHaveTextContent('15');
  });

  it('uses standard macro colors when below or at target', () => {
    const dailyTotals = {
      calories: 1000,
      protein: 60,
      carbs: 100,
      fat: 35,
      fiber: 10,
    };
    const targets = {
      calories: 2000,
      protein: 140,
      carbs: 250,
      fat: 70,
      fiber: 30,
    };

    render(
      <DayTotalRow
        macroColumns={columns}
        mealTotals={mealTotals}
        dailyTotals={dailyTotals}
        targets={targets}
      />
    );

    // Kcal uses amber-400
    expect(screen.getByTestId('day-total-calories')).toHaveClass('text-amber-400');
    // Protein uses cyan-400 (even at 95%+, no amber warning)
    expect(screen.getByTestId('day-total-protein')).toHaveClass('text-cyan-400');
    // Carbs uses emerald-400
    expect(screen.getByTestId('day-total-carbs')).toHaveClass('text-emerald-400');
    // Fat uses violet-400
    expect(screen.getByTestId('day-total-fat')).toHaveClass('text-violet-400');
    // Fiber uses teal-400
    expect(screen.getByTestId('day-total-fiber')).toHaveClass('text-teal-400');

    // No accessible over-target text on any cell
    expect(screen.queryByTestId('day-total-over-calories')).toBeNull();
    expect(screen.queryByTestId('day-total-over-protein')).toBeNull();
  });

  it('turns red (text-rose-400) and adds accessible over-target description ONLY when over target', () => {
    render(
      <DayTotalRow
        macroColumns={['calories', 'protein']}
        mealTotals={{ calories: 600, protein: 40, carbs: 0, fat: 0, fiber: 0 }}
        dailyTotals={{ calories: 1500, protein: 50 }}
        targets={{ calories: 2000, protein: 120 }} // Calories: 2100 > 2000 (+100); Protein: 90 <= 120
      />
    );

    // Calories is over target
    const calCell = screen.getByTestId('day-total-calories');
    expect(calCell).toHaveClass('text-rose-400');
    expect(calCell).not.toHaveClass('text-amber-400');
    const calOver = screen.getByTestId('day-total-over-calories');
    expect(calOver).toHaveTextContent('over target by 100 kcal');
    // F3: Ensure aria-label is NOT set on the day-total container so it does not override child text
    expect(calCell).not.toHaveAttribute('aria-label');
    expect(calCell).toHaveTextContent(/2100\s*kcal/);
    expect(calCell).toHaveTextContent('over target by 100 kcal');

    // Protein is not over target (uses cyan-400)
    const pCell = screen.getByTestId('day-total-protein');
    expect(pCell).toHaveClass('text-cyan-400');
    expect(pCell).not.toHaveClass('text-rose-400');
    expect(screen.queryByTestId('day-total-over-protein')).toBeNull();
  });

  it('renders muted 0 C when consumed and meal are 0', () => {
    render(
      <DayTotalRow
        macroColumns={['calories', 'carbs']}
        mealTotals={{ calories: 100, protein: 0, carbs: 0, fat: 0, fiber: 0 }}
        dailyTotals={{ calories: 0, carbs: 0 }}
        targets={{ calories: 2000, carbs: 200 }}
      />
    );

    const carbsCell = screen.getByTestId('day-total-carbs');
    expect(carbsCell).toHaveClass('text-zinc-600');
    expect(screen.getByTestId('day-total-val-carbs')).toHaveTextContent('0');
  });

  it('applies D24 minmax responsive grid template and whitespace-nowrap', () => {
    render(
      <DayTotalRow
        macroColumns={columns}
        mealTotals={mealTotals}
      />
    );

    const grid = screen.getByTestId('day-total-grid');
    expect(grid.style.gridTemplateColumns).toBe(
      'minmax(3rem, 4.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem) minmax(2.5rem, 3.5rem)'
    );

    const calCell = screen.getByTestId('day-total-calories');
    expect(calCell).toHaveClass('whitespace-nowrap');
  });
});
