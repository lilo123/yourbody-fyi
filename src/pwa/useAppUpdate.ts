import { useState, useEffect, useCallback } from 'react';
import { registerAppServiceWorker } from './register';

let updateAvailableState = false;
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | undefined;
let isRegistered = false;
const listeners = new Set<(available: boolean) => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener(updateAvailableState);
  }
}

/**
 * Initializes the PWA registration once per app session.
 * Listens for onNeedRefresh to mark updateAvailable = true.
 * Never auto-reloads.
 */
export function initAppUpdate(): void {
  if (isRegistered) return;
  isRegistered = true;

  if (!updateSWFn) {
    updateSWFn = registerAppServiceWorker({
      immediate: true,
      onNeedRefresh() {
        updateAvailableState = true;
        notifyListeners();
      },
    });
  }
}

/**
 * Hook exposing { updateAvailable, applyUpdate }.
 * When an update is detected in background, updateAvailable becomes true.
 * applyUpdate() requests the waiting worker to skipWaiting and reloads.
 */
export function useAppUpdate(): {
  updateAvailable: boolean;
  applyUpdate: () => Promise<void>;
} {
  const [updateAvailable, setUpdateAvailable] = useState(updateAvailableState);

  useEffect(() => {
    initAppUpdate();

    const listener = (val: boolean) => {
      setUpdateAvailable(val);
    };

    listeners.add(listener);
    setUpdateAvailable(updateAvailableState);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (updateSWFn) {
      await updateSWFn(true);
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  return { updateAvailable, applyUpdate };
}

/**
 * Test helpers to simulate update detection in unit tests.
 */
export function setUpdateAvailableForTesting(available: boolean): void {
  updateAvailableState = available;
  notifyListeners();
}

export function setUpdateSWFnForTesting(
  fn: ((reloadPage?: boolean) => Promise<void>) | undefined
): void {
  updateSWFn = fn;
}

export function resetAppUpdateForTesting(): void {
  updateAvailableState = false;
  updateSWFn = undefined;
  isRegistered = false;
  listeners.clear();
}
