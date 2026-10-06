import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { useState } from 'react';
import { MealScaleControl } from './MealScaleControl';
import { expectNoA11yViolations } from '../../test/a11y';

function Harness({ initial = 1, onScale = vi.fn() }: { initial?: number; onScale?: (f: number) => void }) {
  const [scale, setScale] = useState(initial);
  return (
    <MealScaleControl
      scale={scale}
      onScale={(f) => {
        onScale(f);
        setScale(f);
      }}
    />
  );
}

describe('MealScaleControl', () => {
  it('reads "Scale" at x1 and opens a focused, pre-selected numeric box on tap', () => {
    render(<Harness />);
    const btn = screen.getByTestId('meal-scale-button');
    expect(btn).toHaveTextContent('Scale');
    expect(btn).toHaveAccessibleName('Scale whole meal');

    fireEvent.click(btn);
    const input = screen.getByTestId('meal-scale-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('1');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('enterkeyhint', 'done');
    expect(input).toHaveAccessibleName('Scale whole meal by');
    expect(screen.queryByTestId('meal-scale-button')).toBeNull();
  });

  it('applies on Enter, shows the active factor and returns focus to the chip', () => {
    const onScale = vi.fn();
    render(<Harness onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '0.2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onScale).toHaveBeenCalledTimes(1);
    expect(onScale).toHaveBeenCalledWith(0.2);
    const btn = screen.getByTestId('meal-scale-button');
    expect(btn).toHaveTextContent('×0.2');
    expect(btn).toHaveAccessibleName('Scale whole meal, currently times 0.2');
    expect(document.activeElement).toBe(btn);
  });

  it('applies on blur', () => {
    const onScale = vi.fn();
    render(<Harness onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(onScale).toHaveBeenCalledWith(2);
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('×2');
  });

  it('Escape cancels without applying and returns focus to the chip', () => {
    const onScale = vi.fn();
    render(<Harness onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onScale).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('meal-scale-button'));
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('Scale');
  });

  it.each(['', '0', 'abc', '50'])('invalid input %j reverts without applying', (value) => {
    const onScale = vi.fn();
    render(<Harness initial={0.5} onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScale).not.toHaveBeenCalled();
    expect(screen.getByTestId('meal-scale-button')).toHaveTextContent('×0.5');
  });

  it('re-entering the current factor does not call onScale', () => {
    const onScale = vi.fn();
    render(<Harness initial={0.5} onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input') as HTMLInputElement;
    expect(input.value).toBe('0.5');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScale).not.toHaveBeenCalled();
  });

  it('applies once when Enter is followed by a blur', () => {
    const onScale = vi.fn();
    render(<MealScaleControl scale={1} onScale={onScale} />);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    const input = screen.getByTestId('meal-scale-input');
    fireEvent.change(input, { target: { value: '0.25' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onScale).toHaveBeenCalledTimes(1);
  });

  it('has no accessibility violations idle and editing', async () => {
    const { container } = render(<Harness initial={0.2} />);
    await expectNoA11yViolations(container);
    fireEvent.click(screen.getByTestId('meal-scale-button'));
    await expectNoA11yViolations(container);
  });
});

void React;
