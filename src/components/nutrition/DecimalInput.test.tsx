import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { DecimalInput } from './DecimalInput';

describe('DecimalInput', () => {
  it('renders type="text" and inputMode="decimal" with step and min', () => {
    render(<DecimalInput value={10} onChange={() => {}} data-testid="dec-input" />);
    const input = screen.getByTestId('dec-input');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('step')).toBe('any');
    expect((input as HTMLInputElement).value).toBe('10');
  });

  it('preserves draft while typing "1","2",",","5" sequentially and commits 12.5', () => {
    function ControlledTest() {
      const [val, setVal] = useState<number | ''>('');
      return (
        <div>
          <DecimalInput value={val} onChange={setVal} data-testid="dec-input" />
          <span data-testid="committed-val">{String(val)}</span>
        </div>
      );
    }

    render(<ControlledTest />);
    const input = screen.getByTestId('dec-input') as HTMLInputElement;
    const committed = screen.getByTestId('committed-val');

    // Type '1'
    fireEvent.change(input, { target: { value: '1' } });
    expect(input.value).toBe('1');
    expect(committed.textContent).toBe('1');

    // Type '2' -> '12'
    fireEvent.change(input, { target: { value: '12' } });
    expect(input.value).toBe('12');
    expect(committed.textContent).toBe('12');

    // Type ',' -> '12,' (stays '12,' in DOM, does not get clobbered to '12')
    fireEvent.change(input, { target: { value: '12,' } });
    expect(input.value).toBe('12,');
    expect(committed.textContent).toBe('12');

    // Type '5' -> '12,5'
    fireEvent.change(input, { target: { value: '12,5' } });
    expect(input.value).toBe('12,5');
    expect(committed.textContent).toBe('12.5');

    // Blur commits and normalizes display
    fireEvent.blur(input);
    expect(input.value).toBe('12.5');
    expect(committed.textContent).toBe('12.5');
  });

  it('rejects ambiguous separators "1,2,3" by propagating NaN and reverts on blur', () => {
    const onChange = vi.fn();
    render(<DecimalInput value={10} onChange={onChange} data-testid="dec-input" />);
    const input = screen.getByTestId('dec-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '1,2,3' } });
    expect(onChange).toHaveBeenCalledWith(NaN);
    expect(input.value).toBe('1,2,3');

    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe('10');
  });

  it('preserves empty string when input is cleared', () => {
    function ClearTest() {
      const [val, setVal] = useState<number | ''>(10);
      return <DecimalInput value={val} onChange={setVal} data-testid="dec-input" />;
    }
    render(<ClearTest />);
    const input = screen.getByTestId('dec-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    fireEvent.blur(input);
    expect(input.value).toBe('');
  });

  it('handles negative inputs when allowNegative is true', () => {
    const onChange = vi.fn();
    render(<DecimalInput value={10} onChange={onChange} allowNegative data-testid="dec-input" />);
    const input = screen.getByTestId('dec-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledWith(-5);
  });
});
