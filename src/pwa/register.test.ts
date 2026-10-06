import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  isSWRegistrationEligible,
  registerAppServiceWorker,
  registerSW,
  setupPeriodicUpdates,
  teardownPeriodicUpdates,
  UPDATE_RELOAD_FALLBACK_MS,
} from './register';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
  },
}));

const mockMessageSkipWaiting = vi.fn();
const mockRegister = vi.fn().mockResolvedValue({
  update: vi.fn().mockResolvedValue(undefined),
});
const workboxEventHandlers = new Map<string, Function[]>();
const mockAddEventListener = vi.fn((event: string, cb: Function) => {
  const existing = workboxEventHandlers.get(event) || [];
  existing.push(cb);
  workboxEventHandlers.set(event, existing);
});
function triggerWorkboxEvent(event: string, payload?: any) {
  const handlers = workboxEventHandlers.get(event) || [];
  for (const handler of handlers) {
    handler(payload);
  }
}
const mockWorkboxConstructor = vi.fn();

vi.mock('workbox-window', () => {
  class Workbox {
    register = mockRegister;
    addEventListener = mockAddEventListener;
    messageSkipWaiting = mockMessageSkipWaiting;
    constructor(url: string, options?: any) {
      mockWorkboxConstructor(url, options);
    }
  }
  return { Workbox };
});

describe('PWA Service Worker Registration Gating', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.clearAllMocks();
    workboxEventHandlers.clear();
    teardownPeriodicUpdates();
  });

  afterEach(() => {
    teardownPeriodicUpdates();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('does not register in development mode (import.meta.env.PROD is false)', () => {
    expect(import.meta.env.PROD).toBe(false);
    expect(isSWRegistrationEligible()).toBe(false);

    const updateFn = registerAppServiceWorker();
    expect(updateFn).toBeUndefined();
    expect(mockWorkboxConstructor).not.toHaveBeenCalled();
  });

  it('does not register when running on native Capacitor platform', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    const originalProd = import.meta.env.PROD;
    try {
      (import.meta.env as any).PROD = true;
      expect(isSWRegistrationEligible()).toBe(false);

      const updateFn = registerAppServiceWorker();
      expect(updateFn).toBeUndefined();
      expect(mockWorkboxConstructor).not.toHaveBeenCalled();
    } finally {
      (import.meta.env as any).PROD = originalProd;
    }
  });

  it('does not register if navigator.serviceWorker is absent', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

    const originalProd = import.meta.env.PROD;
    try {
      (import.meta.env as any).PROD = true;
      expect(isSWRegistrationEligible()).toBe(false);
    } finally {
      (import.meta.env as any).PROD = originalProd;
    }
  });

  it('registers with Workbox when PROD, web, and serviceWorker are present', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker: {} },
      configurable: true,
      writable: true,
    });
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

    const originalProd = import.meta.env.PROD;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      (import.meta.env as any).PROD = true;
      expect(isSWRegistrationEligible()).toBe(true);

      const onNeedRefresh = vi.fn();
      const updateFn = registerSW({ onNeedRefresh });

      expect(typeof updateFn).toBe('function');
      expect(mockWorkboxConstructor).toHaveBeenCalledWith('/sw.js', { scope: '/' });

      // Simulate calling updateFn
      await updateFn(true);
      expect(mockMessageSkipWaiting).toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      (import.meta.env as any).PROD = originalProd;
    }
  });

  it('sets up periodic registration.update every 60 min and on visibilitychange', () => {
    vi.useFakeTimers();

    const mockRegistration = {
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ServiceWorkerRegistration;

    setupPeriodicUpdates(mockRegistration);

    // Initial state: not called yet
    expect(mockRegistration.update).not.toHaveBeenCalled();

    // Advance 60 minutes
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);

    // Simulate visibility returning to visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);

    // When hidden, visibilitychange does not trigger update
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(mockRegistration.update).toHaveBeenCalledTimes(2);

    teardownPeriodicUpdates();
    vi.useRealTimers();
  });

  describe('Deterministic Update Reload Mechanism (A.4, A.5)', () => {
    let reloadSpy: ReturnType<typeof vi.fn>;
    const originalLocation = window.location;

    beforeEach(() => {
      reloadSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...originalLocation, reload: reloadSpy },
        configurable: true,
        writable: true,
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: {
          serviceWorker: {
            controller: { scriptURL: 'http://localhost/sw.js' },
            addEventListener: vi.fn(),
          },
        },
        configurable: true,
        writable: true,
      });
      vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
      (import.meta.env as any).PROD = true;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        configurable: true,
        writable: true,
      });
      (import.meta.env as any).PROD = false;
    });

    it('reload once on controlling after user request', async () => {
      const updateFn = registerSW();
      await updateFn(true);

      expect(reloadSpy).not.toHaveBeenCalled();
      triggerWorkboxEvent('controlling');
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Subsequent controlling events must not trigger another reload
      triggerWorkboxEvent('controlling');
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('no reload on controlling without a request', async () => {
      registerSW();

      triggerWorkboxEvent('controlling');
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('uncontrolled page reloads on activated not on activating', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          serviceWorker: {
            controller: null,
            addEventListener: vi.fn(),
          },
        },
        configurable: true,
        writable: true,
      });

      let triggerStateChange: () => void = () => {};
      const mockWaiting: any = {
        state: 'installed',
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (event === 'statechange') {
            triggerStateChange = cb;
          }
        }),
      };

      mockRegister.mockResolvedValueOnce({
        waiting: mockWaiting,
        update: vi.fn(),
      });

      const updateFn = registerSW();
      await updateFn(true);

      expect(mockWaiting.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));

      // Transition to activating: must NOT reload
      mockWaiting.state = 'activating';
      triggerStateChange();
      expect(reloadSpy).not.toHaveBeenCalled();

      // Transition to activated: MUST reload once
      mockWaiting.state = 'activated';
      triggerStateChange();
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Further state changes do not stack reloads
      triggerStateChange();
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('repeated waiting events do not stack reloads', async () => {
      const onNeedRefresh = vi.fn();
      const updateFn = registerSW({ onNeedRefresh });

      // Trigger multiple waiting events
      triggerWorkboxEvent('waiting');
      triggerWorkboxEvent('waiting');
      triggerWorkboxEvent('waiting');
      expect(onNeedRefresh).toHaveBeenCalledTimes(3);

      await updateFn(true);

      // Trigger controlling event multiple times
      triggerWorkboxEvent('controlling');
      triggerWorkboxEvent('controlling');
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('confirmed reload still happens after the fallback delay when activation is deferred', async () => {
      const updateFn = registerSW();
      await updateFn(true);

      // No 'controlling' event: the waiting worker never activates.
      vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS - 1);
      expect(reloadSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('fallback does not add a second reload after controlling already reloaded', async () => {
      const updateFn = registerSW();
      await updateFn(true);

      triggerWorkboxEvent('controlling');
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('updateServiceWorker(false) schedules no reload', async () => {
      const updateFn = registerSW();
      await updateFn(false);

      vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS * 2);
      triggerWorkboxEvent('controlling');
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });
});
