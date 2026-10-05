import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccessibleModal } from './AccessibleModal';

function TestHarness({
  dismissible = true,
  onEscape,
  closeOnBackdropClick = true,
  titleId,
  ariaLabel,
  withNested = false,
  testId = 'test-dialog',
  overlayTestId = 'test-overlay',
  className,
  overlayClassName,
}: {
  dismissible?: boolean | (() => boolean);
  onEscape?: () => boolean | void;
  closeOnBackdropClick?: boolean;
  titleId?: string;
  ariaLabel?: string;
  withNested?: boolean;
  testId?: string;
  overlayTestId?: string;
  className?: string;
  overlayClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);

  return (
    <div>
      <button data-testid="open-btn" onClick={() => setIsOpen(true)}>
        Open Modal
      </button>
      <AccessibleModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        dismissible={dismissible}
        onEscape={onEscape}
        closeOnBackdropClick={closeOnBackdropClick}
        titleId={titleId}
        ariaLabel={ariaLabel}
        testId={testId}
        overlayTestId={overlayTestId}
        className={className}
        overlayClassName={overlayClassName}
      >
        {titleId && <h2 id={titleId}>Modal Title</h2>}
        <button data-testid="first-control">First</button>
        <input data-testid="middle-control" placeholder="Middle" />
        {withNested && (
          <div>
            <button data-testid="open-nested-btn" onClick={() => setNestedOpen(true)}>
              Open Nested
            </button>
            {nestedOpen && (
              <div role="dialog" aria-modal="true" data-testid="nested-dialog">
                <button data-testid="nested-close-btn" onClick={() => setNestedOpen(false)}>
                  Close Nested
                </button>
              </div>
            )}
          </div>
        )}
        <button data-testid="last-control" onClick={() => setIsOpen(false)}>
          Last
        </button>
      </AccessibleModal>
    </div>
  );
}

describe('AccessibleModal', () => {
  it('does not render when isOpen is false', () => {
    render(<TestHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('test-dialog')).toBeNull();
    expect(screen.queryByTestId('test-overlay')).toBeNull();
  });

  it('moves focus to the first control on open', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByTestId('first-control'));
  });

  it('wraps Tab from the last control back to the first control', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));

    screen.getByTestId('last-control').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('first-control'));
  });

  it('wraps Shift+Tab from the first control back to the last control', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));

    screen.getByTestId('first-control').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('last-control'));
  });

  it('restores focus to the opener element on close', () => {
    render(<TestHarness />);
    const openBtn = screen.getByTestId('open-btn');
    openBtn.focus();
    fireEvent.click(openBtn);

    expect(document.activeElement).not.toBe(openBtn);

    // Close using the last button
    fireEvent.click(screen.getByTestId('last-control'));
    expect(document.activeElement).toBe(openBtn);
  });

  it('closes on Escape key press', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not close on Escape when dismissible is false', () => {
    render(<TestHarness dismissible={false} />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('supports a dynamic dismissible function returning false', () => {
    render(<TestHarness dismissible={() => false} />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('intercepts Escape when onEscape returns false, then closes on next Escape if unhandled', () => {
    let pickerOpen = true;
    const onEscape = vi.fn(() => {
      if (pickerOpen) {
        pickerOpen = false;
        return false;
      }
      return undefined;
    });

    render(<TestHarness onEscape={onEscape} />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    // First escape intercepted
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeDefined();

    // Second escape closes modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on backdrop overlay click', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    const overlay = screen.getByTestId('test-overlay');
    fireEvent.click(overlay);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT close when clicking inside the dialog content', () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    const dialog = screen.getByTestId('test-dialog');
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('does NOT close on backdrop click when dismissible is false', () => {
    render(<TestHarness dismissible={false} />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    const overlay = screen.getByTestId('test-overlay');
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('does NOT close on backdrop click when closeOnBackdropClick is false', () => {
    render(<TestHarness closeOnBackdropClick={false} />);
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByRole('dialog')).toBeDefined();

    const overlay = screen.getByTestId('test-overlay');
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('sets aria-labelledby correctly when titleId is provided', () => {
    render(<TestHarness titleId="modal-title-heading" />);
    fireEvent.click(screen.getByTestId('open-btn'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title-heading');
  });

  it('sets aria-label correctly when ariaLabel is provided', () => {
    render(<TestHarness ariaLabel="Test Dialog Label" />);
    fireEvent.click(screen.getByTestId('open-btn'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Test Dialog Label');
  });

  it('lets a nested dialog handle Escape first via useModalA11y guard', () => {
    render(<TestHarness withNested />);
    fireEvent.click(screen.getByTestId('open-btn'));
    fireEvent.click(screen.getByTestId('open-nested-btn'));

    expect(screen.getByTestId('nested-dialog')).toBeDefined();

    // Escape while nested dialog is present should NOT close parent modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('test-dialog')).toBeDefined();

    // Close nested dialog
    fireEvent.click(screen.getByTestId('nested-close-btn'));
    expect(screen.queryByTestId('nested-dialog')).toBeNull();

    // Now Escape closes parent modal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('test-dialog')).toBeNull();
  });
});
