import React, { useState, useEffect } from 'react';
import { useToast } from '../../hooks/useToast';
import { UndoToast } from './UndoToast';
import { getModalBottomAvoidance, isAnyModalOpen } from '../../constants/zLayers';

function getVisibleBottomOffset(): number {
  if (typeof document === 'undefined') return 74;

  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // The toast is centered with max-width 384px (max-w-sm) or w-[calc(100%-2rem)]
  const toastLeft = Math.max(16, (viewportWidth - 384) / 2);
  const toastRight = Math.min(viewportWidth - 16, (viewportWidth + 384) / 2);

  const overlapsToastLane = (rect: DOMRect) => {
    return rect.right > toastLeft && rect.left < toastRight;
  };

  let maxTopEdgeFromBottom = 66;

  // 1. BottomNav: fixed at the bottom of the viewport
  const nav = document.querySelector('nav');
  if (nav) {
    const navRect = nav.getBoundingClientRect();
    if (navRect.height > 0 && navRect.bottom >= viewportHeight - 5 && overlapsToastLane(navRect)) {
      maxTopEdgeFromBottom = Math.max(maxTopEdgeFromBottom, viewportHeight - navRect.top);
    }
  }

  // 2. Rest-timer pill: fixed above bottom nav
  const pill = document.querySelector('[data-testid="rest-timer-pill"]');
  if (pill) {
    const pillRect = pill.getBoundingClientRect();
    if (
      pillRect.height > 0 &&
      pillRect.top < viewportHeight &&
      pillRect.bottom > 0 &&
      pillRect.bottom >= viewportHeight - 200 &&
      overlapsToastLane(pillRect)
    ) {
      maxTopEdgeFromBottom = Math.max(maxTopEdgeFromBottom, viewportHeight - pillRect.top);
    }
  }

  // 3. Staged bar: only while it is actually bottom-anchored!
  const staged = document.querySelector('[data-testid="staged-card-actions"]');
  if (staged) {
    const stagedRect = staged.getBoundingClientRect();
    const distFromBottom = viewportHeight - stagedRect.bottom;
    const isActuallyBottomAnchored =
      stagedRect.height > 0 &&
      distFromBottom >= 50 &&
      distFromBottom <= 90 &&
      stagedRect.top >= viewportHeight - 160 &&
      overlapsToastLane(stagedRect);

    if (isActuallyBottomAnchored) {
      maxTopEdgeFromBottom = Math.max(maxTopEdgeFromBottom, viewportHeight - stagedRect.top);
    }
  }

  const baseOffset = Math.round(maxTopEdgeFromBottom + 8);
  return getModalBottomAvoidance(baseOffset);
}

export const ToastHost: React.FC = () => {
  const { activeToast, dismiss, offset } = useToast();
  const [, setTick] = useState(0);

  useEffect(() => {
    const onResizeOrScroll = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResizeOrScroll);
    window.addEventListener('scroll', onResizeOrScroll, { passive: true });

    // Capture-phase scroll listener and visualViewport resize listener for modals (YB6 P3)
    const onCaptureScroll = () => {
      if (isAnyModalOpen()) {
        setTick((t) => t + 1);
      }
    };
    window.addEventListener('scroll', onCaptureScroll, { capture: true, passive: true });

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const onVisualViewportResize = () => {
      if (isAnyModalOpen()) {
        setTick((t) => t + 1);
      }
    };
    if (vv) {
      vv.addEventListener('resize', onVisualViewportResize);
    }

    return () => {
      window.removeEventListener('resize', onResizeOrScroll);
      window.removeEventListener('scroll', onResizeOrScroll);
      window.removeEventListener('scroll', onCaptureScroll, { capture: true });
      if (vv) {
        vv.removeEventListener('resize', onVisualViewportResize);
      }
    };
  }, []);

  const visibleOffset = getVisibleBottomOffset();
  const requestedOffset = activeToast?.offset ?? offset;
  const effectiveBottom = requestedOffset !== undefined
    ? Math.max(requestedOffset, visibleOffset)
    : visibleOffset;

  const verb = activeToast?.item.verb ?? '';
  const subject = activeToast?.item.subject ?? '';
  const detail = activeToast?.item.detail;
  const line2Title = detail ? `${subject} · ${detail}` : subject;
  const announcementMessage = activeToast
    ? (verb ? `${verb}: ${line2Title}` : line2Title)
    : '';

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcementMessage}
      </div>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" />

      {activeToast ? (
        <UndoToast
          toast={activeToast.item}
          onDismiss={dismiss}
          durationMs={activeToast.durationMs ?? (activeToast.kind === 'undo' ? 6000 : 4000)}
          bottom={effectiveBottom}
          testId={activeToast.testId ?? 'quick-log-toast'}
          subjectTestId={activeToast.subjectTestId ?? 'toast-dish-text'}
          undoBtnTestId={activeToast.undoBtnTestId ?? 'toast-undo-btn'}
          undoSpanTestId={activeToast.undoSpanTestId ?? 'undo-add-favorite-btn'}
        >
          {activeToast.children}
        </UndoToast>
      ) : null}
    </>
  );
};
