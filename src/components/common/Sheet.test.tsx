import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet } from './Sheet';
import { expectNoA11yViolations } from '../../test/a11y';

describe('Sheet', () => {
  it('renders open sheet with title, close button, body, and footer', async () => {
    const handleClose = vi.fn();
    const { container } = render(
      <Sheet
        isOpen={true}
        onClose={handleClose}
        title="Edit Set 1"
        testId="edit-set-sheet"
        footer={<button type="button">Save changes</button>}
      >
        <p className="text-xs text-zinc-400">Sheet body content</p>
      </Sheet>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Set 1' })).toBeInTheDocument();
    expect(screen.getByText('Sheet body content')).toBeInTheDocument();
    expect(screen.getByText('Save changes')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close Edit Set 1' });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <Sheet isOpen={false} onClose={vi.fn()} title="Hidden Sheet">
        <p>Hidden</p>
      </Sheet>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape key press via AccessibleModal', () => {
    const handleClose = vi.fn();
    render(
      <Sheet isOpen={true} onClose={handleClose} title="Escape Test">
        <p>Press Esc to close</p>
      </Sheet>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
