/**
 * Layer stacking scale.
 *
 * Stacking tiers in this codebase:
 * - z-[45]: Global rest timer pill (GlobalRestTimerPill.tsx)
 * - z-50:   Legacy baseline toast tier (hidden under modals)
 * - z-[60]: Modal overlays and dialog containers (AccessibleModal, ConfirmDialog, Sheet, EditMealSheet, CustomDishesModal)
 * - z-[65]: App toast notifications (must sit above modal overlays z-60, but below inner pickers like UnitChip)
 * - z-[70]: UnitChip unit picker bottom sheet (inner modal picker)
 */

export const Z_INDEX_MODAL = 'z-[60]';
export const Z_INDEX_TOAST = 'z-[65]';
export const Z_INDEX_INNER_PICKER = 'z-[70]';

/**
 * Checks whether any modal dialog with role="dialog" and aria-modal="true"
 * is currently rendered in the DOM.
 *
 * Matches the same query semantics as updateSafety.ts checkOpenModal without counting toasts.
 */
export function isAnyModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

/**
 * Computes bottom offset for toasts to avoid modal controls.
 *
 * While an aria-modal dialog is open, the toast is bottom-anchored and avoids
 * the open dialog's action controls:
 * 1. staged-card-actions row
 * 2. parentElement of button[type="submit"] (action footer)
 * 3. document.activeElement (focused control inside dialog)
 *
 * If any obstacle intersects the toast bottom lane, the toast is raised to sit
 * 8px above the highest intersecting control.
 *
 * If raising would push the toast above the dialog's header/close row,
 * falls back to offset0 (normal bottom position over empty area).
 */
export function getModalBottomAvoidance(baseOffset: number, toastHeight: number = 64): number {
  if (typeof document === 'undefined') return baseOffset;

  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (!dialogs || dialogs.length === 0) return baseOffset;

  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 0;
  const vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0;
  if (vh <= 0) return baseOffset;

  // Find top-most dialog: last visible dialog in DOM order
  let topDialog: HTMLElement | null = null;
  for (let idx = dialogs.length - 1; idx >= 0; idx--) {
    const candidate = dialogs[idx];
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      topDialog = candidate;
      break;
    }
  }
  if (!topDialog) {
    topDialog = dialogs[dialogs.length - 1];
  }

  // Keyboard avoidance via visualViewport
  let offset0 = baseOffset;
  if (typeof window !== 'undefined' && window.visualViewport) {
    const vv = window.visualViewport;
    const kb = vh - (vv.offsetTop + vv.height);
    if (kb >= 100) {
      offset0 = Math.max(baseOffset, Math.round(kb + 8));
    }
  }

  // Obstacles inside top-most dialog with visible rect h > 0
  const obstacles: HTMLElement[] = [];
  const stagedActions = topDialog.querySelectorAll<HTMLElement>('[data-testid="staged-card-actions"]');
  stagedActions.forEach((el) => obstacles.push(el));

  const submitButtons = topDialog.querySelectorAll<HTMLElement>('button[type="submit"]');
  submitButtons.forEach((btn) => {
    if (btn.parentElement && btn.parentElement !== topDialog) {
      obstacles.push(btn.parentElement);
    }
    obstacles.push(btn);
  });

  if (
    document.activeElement &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body &&
    document.activeElement !== topDialog &&
    topDialog.contains(document.activeElement)
  ) {
    obstacles.push(document.activeElement);
  }

  // Toast horizontal bounds (same as ToastHost)
  const toastLeft = Math.max(16, (vw - 384) / 2);
  const toastRight = Math.min(vw - 16, (vw + 384) / 2);

  let o = offset0;
  for (let pass = 0; pass < 3; pass++) {
    const laneTop = vh - o - toastHeight - 8;
    const laneBottom = vh - o + 8;
    let raised = false;
    let maxRaisedO = o;

    for (const obstacle of obstacles) {
      const rect = obstacle.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const hOverlaps = rect.right > toastLeft && rect.left < toastRight;
      const vOverlaps = rect.bottom > laneTop && rect.top < laneBottom;
      if (hOverlaps && vOverlaps) {
        const candidateO = Math.round(vh - rect.top + 8);
        if (candidateO > maxRaisedO) {
          maxRaisedO = candidateO;
          raised = true;
        }
      }
    }

    if (!raised) break;
    o = maxRaisedO;
  }

  // Header guard: bottom of close button or header row
  let headerBottom = 0;
  const closeButton = topDialog.querySelector<HTMLElement>(
    'button[aria-label*="close" i], [data-testid*="close" i]'
  );
  if (closeButton) {
    const closeRect = closeButton.getBoundingClientRect();
    if (closeRect.height > 0) {
      headerBottom = closeRect.bottom;
    }
  } else {
    const headerElement = topDialog.querySelector<HTMLElement>('header, [role="banner"]');
    if (headerElement) {
      const headerRect = headerElement.getBoundingClientRect();
      if (headerRect.height > 0) {
        headerBottom = headerRect.bottom;
      }
    }
  }

  if (vh - o - toastHeight < headerBottom + 8) {
    return offset0;
  }

  return Math.round(o);
}

/**
 * Computes the top lane offset for toasts when a modal dialog is open.
 *
 * Finds the top-most [role="dialog"][aria-modal="true"], measures the bottom of its header
 * controls (close button or header row), clamps to >= env(safe-area-inset-top, 0px) + 12px,
 * and positions the toast 8px below the header so header controls (like Close X) remain
 * completely clickable and unobstructed.
 *
 * Falls back to calc(env(safe-area-inset-top, 0px) + 12px) if no header is found or outside browser DOM.
 */
export function getModalToastTop(stackIndex: number = 0): string {
  const baseOffset = 12 + stackIndex * 68;
  const fallback = `calc(env(safe-area-inset-top, 0px) + ${baseOffset}px)`;
  if (typeof document === 'undefined') return fallback;

  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (!dialogs || dialogs.length === 0) return fallback;

  // The top-most dialog is the last visible dialog in DOM order
  let topDialog: HTMLElement | null = null;
  for (let idx = dialogs.length - 1; idx >= 0; idx--) {
    const candidate = dialogs[idx];
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      topDialog = candidate;
      break;
    }
  }

  // If no dialog has positive dimensions yet (e.g. initial render/mock), pick the last rendered dialog
  if (!topDialog) {
    topDialog = dialogs[dialogs.length - 1];
  }

  // Look for a close button or header within the top dialog
  const closeButton = topDialog.querySelector<HTMLElement>(
    'button[aria-label*="close" i], [data-testid*="close" i]'
  );

  let headerBottom: number | null = null;

  if (closeButton) {
    const closeRect = closeButton.getBoundingClientRect();
    if (closeRect.height > 0) {
      let candidateBottom = closeRect.bottom;
      // Search for closest flex row container or header
      const parentFlex = closeButton.parentElement?.closest<HTMLElement>(
        'header, [role="banner"], .flex'
      );
      if (
        parentFlex &&
        parentFlex !== topDialog &&
        !parentFlex.classList.contains('flex-col')
      ) {
        const flexRect = parentFlex.getBoundingClientRect();
        if (flexRect.height > 0) {
          candidateBottom = Math.max(candidateBottom, flexRect.bottom);
        }
      } else if (closeButton.parentElement && closeButton.parentElement !== topDialog) {
        const parentRect = closeButton.parentElement.getBoundingClientRect();
        if (parentRect.height > 0) {
          candidateBottom = Math.max(candidateBottom, parentRect.bottom);
        }
      }
      headerBottom = candidateBottom;
    }
  }

  if (headerBottom === null) {
    const headerElement = topDialog.querySelector<HTMLElement>('header, [role="banner"]');
    if (headerElement) {
      const headerRect = headerElement.getBoundingClientRect();
      if (headerRect.height > 0) {
        headerBottom = headerRect.bottom;
      }
    }
  }

  if (headerBottom === null || headerBottom <= 0) {
    return fallback;
  }

  const targetTop = Math.round(headerBottom + 8 + stackIndex * 68);
  // Guard: a mis-detected "header" (e.g. a tall flex ancestor) must never push the toast off-screen.
  if (typeof window !== 'undefined' && window.innerHeight > 0 && targetTop + 80 > window.innerHeight) {
    return fallback;
  }
  return `max(calc(env(safe-area-inset-top, 0px) + ${baseOffset}px), ${targetTop}px)`;
}
