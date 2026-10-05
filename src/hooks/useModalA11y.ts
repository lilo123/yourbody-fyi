import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Escape-to-close, focus trap and focus restoration for a modal dialog.
 *
 * Returns a ref to attach to the dialog container. The caller still owns the
 * ARIA attributes (`role`, `aria-modal`, `aria-labelledby`) because the ids
 * differ per dialog.
 *
 * Notes on the deliberate choices here:
 *  - The focusable set is re-queried on every Tab rather than cached, because
 *    these dialogs add and remove rows while open; a cached list would trap
 *    focus on detached nodes.
 *  - Focus is restored to whatever was focused before the dialog opened. Without
 *    this, closing the dish modal drops focus on <body> and a keyboard or screen
 *    reader user is silently returned to the top of the page.
 */
export function useModalA11y(isOpen: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the trap effect does not re-run (and re-steal focus) when
  // the caller passes a new inline onClose on every render. Assigned in an
  // effect, not during render: a render-phase ref mutation is not safe under
  // concurrent rendering.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // No visibility filtering here: `offsetParent` is always null under jsdom,
    // so filtering on it would empty the list in every test while appearing to
    // work in a browser.
    const focusables = () =>
      Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

    // Move focus into the dialog, but never past the first control: autofocus
    // on a destructive button is a known footgun.
    const first = focusables()[0];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // This listener is in the capture phase on `document`, so it fires
        // before any nested control's own handler (those listen on `window`,
        // which bubbles last). Without this guard, Escape inside the unit
        // bottom-sheet or an overflow menu would close the entire dialog and
        // discard the user's edits instead of dismissing the inner control.
        // Inline editors that own Escape (the D46 Scale box) opt in with
        // data-captures-escape so Escape cancels the edit, not the dialog.
        if (containerRef.current?.querySelector('[role="dialog"], [role="menu"], [data-captures-escape]')) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && (active === firstEl || !containerRef.current?.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // The opener may itself have been unmounted (e.g. the dish row was
      // deleted from inside the modal), so guard before restoring.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
