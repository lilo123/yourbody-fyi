import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from './Skeleton';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Skeleton', () => {
  it('renders with role="status", aria-busy="true", and sr-only label', async () => {
    const { container } = render(
      <Skeleton variant="row" ariaLabel="Loading exercises..." testId="skeleton-row" />
    );

    const el = screen.getByTestId('skeleton-row');
    expect(screen.getByRole('status')).toBe(el);
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading exercises...')).toHaveClass('sr-only');

    await expectNoA11yViolations(container);
  });

  it('renders correct count of skeleton elements', () => {
    const { container } = render(<Skeleton variant="card" count={3} />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders chip skeleton with rounded-full', () => {
    const { container } = render(<Skeleton variant="chip" />);

    const pulseEl = container.querySelector('.animate-pulse');
    expect(pulseEl?.className).toContain('rounded-full');
  });
});
