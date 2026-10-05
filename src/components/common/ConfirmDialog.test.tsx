import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';
import { expectNoA11yViolations } from '../../test/a11y';

describe('ConfirmDialog', () => {
  it('renders title, consequence, 44px confirm and cancel buttons', async () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    const { container } = render(
      <ConfirmDialog
        isOpen={true}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        title="Delete 3 logged sets of Bench Press?"
        consequence="This will permanently remove these sets from today's workout."
        confirmLabel="Delete sets"
        cancelLabel="Keep sets"
        testId="delete-sets-dialog"
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Delete 3 logged sets of Bench Press?' })
    ).toBeInTheDocument();
    expect(
      screen.getByText("This will permanently remove these sets from today's workout.")
    ).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: 'Keep sets' });
    const confirmBtn = screen.getByRole('button', { name: 'Delete sets' });

    expect(cancelBtn.className).toContain('min-h-[44px]');
    expect(confirmBtn.className).toContain('min-h-[44px]');
    expect(confirmBtn.className).toContain('bg-rose-500/20');

    fireEvent.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  it('triggers onCancel when Escape key is pressed', () => {
    const handleCancel = vi.fn();

    render(
      <ConfirmDialog
        isOpen={true}
        onConfirm={vi.fn()}
        onCancel={handleCancel}
        title="Clear workout?"
        consequence="All exercises and logged sets will be removed."
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});
