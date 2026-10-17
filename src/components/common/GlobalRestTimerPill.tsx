import React, { useSyncExternalStore, useState, useEffect } from 'react';
import { Timer, Play, Pause, Square } from 'lucide-react';
import { restTimerStore } from '../../utils/restTimerStore';

export function getStagedActionsAvoidanceOffset(): number | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (window.innerWidth >= 640) return null;

  const staged = document.querySelector<HTMLElement>('[data-testid="staged-card-actions"]');
  if (!staged) return null;

  const rect = staged.getBoundingClientRect();
  const vh = window.innerHeight;
  if (rect.height <= 0 || rect.top >= vh || rect.bottom <= 0) return null;

  return Math.round(vh - rect.top + 8);
}

function useStagedActionsAvoidance(): number | null {
  const [offset, setOffset] = useState<number | null>(() => getStagedActionsAvoidanceOffset());

  useEffect(() => {
    const update = () => {
      setOffset(getStagedActionsAvoidanceOffset());
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return offset;
}

export const GlobalRestTimerPill: React.FC = () => {
  const state = useSyncExternalStore(
    restTimerStore.subscribe,
    restTimerStore.getSnapshot,
    restTimerStore.getServerSnapshot
  );
  const stagedOffset = useStagedActionsAvoidance();

  if (!state.isRunning && !state.isPaused) {
    return null;
  }

  const mins = Math.floor(state.remainingSeconds / 60);
  const secs = (state.remainingSeconds % 60).toString().padStart(2, '0');
  const inlineStyle: React.CSSProperties = stagedOffset !== null
    ? { bottom: `${stagedOffset}px` }
    : {};

  return (
    <div
      style={inlineStyle}
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[45] max-w-lg mx-auto bg-zinc-900 backdrop-blur-xl border border-cyan-500/50 rounded-2xl p-3 flex items-center justify-between shadow-[0_4px_25px_rgba(6,182,212,0.3)] transition-[bottom] duration-150"
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
          onClick={() => (state.isRunning ? restTimerStore.pause() : restTimerStore.resume())}
          className="min-w-[44px] min-h-[44px] h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 flex items-center justify-center transition cursor-pointer touch-manipulation"
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
          onClick={() => restTimerStore.addSeconds(90)}
          className="min-w-[44px] min-h-[44px] h-11 px-3 py-2 text-xs font-bold rounded-xl bg-zinc-800 text-zinc-300 hover:text-white flex items-center justify-center transition cursor-pointer touch-manipulation"
          title="Add 90 seconds"
          aria-label="Add 90 seconds"
        >
          +90s
        </button>
        <button
          type="button"
          onClick={() => restTimerStore.stop()}
          className="min-w-[44px] min-h-[44px] h-11 px-3 py-2 text-xs font-bold rounded-xl bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 flex items-center justify-center gap-1.5 transition cursor-pointer touch-manipulation shrink-0"
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
