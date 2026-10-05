import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { restTimerStore, SERVER_SNAPSHOT } from './restTimerStore';
import * as soundModule from './sound';

describe('restTimerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    restTimerStore.resetForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. returns stable cachedSnapshot reference across consecutive reads when time has not changed (React 19 invariant)', () => {
    restTimerStore.start(90);
    const snap1 = restTimerStore.getSnapshot();
    const snap2 = restTimerStore.getSnapshot();

    expect(Object.is(snap1, snap2)).toBe(true);
  });

  it('2. getServerSnapshot() returns immutable zero-state server snapshot', () => {
    const serverSnap = restTimerStore.getServerSnapshot();
    expect(serverSnap).toEqual(SERVER_SNAPSHOT);
    expect(serverSnap.isRunning).toBe(false);
    expect(serverSnap.remainingSeconds).toBe(0);
    expect(Object.isFrozen(serverSnap)).toBe(true);
  });

  it('3. starts timer with 90 seconds and sets target timestamp', () => {
    restTimerStore.start(90);
    const snap = restTimerStore.getSnapshot();

    expect(snap.isRunning).toBe(true);
    expect(snap.isPaused).toBe(false);
    expect(snap.remainingSeconds).toBe(90);
    expect(snap.totalDuration).toBe(90);
    expect(snap.targetEndTime).toBe(Date.now() + 90000);

    expect(localStorage.getItem('yourbody_rest_timer_end')).toBe(String(snap.targetEndTime));
    expect(localStorage.getItem('yourbody_rest_timer_total')).toBe('90');
    expect(localStorage.getItem('yourbody_rest_timer_paused')).toBe('0');
  });

  it('4. pauses timer without losing remaining time', () => {
    restTimerStore.start(90);
    // Advance 10s
    vi.advanceTimersByTime(10000);
    expect(restTimerStore.getSnapshot().remainingSeconds).toBe(80);

    restTimerStore.pause();
    const pausedSnap = restTimerStore.getSnapshot();

    expect(pausedSnap.isRunning).toBe(false);
    expect(pausedSnap.isPaused).toBe(true);
    expect(pausedSnap.remainingSeconds).toBe(80);
    expect(pausedSnap.targetEndTime).toBeNull();

    expect(localStorage.getItem('yourbody_rest_timer_remaining')).toBe('80');
    expect(localStorage.getItem('yourbody_rest_timer_paused')).toBe('1');
    expect(localStorage.getItem('yourbody_rest_timer_end')).toBeNull();
  });

  it('5. resumes timer recalculating future target timestamp', () => {
    restTimerStore.start(90);
    vi.advanceTimersByTime(10000);
    restTimerStore.pause();

    // Advance real clock while paused (should not decrease remainingSeconds)
    vi.advanceTimersByTime(5000);
    expect(restTimerStore.getSnapshot().remainingSeconds).toBe(80);

    restTimerStore.resume();
    const resumedSnap = restTimerStore.getSnapshot();

    expect(resumedSnap.isRunning).toBe(true);
    expect(resumedSnap.isPaused).toBe(false);
    expect(resumedSnap.remainingSeconds).toBe(80);
    expect(resumedSnap.targetEndTime).toBe(Date.now() + 80000);

    expect(localStorage.getItem('yourbody_rest_timer_end')).toBe(String(Date.now() + 80000));
    expect(localStorage.getItem('yourbody_rest_timer_paused')).toBe('0');
  });

  it('6. adds 90 seconds to running and paused timers', () => {
    // Running timer:
    restTimerStore.start(60);
    restTimerStore.addSeconds(90);
    let snap = restTimerStore.getSnapshot();
    expect(snap.remainingSeconds).toBe(150);
    expect(snap.totalDuration).toBe(150);

    // Paused timer:
    restTimerStore.pause();
    restTimerStore.addSeconds(90);
    snap = restTimerStore.getSnapshot();
    expect(snap.remainingSeconds).toBe(240);
    expect(snap.totalDuration).toBe(240);
    expect(snap.isPaused).toBe(true);
  });

  it('7. stops timer and purges localStorage', () => {
    restTimerStore.start(90);
    expect(localStorage.getItem('yourbody_rest_timer_end')).toBeTruthy();

    restTimerStore.stop();
    const snap = restTimerStore.getSnapshot();

    expect(snap.isRunning).toBe(false);
    expect(snap.remainingSeconds).toBe(0);
    expect(localStorage.getItem('yourbody_rest_timer_end')).toBeNull();
    expect(localStorage.getItem('yourbody_rest_timer_remaining')).toBeNull();
    expect(localStorage.getItem('yourbody_rest_timer_total')).toBeNull();
    expect(localStorage.getItem('yourbody_rest_timer_paused')).toBeNull();
  });

  it('8. toggleHeaderTimer() transitions running -> pause, paused -> resume, idle -> start(90)', () => {
    // Idle -> start(90)
    restTimerStore.toggleHeaderTimer();
    expect(restTimerStore.getSnapshot().isRunning).toBe(true);
    expect(restTimerStore.getSnapshot().remainingSeconds).toBe(90);

    // Running -> pause
    restTimerStore.toggleHeaderTimer();
    expect(restTimerStore.getSnapshot().isPaused).toBe(true);

    // Paused -> resume
    restTimerStore.toggleHeaderTimer();
    expect(restTimerStore.getSnapshot().isRunning).toBe(true);
  });

  it('9. triggers listeners via useSyncExternalStore subscribe', () => {
    const listener = vi.fn();
    const unsubscribe = restTimerStore.subscribe(listener);

    restTimerStore.start(90);
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('10. synchronizes state across tabs on storage event (start, pause, stop, and storage clear)', () => {
    const listener = vi.fn();
    restTimerStore.subscribe(listener);

    // 10a. Simulate another tab starting the timer
    const futureEnd = Date.now() + 45000;
    localStorage.setItem('yourbody_rest_timer_end', String(futureEnd));
    localStorage.setItem('yourbody_rest_timer_total', '90');
    localStorage.setItem('yourbody_rest_timer_paused', '0');

    window.dispatchEvent(new StorageEvent('storage', { key: 'yourbody_rest_timer_end' }));

    let snap = restTimerStore.getSnapshot();
    expect(snap.isRunning).toBe(true);
    expect(snap.remainingSeconds).toBe(45);
    expect(listener).toHaveBeenCalled();

    // 10b. Simulate another tab pausing the timer
    listener.mockClear();
    localStorage.setItem('yourbody_rest_timer_paused', '1');
    localStorage.setItem('yourbody_rest_timer_remaining', '40');
    localStorage.removeItem('yourbody_rest_timer_end');

    window.dispatchEvent(new StorageEvent('storage', { key: 'yourbody_rest_timer_paused' }));

    snap = restTimerStore.getSnapshot();
    expect(snap.isRunning).toBe(false);
    expect(snap.isPaused).toBe(true);
    expect(snap.remainingSeconds).toBe(40);
    expect(listener).toHaveBeenCalled();

    // 10c. Simulate another tab stopping the timer
    listener.mockClear();
    localStorage.removeItem('yourbody_rest_timer_paused');
    localStorage.removeItem('yourbody_rest_timer_remaining');
    localStorage.removeItem('yourbody_rest_timer_total');
    localStorage.removeItem('yourbody_rest_timer_end');

    window.dispatchEvent(new StorageEvent('storage', { key: 'yourbody_rest_timer_end' }));

    snap = restTimerStore.getSnapshot();
    expect(snap.isRunning).toBe(false);
    expect(snap.isPaused).toBe(false);
    expect(snap.remainingSeconds).toBe(0);
    expect(listener).toHaveBeenCalled();

    // 10d. Storage clear event (key is null)
    listener.mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    snap = restTimerStore.getSnapshot();
    expect(snap.isRunning).toBe(false);
    expect(snap.remainingSeconds).toBe(0);
  });

  it('11. triggers navigator.vibrate and chime when countdown reaches 0', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      configurable: true,
      writable: true,
    });

    const chimeSpy = vi.spyOn(soundModule, 'playTimerCompletionChime');

    restTimerStore.start(2);
    vi.advanceTimersByTime(2500);

    expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200]);
    expect(chimeSpy).toHaveBeenCalled();
    expect(restTimerStore.getSnapshot().isRunning).toBe(false);
  });

  it('12. handles background throttling without clock drift', () => {
    restTimerStore.start(60);

    // Simulate system going to sleep or timer being throttled for 30 seconds
    vi.advanceTimersByTime(30000);

    // Visibility change or single tick aligns remaining time directly to epoch delta
    const snap = restTimerStore.getSnapshot();
    expect(snap.remainingSeconds).toBe(30);
  });
});
