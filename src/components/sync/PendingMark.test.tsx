import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingMark } from './PendingMark';
import { expectNoA11yViolations } from '../../test/a11y';

describe('PendingMark', () => {
  it('renders with role="status" and accessible label "Not synced yet"', () => {
    render(<PendingMark />);
    const mark = screen.getByTestId('pending-mark');
    expect(mark).toBeDefined();
    expect(mark.getAttribute('role')).toBe('status');
    expect(mark.getAttribute('aria-label')).toBe('Not synced yet');
    expect(mark.getAttribute('title')).toBe('Not synced yet');
    expect(mark.className).toContain('bg-amber-400');
  });

  it('supports size="sm" styling for dense contexts like set index cell', () => {
    const { rerender } = render(<PendingMark size="sm" />);
    const smMark = screen.getByTestId('pending-mark');
    expect(smMark.className).toContain('w-1.5');
    expect(smMark.className).toContain('h-1.5');

    rerender(<PendingMark size="default" />);
    const defaultMark = screen.getByTestId('pending-mark');
    expect(defaultMark.className).toContain('w-2');
    expect(defaultMark.className).toContain('h-2');
  });

  it('passes axe accessibility audit', async () => {
    const { container } = render(
      <div>
        <p>Row item <PendingMark /></p>
      </div>
    );
    await expectNoA11yViolations(container);
  });
});
