import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MacroCell } from './MacroCell';

describe('MacroCell', () => {
  it('flags over target when deliberate 0g target is exceeded (value 15, target 0)', () => {
    render(
      <MacroCell
        colKey="carbs"
        value={15}
        target={0}
        variant="day-total"
      />
    );

    const cell = screen.getByTestId('day-total-carbs');
    expect(cell).toHaveClass('text-rose-400');
    expect(cell).not.toHaveClass('text-emerald-400');
    const over = screen.getByTestId('day-total-over-carbs');
    expect(over).toHaveTextContent('over target by 15 C');
  });

  it('does not flag over target when target is undefined', () => {
    render(
      <MacroCell
        colKey="carbs"
        value={15}
        target={undefined}
        variant="day-total"
      />
    );

    const cell = screen.getByTestId('day-total-carbs');
    expect(cell).toHaveClass('text-emerald-400');
    expect(cell).not.toHaveClass('text-rose-400');
    expect(screen.queryByTestId('day-total-over-carbs')).toBeNull();
  });

  it('does not flag over target when target is null', () => {
    render(
      <MacroCell
        colKey="carbs"
        value={15}
        target={null as unknown as number}
        variant="day-total"
      />
    );

    const cell = screen.getByTestId('day-total-carbs');
    expect(cell).toHaveClass('text-emerald-400');
    expect(cell).not.toHaveClass('text-rose-400');
    expect(screen.queryByTestId('day-total-over-carbs')).toBeNull();
  });

  it('does not flag over target when value is 0 and target is 0', () => {
    render(
      <MacroCell
        colKey="carbs"
        value={0}
        target={0}
        variant="day-total"
      />
    );

    const cell = screen.getByTestId('day-total-carbs');
    expect(cell).toHaveClass('text-zinc-600');
    expect(cell).not.toHaveClass('text-rose-400');
    expect(screen.queryByTestId('day-total-over-carbs')).toBeNull();
  });

  it('flags over target for positive target when exceeded', () => {
    render(
      <MacroCell
        colKey="carbs"
        value={50}
        target={30}
        variant="day-total"
      />
    );

    const cell = screen.getByTestId('day-total-carbs');
    expect(cell).toHaveClass('text-rose-400');
    expect(cell).not.toHaveClass('text-emerald-400');
    const over = screen.getByTestId('day-total-over-carbs');
    expect(over).toHaveTextContent('over target by 20 C');
  });
});
