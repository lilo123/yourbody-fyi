import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dumbbell } from 'lucide-react';
import { Chip } from './Chip';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Chip', () => {
  it('renders static chip as span with rounded-full and 12px text', async () => {
    const { container } = render(
      <Chip label="Bench Press" icon={<Dumbbell />} testId="static-chip" />
    );

    const chip = screen.getByTestId('static-chip');
    expect(chip.tagName.toLowerCase()).toBe('span');
    expect(chip).toHaveTextContent('Bench Press');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).toContain('text-xs');
    expect(chip.className).toContain('h-6');

    await expectNoA11yViolations(container);
  });

  it('renders interactive toggle chip with aria-pressed', async () => {
    const handleClick = vi.fn();
    const { container } = render(
      <Chip
        label="Chest"
        selected={true}
        onClick={handleClick}
        testId="toggle-chip"
      />
    );

    const chip = screen.getByTestId('toggle-chip');
    expect(chip.tagName.toLowerCase()).toBe('button');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.className).toContain('text-cyan-300');

    fireEvent.click(chip);
    expect(handleClick).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  it('renders unselected interactive chip with aria-pressed="false"', () => {
    render(
      <Chip
        label="Back"
        selected={false}
        onClick={vi.fn()}
        testId="unselected-chip"
      />
    );

    const chip = screen.getByTestId('unselected-chip');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
  });
});
