import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  isSWRegistrationEligible,
  registerAppServiceWorker,
  registerSW,
  setupPeriodicUpdates,
  teardownPeriodicUpdates,
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
const mockAddEventListener = vi.fn();
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
});
