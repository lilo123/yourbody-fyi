import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useModalA11y } from './useModalA11y';

function Harness({ onClose, withNested = false }: { onClose: () => void; withNested?: boolean }) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const ref = useModalA11y(open, onClose);
  return (
    <div>
      <button data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" data-testid="dialog">
          <button data-testid="first">First</button>
          <input data-testid="middle" />
          {withNested && (
            <>
              <button data-testid="open-nested" onClick={() => setNested(true)}>
                Open unit sheet
              </button>
              {nested && (
                // The unit bottom-sheet renders inline, inside the dialog.
                <div role="dialog" aria-modal="true" data-testid="nested">
                  <button data-testid="close-nested" onClick={() => setNested(false)}>
                    Close sheet
                  </button>
                </div>
              )}
            </>
          )}
          <button
            data-testid="last"
            onClick={() => {
              setOpen(false);
              onClose();
            }}
          >
            Last
          </button>
        </div>
      )}
    </div>
  );
}

describe('useModalA11y', () => {
  it('moves focus to the first control, not to a destructive one further down', () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('opener'));
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('opener'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps Tab from the last control back to the first', () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('opener'));

    screen.getByTestId('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    render(<Harness onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('opener'));

    screen.getByTestId('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });

  it('restores focus to the opener on close', () => {
    render(<Harness onClose={() => {}} />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).not.toBe(opener);

    fireEvent.click(screen.getByTestId('last'));

    // Without this, a keyboard or screen-reader user is dumped back on <body>
    // and silently returned to the top of the page.
    expect(document.activeElement).toBe(opener);
  });

  it('does nothing at all while closed', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets a nested dialog or menu handle Escape first', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} withNested />);
    fireEvent.click(screen.getByTestId('opener'));
    fireEvent.click(screen.getByTestId('open-nested'));

    // The hook listens in the capture phase on `document`, so it beats the
    // nested control's own window-level handler every time. Escape inside the
    // unit bottom-sheet must dismiss the sheet, not throw away the whole dish.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('close-nested'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
