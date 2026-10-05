import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Card', () => {
  it('renders default card with rounded-3xl (24px) and zinc-900 surface', async () => {
    const { container } = render(
      <Card testId="test-card">
        <h3 className="text-sm font-bold text-white">Card Header</h3>
        <p className="text-xs text-zinc-400">Card content description</p>
      </Card>
    );

    const card = screen.getByTestId('test-card');
    expect(card).toBeInTheDocument();
    expect(card.className).toContain('rounded-3xl');
    expect(card.className).toContain('bg-zinc-900/90');
    expect(card.className).toContain('border-zinc-800/80');

    await expectNoA11yViolations(container);
  });

  it('renders active staged card with cyan border and glow', async () => {
    const { container } = render(
      <Card variant="active" testId="active-card">
        <div className="text-sm text-white">Active exercise card</div>
      </Card>
    );

    const card = screen.getByTestId('active-card');
    expect(card.className).toContain('border-cyan-500/40');
    expect(card.className).toContain('shadow-neon-cyan');

    await expectNoA11yViolations(container);
  });

  it('renders interactive card variant with hover style', () => {
    render(
      <Card variant="interactive" testId="interactive-card">
        <div className="text-sm text-white">Clickable card</div>
      </Card>
    );

    const card = screen.getByTestId('interactive-card');
    expect(card.className).toContain('hover:border-zinc-700');
    expect(card.className).toContain('cursor-pointer');
  });
});
