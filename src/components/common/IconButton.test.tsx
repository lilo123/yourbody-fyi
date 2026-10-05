import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { expectNoA11yViolations } from '../../test/a11y';

describe('IconButton', () => {
  it('renders with required aria-label and >= 44px hit dimensions', async () => {
    const handleClick = vi.fn();
    const { container } = render(
      <IconButton
        aria-label="Close dialog"
        onClick={handleClick}
        icon={<X className="w-5 h-5" />}
        testId="close-btn"
      />
    );

    const btn = screen.getByTestId('close-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Close dialog');
    expect(btn.className).toContain('min-h-[44px]');
    expect(btn.className).toContain('min-w-[44px]');
    expect(btn.className).toContain('rounded-xl');

    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  it('renders all variants correctly', async () => {
    const { container } = render(
      <div>
        <IconButton aria-label="Ghost action" variant="ghost" icon={<X />} />
        <IconButton aria-label="Secondary action" variant="secondary" icon={<X />} />
        <IconButton aria-label="Primary action" variant="primary" icon={<X />} />
        <IconButton aria-label="Delete action" variant="destructive" icon={<X />} />
      </div>
    );

    expect(screen.getByLabelText('Ghost action').className).toContain('bg-transparent');
    expect(screen.getByLabelText('Secondary action').className).toContain('bg-zinc-800');
    expect(screen.getByLabelText('Primary action').className).toContain('bg-gradient-to-r');
    expect(screen.getByLabelText('Delete action').className).toContain('text-rose-400');

    await expectNoA11yViolations(container);
  });

  it('disables interactions when disabled prop is true', () => {
    const handleClick = vi.fn();
    render(
      <IconButton
        aria-label="Disabled action"
        disabled
        onClick={handleClick}
        icon={<X />}
      />
    );

    const btn = screen.getByLabelText('Disabled action');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });
});
