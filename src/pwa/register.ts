import { Capacitor } from '@capacitor/core';
import { Workbox } from 'workbox-window';

export interface RegisterPWAOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

const UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

let periodicIntervalId: ReturnType<typeof setInterval> | null = null;
let visibilityListener: (() => void) | null = null;

/**
 * Returns true if the environment meets all requirements for service worker registration:
 * - Production build (import.meta.env.PROD)
 * - Not a native Capacitor platform (!Capacitor.isNativePlatform())
 * - Service workers supported by browser ('serviceWorker' in navigator)
 */
export function isSWRegistrationEligible(): boolean {
  if (!import.meta.env.PROD) {
    return false;
  }
  if (Capacitor.isNativePlatform()) {
    return false;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  return true;
}

/**
 * Sets up periodic update checks:
 * 1. Every 60 minutes via setInterval
 * 2. On document visibility returning to 'visible'
 */
export function setupPeriodicUpdates(registration: ServiceWorkerRegistration): () => void {
  teardownPeriodicUpdates();

  periodicIntervalId = setInterval(() => {
    registration.update().catch(() => {});
  }, UPDATE_INTERVAL_MS);

  visibilityListener = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      registration.update().catch(() => {});
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', visibilityListener);
  }

  return teardownPeriodicUpdates;
}

export function teardownPeriodicUpdates(): void {
  if (periodicIntervalId !== null) {
    clearInterval(periodicIntervalId);
    periodicIntervalId = null;
  }
  if (visibilityListener !== null && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
}

/**
 * Standard registerSW implementation via workbox-window matching virtual:pwa-register.
 */
export function registerSW(
  options: RegisterPWAOptions = {}
): (reloadPage?: boolean) => Promise<void> {
  const {
    immediate = true,
    onNeedRefresh,
    onOfflineReady,
    onRegistered,
    onRegisteredSW,
    onRegisterError,
  } = options;

  let wb: Workbox | undefined;
  let registerPromise: Promise<void> | undefined;

  const updateServiceWorker = async (_reloadPage = true) => {
    await registerPromise;
    wb?.messageSkipWaiting();
  };

  if (!isSWRegistrationEligible()) {
    return updateServiceWorker;
  }

  async function register() {
    try {
      wb = new Workbox('/sw.js', { scope: '/' });

      const showSkipWaitingPrompt = () => {
        wb?.addEventListener('controlling', (event) => {
          if (event.isUpdate && typeof window !== 'undefined') {
            window.location.reload();
          }
        });
        onNeedRefresh?.();
      };

      wb.addEventListener('installed', (event) => {
        if (!event.isUpdate) {
          onOfflineReady?.();
        }
      });

      wb.addEventListener('waiting', showSkipWaitingPrompt);

      const registration = await wb.register({ immediate });
      if (registration) {
        setupPeriodicUpdates(registration);
      }
      onRegistered?.(registration);
      onRegisteredSW?.('/sw.js', registration);
    } catch (err) {
      onRegisterError?.(err);
    }
  }

  registerPromise = register();
  return updateServiceWorker;
}

/**
 * Registers the PWA service worker if eligible.
 * Never auto-reloads; delegates refresh notification to options.onNeedRefresh.
 */
export function registerAppServiceWorker(
  options?: RegisterPWAOptions
): ((reloadPage?: boolean) => Promise<void>) | undefined {
  if (!isSWRegistrationEligible()) {
    return undefined;
  }
  return registerSW(options);
}
