import React, { useSyncExternalStore, useState, useEffect, useRef, useCallback } from 'react';
import { Timer, Play, Pause, Square } from 'lucide-react';
import { restTimerStore } from '../../utils/restTimerStore';

/**
 * Returns the viewport top coordinate of any obstructing bottom element on mobile (<640px).
 * Reuses existing signals from ToastHost and zLayers:
 * 1. Staged meal action bar: [data-testid="staged-card-actions"] (ToastHost.tsx:47)
 * 2. Bottom sheet action row: [data-testid="sheet-action-row"] (zLayers.ts:81)
 * 3. Modal dialog container: [role="dialog"][aria-modal="true"] (zLayers.ts:22, isAnyModalOpen)
 */
export function getObstacleTop(): number | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  // Option E mobile collapse is phone breakpoint only (<640px)
  if (window.innerWidth >= 640) return null;

  // 1. Staged card action bar (e.g. on /nutrition or inside EditMealSheet)
  const staged = document.querySelector<HTMLElement>('[data-testid="staged-card-actions"]');
  if (staged) {
    const r = staged.getBoundingClientRect();
    if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
      return r.top;
    }
  }

  // 2. Bottom sheet action row (e.g. EditSetSheet action buttons)
  const sheetAction = document.querySelector<HTMLElement>('[data-testid="sheet-action-row"]');
  if (sheetAction) {
    const r = sheetAction.getBoundingClientRect();
    if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
      return r.top;
    }
  }

  // 3. Any modal dialog with role="dialog" and aria-modal="true" (matches isAnyModalOpen signal)
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  for (let idx = dialogs.length - 1; idx >= 0; idx--) {
    const candidate = dialogs[idx];
    const r = candidate.getBoundingClientRect();
    if (r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
      return r.top;
    }
  }

  return null;
}

export function useObstacleAvoidance(enabled: boolean = true): number | null {
  const [obstacleTop, setObstacleTop] = useState<number | null>(() => {
    if (!enabled) return null;
    return getObstacleTop();
  });

  useEffect(() => {
    if (!enabled) {
      setObstacleTop(null);
      return;
    }

    let observer: MutationObserver | null = null;
    let scrollAttached = false;
    let rafId: number | null = null;

    const runUpdate = () => {
      const next = getObstacleTop();
      setObstacleTop((prev) => (prev === next ? prev : next));
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      if (typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          runUpdate();
        });
      } else {
        runUpdate();
      }
    };

    const attachMobileListeners = () => {
      if (!scrollAttached) {
        window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
        scrollAttached = true;
      }
      if (!observer && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(scheduleUpdate);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributeFilter: ['aria-modal', 'hidden', 'aria-hidden', 'data-state', 'role'],
        });
      }
    };

    const detachMobileListeners = () => {
      if (scrollAttached) {
        window.removeEventListener('scroll', scheduleUpdate, { capture: true });
        scrollAttached = false;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const checkBreakpointAndSync = () => {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
      if (isMobile) {
        attachMobileListeners();
      } else {
        detachMobileListeners();
      }
      scheduleUpdate();
    };

    // Initial sync
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    if (isMobile) {
      attachMobileListeners();
      runUpdate();
    } else {
      setObstacleTop(null);
    }

    window.addEventListener('resize', checkBreakpointAndSync);

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener('resize', scheduleUpdate);
    }

    return () => {
      if (rafId !== null) {
        if (typeof cancelAnimationFrame !== 'undefined') {
          cancelAnimationFrame(rafId);
        }
        rafId = null;
      }
      window.removeEventListener('resize', checkBreakpointAndSync);
      if (vv) {
        vv.removeEventListener('resize', scheduleUpdate);
      }
      detachMobileListeners();
    };
  }, [enabled]);

  return obstacleTop;
}

export const GlobalRestTimerPill: React.FC = () => {
  const state = useSyncExternalStore(
    restTimerStore.subscribe,
    restTimerStore.getSnapshot,
    restTimerStore.getServerSnapshot
  );

  const isTimerActive = state.isRunning || state.isPaused;
  const obstacleTop = useObstacleAvoidance(isTimerActive);
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 5000);
  }, []);

  // When obstacle closes, return immediately to normal resting full pill
  useEffect(() => {
    if (obstacleTop === null) {
      setIsExpanded(false);
    }
  }, [obstacleTop]);

  // Manage 5s auto-collapse timer while expanded
  useEffect(() => {
    if (isExpanded && obstacleTop !== null) {
      resetCollapseTimer();
      return () => {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current);
        }
      };
    } else {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
      }
    }
  }, [isExpanded, obstacleTop, resetCollapseTimer]);

  // Collapse on outside click/tap
  useEffect(() => {
    if (!isExpanded || obstacleTop === null) return;

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handleOutsideClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [isExpanded, obstacleTop]);

  // Collapse on Escape key
  useEffect(() => {
    if (!isExpanded || obstacleTop === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isExpanded, obstacleTop]);

  if (!isTimerActive) {
    return null;
  }

  const mins = Math.floor(state.remainingSeconds / 60);
  const secs = (state.remainingSeconds % 60).toString().padStart(2, '0');

  // Option E: When an obstacle is present on mobile and not expanded, collapse to 44x44 round badge
  if (obstacleTop !== null && !isExpanded) {
    const badgeBottom = Math.round(window.innerHeight - obstacleTop + 8);
    return (
      <button
        type="button"
        style={{ bottom: `${badgeBottom}px` }}
        className="fixed right-4 z-[65] w-11 h-11 rounded-full bg-zinc-900 border-2 border-cyan-400 flex flex-col items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.45)] cursor-pointer touch-manipulation focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus:outline-none transition-[bottom] duration-150 motion-reduce:transition-none"
        data-testid="rest-timer-pill"
        onClick={() => setIsExpanded(true)}
        title={`Rest timer: ${mins}:${secs}`}
        aria-label={`Rest timer: ${mins}:${secs}`}
      >
        <div className="flex flex-col items-center justify-center scale-[0.8] origin-center pointer-events-none">
          <span className="text-xs uppercase font-bold text-cyan-400 leading-none">Rest</span>
          <span className="text-xs font-bold tabular-nums text-white leading-tight" data-testid="rest-timer-display">
            {mins}:{secs}
          </span>
        </div>
      </button>
    );
  }

  // Expanded state positioned above obstacle, or normal resting position (bottom 4.5rem + safe-area)
  const isLifted = obstacleTop !== null && isExpanded;
  const inlineStyle: React.CSSProperties = isLifted
    ? { bottom: `${Math.round(window.innerHeight - obstacleTop + 8)}px` }
    : {};

  const positionClasses = isLifted
    ? 'fixed left-4 right-4 z-[65]'
    : 'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[45]';

  return (
    <div
      ref={expandedRef}
      style={inlineStyle}
      onPointerDown={isLifted ? resetCollapseTimer : undefined}
      className={`${positionClasses} max-w-lg mx-auto bg-zinc-900 backdrop-blur-xl border border-cyan-500/50 rounded-2xl p-3 flex items-center justify-between shadow-[0_4px_25px_rgba(6,182,212,0.3)] transition-[bottom] duration-150 motion-reduce:transition-none`}
      data-testid="rest-timer-pill"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <Timer className="w-5 h-5 text-cyan-400 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-cyan-400 font-bold">
            Rest Timer
          </div>
          <div className="text-sm font-bold tabular-nums text-white" data-testid="rest-timer-display">
            {mins}:{secs}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            if (isLifted) resetCollapseTimer();
            if (state.isRunning) {
              restTimerStore.pause();
            } else {
              restTimerStore.resume();
            }
          }}
          className="min-w-[44px] min-h-[44px] h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 flex items-center justify-center transition cursor-pointer touch-manipulation focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
          title={state.isRunning ? 'Pause timer' : 'Resume timer'}
          aria-label={state.isRunning ? 'Pause timer' : 'Resume timer'}
        >
          {state.isRunning ? (
            <Pause className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Play className="w-5 h-5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (isLifted) resetCollapseTimer();
            restTimerStore.addSeconds(90);
          }}
          className="min-w-[44px] min-h-[44px] h-11 px-3 py-2 text-xs font-bold rounded-xl bg-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer touch-manipulation focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:outline-none"
          title="Add 90 seconds"
          aria-label="Add 90 seconds"
        >
          +90s
        </button>
        <button
          type="button"
          onClick={() => restTimerStore.stop()}
          className="min-w-[44px] min-h-[44px] h-11 px-3 py-2 text-xs font-bold rounded-xl bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 flex items-center justify-center gap-1.5 transition cursor-pointer touch-manipulation shrink-0 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
          title="Stop timer"
          aria-label="Stop timer"
          data-testid="stop-timer-btn"
        >
          <Square className="w-3.5 h-3.5 fill-current shrink-0" aria-hidden="true" />
          <span>Stop</span>
        </button>
      </div>
    </div>
  );
};
