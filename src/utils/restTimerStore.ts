import { playTimerCompletionChime } from './sound';

export interface RestTimerSnapshot {
  remainingSeconds: number;
  totalDuration: number;
  isRunning: boolean;
  isPaused: boolean;
  targetEndTime: number | null;
}

export const SERVER_SNAPSHOT: RestTimerSnapshot = Object.freeze({
  remainingSeconds: 0,
  totalDuration: 0,
  isRunning: false,
  isPaused: false,
  targetEndTime: null,
});

const KEY_END = 'yourbody_rest_timer_end';
const KEY_REMAINING = 'yourbody_rest_timer_remaining';
const KEY_TOTAL = 'yourbody_rest_timer_total';
const KEY_PAUSED = 'yourbody_rest_timer_paused';

export class RestTimerStore {
  private listeners = new Set<() => void>();
  private tickerId: ReturnType<typeof setInterval> | null = null;
  private cachedSnapshot: RestTimerSnapshot = { ...SERVER_SNAPSHOT };

  constructor() {
    this.hydrateFromStorage();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorageEvent);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }
    }
  }

  private isStorageAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private hydrateFromStorage(): void {
    if (!this.isStorageAvailable()) return;
    try {
      const endStr = localStorage.getItem(KEY_END);
      const isPaused = localStorage.getItem(KEY_PAUSED) === '1';
      const total = Number(localStorage.getItem(KEY_TOTAL)) || 90;

      if (isPaused) {
        if (this.tickerId) {
          clearInterval(this.tickerId);
          this.tickerId = null;
        }
        const remaining = Number(localStorage.getItem(KEY_REMAINING)) || 0;
        this.cachedSnapshot = {
          remainingSeconds: remaining,
          totalDuration: total,
          isRunning: false,
          isPaused: remaining > 0,
          targetEndTime: null,
        };
      } else if (endStr) {
        const targetEnd = Number(endStr);
        const remaining = Math.max(0, Math.ceil((targetEnd - Date.now()) / 1000));
        if (remaining > 0) {
          this.cachedSnapshot = {
            remainingSeconds: remaining,
            totalDuration: total,
            isRunning: true,
            isPaused: false,
            targetEndTime: targetEnd,
          };
          this.startTicker();
        } else {
          if (this.tickerId) {
            clearInterval(this.tickerId);
            this.tickerId = null;
          }
          this.cachedSnapshot = { ...SERVER_SNAPSHOT };
          this.clearStorage();
        }
      } else {
        // Storage was cleared or timer stopped by another tab
        if (this.tickerId) {
          clearInterval(this.tickerId);
          this.tickerId = null;
        }
        this.cachedSnapshot = { ...SERVER_SNAPSHOT };
      }
    } catch {
      // ignore
    }
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    });
  }

  private startTicker(): void {
    if (this.tickerId) clearInterval(this.tickerId);
    this.tickerId = setInterval(() => this.tick(), 250);
  }

  private tick(): void {
    if (!this.cachedSnapshot.isRunning || !this.cachedSnapshot.targetEndTime) return;
    const remaining = Math.max(0, Math.ceil((this.cachedSnapshot.targetEndTime - Date.now()) / 1000));

    if (remaining === this.cachedSnapshot.remainingSeconds) {
      return; // Referentially stable: do NOT allocate or notify
    }

    if (remaining <= 0) {
      this.triggerCompletion();
      this.stop();
    } else {
      this.cachedSnapshot = {
        ...this.cachedSnapshot,
        remainingSeconds: remaining,
      };
      this.emitChange();
    }
  }

  private triggerCompletion(): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200]);
      } catch {
        // ignore
      }
    }
    playTimerCompletionChime();
  }

  private clearStorage(): void {
    if (!this.isStorageAvailable()) return;
    localStorage.removeItem(KEY_END);
    localStorage.removeItem(KEY_REMAINING);
    localStorage.removeItem(KEY_TOTAL);
    localStorage.removeItem(KEY_PAUSED);
  }

  private handleStorageEvent = (e: StorageEvent): void => {
    if (
      !e.key ||
      e.key === KEY_END ||
      e.key === KEY_PAUSED ||
      e.key === KEY_REMAINING ||
      e.key === KEY_TOTAL
    ) {
      this.hydrateFromStorage();
      this.emitChange();
    }
  };

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.tick();
    }
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RestTimerSnapshot => {
    return this.cachedSnapshot;
  };

  getServerSnapshot = (): RestTimerSnapshot => {
    return SERVER_SNAPSHOT;
  };

  start(seconds: number): void {
    const targetEnd = Date.now() + seconds * 1000;
    this.cachedSnapshot = {
      remainingSeconds: seconds,
      totalDuration: seconds,
      isRunning: true,
      isPaused: false,
      targetEndTime: targetEnd,
    };

    if (this.isStorageAvailable()) {
      localStorage.setItem(KEY_END, String(targetEnd));
      localStorage.setItem(KEY_TOTAL, String(seconds));
      localStorage.setItem(KEY_PAUSED, '0');
      localStorage.removeItem(KEY_REMAINING);
    }

    this.startTicker();
    this.emitChange();
  }

  pause(): void {
    if (!this.cachedSnapshot.isRunning) return;
    if (this.tickerId) clearInterval(this.tickerId);

    const remaining = this.cachedSnapshot.targetEndTime
      ? Math.max(0, Math.ceil((this.cachedSnapshot.targetEndTime - Date.now()) / 1000))
      : this.cachedSnapshot.remainingSeconds;

    this.cachedSnapshot = {
      ...this.cachedSnapshot,
      remainingSeconds: remaining,
      isRunning: false,
      isPaused: true,
      targetEndTime: null,
    };

    if (this.isStorageAvailable()) {
      localStorage.setItem(KEY_REMAINING, String(remaining));
      localStorage.setItem(KEY_PAUSED, '1');
      localStorage.removeItem(KEY_END);
    }

    this.emitChange();
  }

  resume(): void {
    if (!this.cachedSnapshot.isPaused || this.cachedSnapshot.remainingSeconds <= 0) return;
    const targetEnd = Date.now() + this.cachedSnapshot.remainingSeconds * 1000;

    this.cachedSnapshot = {
      ...this.cachedSnapshot,
      isRunning: true,
      isPaused: false,
      targetEndTime: targetEnd,
    };

    if (this.isStorageAvailable()) {
      localStorage.setItem(KEY_END, String(targetEnd));
      localStorage.setItem(KEY_PAUSED, '0');
      localStorage.removeItem(KEY_REMAINING);
    }

    this.startTicker();
    this.emitChange();
  }

  addSeconds(additionalSeconds: number): void {
    const base = this.cachedSnapshot.targetEndTime
      ? Math.max(0, Math.ceil((this.cachedSnapshot.targetEndTime - Date.now()) / 1000))
      : this.cachedSnapshot.remainingSeconds;
    const newTotal = base + additionalSeconds;

    if (this.cachedSnapshot.isRunning) {
      const newTarget = Date.now() + newTotal * 1000;
      this.cachedSnapshot = {
        ...this.cachedSnapshot,
        remainingSeconds: newTotal,
        totalDuration: this.cachedSnapshot.totalDuration + additionalSeconds,
        targetEndTime: newTarget,
      };
      if (this.isStorageAvailable()) {
        localStorage.setItem(KEY_END, String(newTarget));
        localStorage.setItem(KEY_TOTAL, String(this.cachedSnapshot.totalDuration));
      }
    } else {
      const isPaused = this.cachedSnapshot.isPaused || !this.cachedSnapshot.isRunning;
      this.cachedSnapshot = {
        ...this.cachedSnapshot,
        remainingSeconds: newTotal,
        totalDuration: this.cachedSnapshot.totalDuration + additionalSeconds,
        isPaused,
      };
      if (this.isStorageAvailable()) {
        localStorage.setItem(KEY_REMAINING, String(newTotal));
        localStorage.setItem(KEY_TOTAL, String(this.cachedSnapshot.totalDuration));
        localStorage.setItem(KEY_PAUSED, isPaused ? '1' : '0');
      }
    }
    this.emitChange();
  }

  stop(): void {
    if (this.tickerId) clearInterval(this.tickerId);
    this.tickerId = null;
    this.cachedSnapshot = { ...SERVER_SNAPSHOT };
    this.clearStorage();
    this.emitChange();
  }

  toggleHeaderTimer(): void {
    if (this.cachedSnapshot.isRunning) {
      this.pause();
    } else if (this.cachedSnapshot.isPaused) {
      this.resume();
    } else {
      this.start(90);
    }
  }

  resetForTesting(): void {
    if (this.tickerId) clearInterval(this.tickerId);
    this.tickerId = null;
    this.cachedSnapshot = { ...SERVER_SNAPSHOT };
    this.listeners.clear();
    this.clearStorage();
  }
}

export const restTimerStore = new RestTimerStore();
