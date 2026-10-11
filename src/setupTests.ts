import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, vi } from 'vitest';
import { workoutSessionStore } from './utils/workoutSessionStore';
import { restTimerStore } from './utils/restTimerStore';
import { resetAudioContextForTesting } from './utils/sound';
import { stopPersisting } from './offline/persistController';
import { closeAllOfflineDbs } from './offline/db';
import { resetOutboxForTesting } from './offline/outbox';
import { resetFlusherForTesting } from './offline/flusher';

const originalMatchMedia = typeof window !== 'undefined' ? window.matchMedia : undefined;
const originalScrollIntoView = typeof Element !== 'undefined' ? Element.prototype.scrollIntoView : undefined;

beforeEach(() => {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.clear();
  }
  stopPersisting();
  closeAllOfflineDbs();
  if (typeof indexedDB !== 'undefined') {
    const idb = indexedDB as any;
    if (idb._databases) idb._databases.clear();
  }
  resetOutboxForTesting();
  resetFlusherForTesting();
  workoutSessionStore.resetForTesting();
  restTimerStore.resetForTesting();
  resetAudioContextForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  if (typeof window !== 'undefined') {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      delete (window as any).matchMedia;
    }
  }
  if (typeof Element !== 'undefined') {
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      delete (Element.prototype as any).scrollIntoView;
    }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  }
  stopPersisting();
  closeAllOfflineDbs();
  resetFlusherForTesting();
});

