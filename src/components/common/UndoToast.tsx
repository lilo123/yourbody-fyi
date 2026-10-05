import React, { useRef, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { StatusBanner } from './StatusBanner';
import { Z_INDEX_TOAST } from '../../constants/zLayers';

export interface UndoToastItem {
  id?: string;
  verb: string;
  subject: string;
  detail?: string;
  onUndo?: () => void | Promise<void>;
  undoLabel?: string;
  undoAriaLabel?: string;
}

export interface UndoToastProps {
  toast: UndoToastItem | null;
  onDismiss: () => void;
  showUndo?: boolean;
  durationMs?: number;
  isStaged?: boolean;
  isTimerActive?: boolean;
  bottom?: number;
  stackIndex?: number;
  testId?: string;
  subjectTestId?: string;
  undoBtnTestId?: string;
  undoSpanTestId?: string;
  children?: React.ReactNode;
  /** @deprecated YB6: ignored, toast is always bottom-anchored */
  isModalOpen?: boolean;
}

export const UndoToast: React.FC<UndoToastProps> = ({
  toast,
  onDismiss,
  showUndo,
  durationMs = 6000,
  isStaged = false,
  isTimerActive = false,
  bottom: customBottom,
  stackIndex = 0,
  testId = 'quick-log-toast',
  subjectTestId = 'toast-dish-text',
  undoBtnTestId = 'toast-undo-btn',
  undoSpanTestId = 'undo-add-favorite-btn',
  children,
}) => {
  const isExpiredRef = useRef(false);
  const isPausedRef = useRef(false);
  const isHoveredRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dynamicBottom, setDynamicBottom] = useState<number>(() => {
    if (isTimerActive) return 148;
    if (isStaged) return 128;
    return 74;
  });

  const effectiveBottom = (customBottom !== undefined ? customBottom : dynamicBottom) + stackIndex * 68;

  useEffect(() => {
    if (!toast || customBottom !== undefined) return;

    const compute = () => {
      let navH = 66;
      if (typeof document !== 'undefined') {
        const nav = document.querySelector('nav');
        if (nav && nav.getBoundingClientRect().height > 0) {
          navH = nav.getBoundingClientRect().height;
        }
      }
      let baseline = navH;
      if (isTimerActive && typeof document !== 'undefined') {
        const pill = document.querySelector('[data-testid="rest-timer-pill"]');
        baseline = pill ? Math.max(baseline, window.innerHeight - pill.getBoundingClientRect().top) : Math.max(baseline, 140);
      }
      if (isStaged && typeof document !== 'undefined') {
        const actions = document.querySelector('[data-testid="staged-card-actions"]');
        const actionsH = actions ? actions.getBoundingClientRect().height : 54;
        baseline = Math.max(baseline, navH + actionsH);
      }
      setDynamicBottom(Math.round(baseline + 8));
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, { passive: true });

    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof document !== 'undefined') {
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(compute);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(compute);
        resizeObserver.observe(document.body);
        const actions = document.querySelector('[data-testid="staged-card-actions"]');
        if (actions) resizeObserver.observe(actions);
        const nav = document.querySelector('nav');
        if (nav) resizeObserver.observe(nav);
        const pill = document.querySelector('[data-testid="rest-timer-pill"]');
        if (pill) resizeObserver.observe(pill);
      }
    }

    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute);
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [customBottom, isStaged, isTimerActive, toast]);

  useEffect(() => {
    if (!toast) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      isExpiredRef.current = false;
      return;
    }
    isExpiredRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isPausedRef.current || isHoveredRef.current) {
        isExpiredRef.current = true;
      } else {
        onDismiss();
      }
    }, durationMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [toast, onDismiss, durationMs]);

  const handleUndoFocus = () => { isPausedRef.current = true; };
  const handleUndoBlur = () => {
    isPausedRef.current = false;
    if (isExpiredRef.current && !isHoveredRef.current) onDismiss();
  };
  const handleMouseEnter = () => {
    if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(hover: hover)').matches) {
      return;
    }
    isHoveredRef.current = true;
  };
  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    if (isExpiredRef.current && !isPausedRef.current) onDismiss();
  };

  const handleUndoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toast?.onUndo) void toast.onUndo();
    onDismiss();
  };

  const verb = toast?.verb ?? '';
  const subject = toast?.subject ?? '';
  const detail = toast?.detail;
  const line2Title = toast ? (detail ? `${subject} · ${detail}` : subject) : '';
  const announcementMessage = toast ? (verb ? `${verb}: ${line2Title}` : line2Title) : null;
  const shouldShowUndo = showUndo !== undefined ? showUndo : Boolean(toast?.onUndo);
  const undoLabel = toast?.undoLabel ?? 'Undo';
  const undoAriaLabel =
    toast?.undoAriaLabel ??
    (verb ? `Undo ${verb.toLowerCase()} ${subject}` : `Undo ${subject}`).trim();

  return (
    <StatusBanner
      message={announcementMessage}
      tone="success"
      testId={testId}
      style={{ bottom: `${effectiveBottom}px` }}
      rawLayout
      className={`fixed left-1/2 -translate-x-1/2 ${Z_INDEX_TOAST} max-w-sm w-[calc(100%-2rem)] bg-zinc-900! border border-emerald-500/40 backdrop-blur-xl shadow-2xl shadow-emerald-500/20 rounded-2xl py-2 px-3 flex items-center justify-between gap-3 text-white transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 select-none`}
    >
      {toast && (
        <>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              {verb ? <div className="text-xs text-zinc-400 font-normal leading-none">{verb}</div> : null}
              <div
                data-testid={subjectTestId}
                title={line2Title}
                className={`text-sm font-semibold text-white truncate ${verb ? 'mt-1 leading-snug' : 'leading-snug'}`}
              >
                <span>{subject}</span>
                {detail ? (
                  <>
                    <span className="text-zinc-400 font-normal"> · </span>
                    <span>{detail}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          {shouldShowUndo && (
            <button
              type="button"
              data-testid={undoBtnTestId}
              aria-label={undoAriaLabel}
              onClick={handleUndoClick}
              onFocus={handleUndoFocus}
              onBlur={handleUndoBlur}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              className="shrink-0 h-11 min-h-[44px] min-w-[48px] px-3.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 hover:bg-emerald-500/30 active:scale-95 text-xs font-bold text-emerald-200 transition touch-manipulation cursor-pointer flex items-center justify-center"
            >
              <span data-testid={undoSpanTestId}>{undoLabel}</span>
            </button>
          )}
          {children}
        </>
      )}
    </StatusBanner>
  );
};
