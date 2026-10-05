import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Button', () => {
  it('renders primary button by default with text and 44px hit height', async () => {
    const handleClick = vi.fn();
    const { container } = render(
      <Button onClick={handleClick} testId="test-btn">
        Save changes
      </Button>
    );

    const btn = screen.getByTestId('test-btn');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Save changes');
    expect(btn.className).toContain('min-h-[44px]');
    expect(btn.className).toContain('rounded-xl');
    expect(btn.className).toContain('text-xs');
    expect(btn.className).toContain('font-bold');

    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  it('renders all variants correctly', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
    );

    expect(screen.getByText('Primary').className).toContain('bg-gradient-to-r');
    expect(screen.getByText('Secondary').className).toContain('bg-zinc-800');
    expect(screen.getByText('Delete').className).toContain('bg-rose-500/20');
    expect(screen.getByText('Cancel').className).toContain('bg-transparent');

    await expectNoA11yViolations(container);
  });

  it('handles loading state with spinner and aria-busy', async () => {
    const handleClick = vi.fn();
    const { container } = render(
      <Button isLoading onClick={handleClick}>
        Saving
      </Button>
    );

    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.querySelector('svg')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();

    await expectNoA11yViolations(container);
  });

  it('renders left and right icons', () => {
    render(
      <Button
        leftIcon={<span data-testid="left-icon">L</span>}
        rightIcon={<span data-testid="right-icon">R</span>}
      >
        Icon Button
      </Button>
    );

    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });
});
