import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Stepper } from './Stepper';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Stepper', () => {
  it('keeps local string draft while typing, clearing leaves field blank, and typing "5" yields 5 without snap-to-1', async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <Stepper
        value={1}
        onChange={handleChange}
        min={1}
        max={10}
        ariaLabel="sets"
        testId="sets-stepper"
      />
    );

    const input = screen.getByRole('textbox', { name: 'sets' });
    expect(input).toHaveValue('1');

    // Clear input: draft becomes blank, no snap-to-1!
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(handleChange).not.toHaveBeenCalled();

    // Type '5': draft becomes '5', still no commit yet
    fireEvent.change(input, { target: { value: '5' } });
    expect(input).toHaveValue('5');
    expect(handleChange).not.toHaveBeenCalled();

    // Blur input: commits and calls onChange with 5
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenCalledWith(5);

    await expectNoA11yViolations(container);
  });

  it('clamps value on blur when typed value exceeds max or min', () => {
    const handleChange = vi.fn();
    render(
      <Stepper
        value={3}
        onChange={handleChange}
        min={1}
        max={10}
        ariaLabel="reps"
      />
    );

    const input = screen.getByRole('textbox', { name: 'reps' });

    // Type 99 (exceeds max 10)
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenCalledWith(10);
    expect(input).toHaveValue('10');

    // Type 0 (below min 1)
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenCalledWith(1);
    expect(input).toHaveValue('1');
  });

  it('commits on Enter key press', () => {
    const handleChange = vi.fn();
    render(
      <Stepper
        value={2}
        onChange={handleChange}
        min={1}
        max={10}
        ariaLabel="sets"
      />
    );

    const input = screen.getByRole('textbox', { name: 'sets' });
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleChange).toHaveBeenCalledWith(4);
    expect(input).toHaveValue('4');
  });

  it('increments and decrements using buttons with aria-labels', () => {
    const handleChange = vi.fn();
    render(
      <Stepper
        value={2}
        onChange={handleChange}
        min={1}
        max={5}
        step={1}
        ariaLabel="target sets"
      />
    );

    const decBtn = screen.getByRole('button', { name: 'Decrease target sets' });
    const incBtn = screen.getByRole('button', { name: 'Increase target sets' });

    expect(decBtn).toBeInTheDocument();
    expect(incBtn).toBeInTheDocument();

    fireEvent.click(incBtn);
    expect(handleChange).toHaveBeenCalledWith(3);

    fireEvent.click(decBtn);
    expect(handleChange).toHaveBeenCalledWith(1);
  });

  it('disables decrease at min and increase at max', () => {
    render(
      <Stepper
        value={1}
        onChange={vi.fn()}
        min={1}
        max={1}
        ariaLabel="sets"
      />
    );

    expect(screen.getByRole('button', { name: 'Decrease sets' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase sets' })).toBeDisabled();
  });
});
