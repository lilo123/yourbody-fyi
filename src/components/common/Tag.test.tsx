import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Check, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Tag } from './Tag';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Tag', () => {
  it('renders neutral tag by default with rounded-full and 12px text', async () => {
    const { container } = render(<Tag label="Archived" testId="tag-archived" />);

    const tag = screen.getByTestId('tag-archived');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveTextContent('Archived');
    expect(tag.className).toContain('rounded-full');
    expect(tag.className).toContain('text-xs');
    expect(tag.className).toContain('font-semibold');
    expect(tag.className).toContain('bg-zinc-800');

    await expectNoA11yViolations(container);
  });

  it('renders all semantic tones correctly', async () => {
    const { container } = render(
      <div>
        <Tag tone="info" label="Master" icon={<Info />} />
        <Tag tone="success" label="PR" icon={<Check />} />
        <Tag tone="warning" label="Pending" icon={<AlertTriangle />} />
        <Tag tone="danger" label="Failed" icon={<AlertCircle />} />
      </div>
    );

    expect(screen.getByText('Master').parentElement?.className).toContain('text-cyan-300');
    expect(screen.getByText('PR').parentElement?.className).toContain('text-emerald-300');
    expect(screen.getByText('Pending').parentElement?.className).toContain('text-amber-300');
    expect(screen.getByText('Failed').parentElement?.className).toContain('text-rose-300');

    await expectNoA11yViolations(container);
  });
});
