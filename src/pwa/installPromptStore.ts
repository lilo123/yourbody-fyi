import { useEffect, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export interface BeforeInstallPromptChoice {
  outcome: 'accepted' | 'dismissed';
  platform: string;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
  prompt(): Promise<void>;
}

export interface InstallPromptState {
  shouldShowPrompt: boolean;
  canPrompt: boolean;
  isIOSSafari: boolean;
  isStandalone: boolean;
  hasLoggedFirstActivity: boolean;
  isDismissed: boolean;
  isInstalled: boolean;
}

export const INSTALL_DISMISSED_AT_KEY = 'yourbody_install_prompt_dismissed_at';
export const INSTALL_DISMISS_COUNT_KEY = 'yourbody_install_prompt_dismiss_count';
export const FIRST_LOG_KEY = 'yourbody_install_prompt_first_log';
export const INSTALLED_KEY = 'yourbody_install_prompt_installed';

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let isInstalledState = false;
let isListenerAttached = false;
const listeners = new Set<() => void>();

// Test overrides
let platformOverride: { isIOS: boolean; isIOSSafari: boolean; isOtherIOSBrowser: boolean } | null = null;
let standaloneOverride: boolean | null = null;
let timeOverride: number | null = null;

export function isStandalone(): boolean {
  if (standaloneOverride !== null) {
    return standaloneOverride;
  }
  if (typeof window === 'undefined') return false;
  const isMatchMedia =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const isNavStandalone = Boolean(
    (window.navigator as unknown as { standalone?: boolean })?.standalone
  );
  return isMatchMedia || isNavStandalone;
}

export function getPlatformInfo(
  userAgent?: string,
  platform?: string,
  maxTouchPoints?: number
): { isIOS: boolean; isIOSSafari: boolean; isOtherIOSBrowser: boolean } {
  if (platformOverride !== null) {
    return platformOverride;
  }
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const plat = platform ?? (typeof navigator !== 'undefined' ? navigator.platform : '');
  const touchPoints =
    maxTouchPoints ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0);

  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || (plat === 'MacIntel' && touchPoints > 1);
  if (!isIOSDevice) {
    return { isIOS: false, isIOSSafari: false, isOtherIOSBrowser: false };
  }

  // Detect non-Safari iOS browsers:
  // CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, OPiOS/OPT = Opera, DuckDuckGo = DDG
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo/i.test(ua);
  const isIOSSafari = !isOtherIOSBrowser;

  return { isIOS: true, isIOSSafari, isOtherIOSBrowser };
}

export function getDismissCount(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_COUNT_KEY);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function getDismissedAt(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(INSTALL_DISMISSED_AT_KEY);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function isDismissed(now?: number): boolean {
  const currentTime = now ?? timeOverride ?? Date.now();
  const count = getDismissCount();
  if (count >= 2) {
    return true;
  }
  if (count > 0) {
    const dismissedAt = getDismissedAt();
    if (dismissedAt !== null && currentTime - dismissedAt < THIRTY_DAYS_MS) {
      return true;
    }
  }
  return false;
}

export function recordDismissal(now?: number): void {
  if (typeof localStorage !== 'undefined') {
    try {
      const currentCount = getDismissCount();
      const nextCount = currentCount + 1;
      const dismissalTime = now ?? timeOverride ?? Date.now();
      localStorage.setItem(INSTALL_DISMISS_COUNT_KEY, String(nextCount));
      localStorage.setItem(INSTALL_DISMISSED_AT_KEY, String(dismissalTime));
    } catch {
      // Ignore localStorage errors
    }
  }
  updateState();
}

export function hasLoggedFirstActivity(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FIRST_LOG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markFirstLogCompleted(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FIRST_LOG_KEY, 'true');
    } catch {
      // Ignore localStorage errors
    }
  }
  updateState();
}

export function markInstalled(): void {
  isInstalledState = true;
  deferredPrompt = null;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(INSTALLED_KEY, 'true');
    } catch {
      // Ignore localStorage errors
    }
  }
  updateState();
}

export async function promptToInstall(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferredPrompt) {
    return null;
  }
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      markInstalled();
    }
    return choice?.outcome ?? null;
  } catch {
    return null;
  }
}

export function syncFirstLogFromQueryClient(queryClient: QueryClient): void {
  if (hasLoggedFirstActivity()) return;
  const workoutQueries = queryClient.getQueriesData<{ length?: number }>({
    queryKey: ['workout_sets'],
  });
  for (const [, data] of workoutQueries) {
    if (Array.isArray(data) && data.length > 0) {
      markFirstLogCompleted();
      return;
    }
  }
  const nutritionQueries = queryClient.getQueriesData<{ length?: number }>({
    queryKey: ['nutrition_logs'],
  });
  for (const [, data] of nutritionQueries) {
    if (Array.isArray(data) && data.length > 0) {
      markFirstLogCompleted();
      return;
    }
  }
}

function computeSnapshot(): InstallPromptState {
  const standalone = isStandalone();
  const installed =
    isInstalledState ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(INSTALLED_KEY) === 'true');
  const dismissed = isDismissed();
  const logged = hasLoggedFirstActivity();

  const plat = getPlatformInfo();
  // On iOS: only iOS Safari can prompt/show instructions; CriOS/FxiOS cannot
  // On non-iOS: requires captured beforeinstallprompt event
  const canPrompt = plat.isIOS ? plat.isIOSSafari : Boolean(deferredPrompt);

  const shouldShowPrompt = !standalone && !installed && !dismissed && logged && canPrompt;

  return {
    shouldShowPrompt,
    canPrompt,
    isIOSSafari: plat.isIOSSafari,
    isStandalone: standalone,
    hasLoggedFirstActivity: logged,
    isDismissed: dismissed,
    isInstalled: installed,
  };
}

let currentSnapshot: InstallPromptState = computeSnapshot();

function updateState(force = false) {
  const nextSnapshot = computeSnapshot();
  if (
    force ||
    currentSnapshot.shouldShowPrompt !== nextSnapshot.shouldShowPrompt ||
    currentSnapshot.canPrompt !== nextSnapshot.canPrompt ||
    currentSnapshot.isIOSSafari !== nextSnapshot.isIOSSafari ||
    currentSnapshot.isStandalone !== nextSnapshot.isStandalone ||
    currentSnapshot.hasLoggedFirstActivity !== nextSnapshot.hasLoggedFirstActivity ||
    currentSnapshot.isDismissed !== nextSnapshot.isDismissed ||
    currentSnapshot.isInstalled !== nextSnapshot.isInstalled
  ) {
    currentSnapshot = nextSnapshot;
    for (const listener of listeners) {
      listener();
    }
  }
}

export function updateInstallPromptState(force = false): void {
  updateState(force);
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallPromptSnapshot(): InstallPromptState {
  return currentSnapshot;
}

export function getServerInstallPromptSnapshot(): InstallPromptState {
  return {
    shouldShowPrompt: false,
    canPrompt: false,
    isIOSSafari: false,
    isStandalone: false,
    hasLoggedFirstActivity: false,
    isDismissed: false,
    isInstalled: false,
  };
}

export function initInstallPromptListener(): () => void {
  if (typeof window === 'undefined' || isListenerAttached) {
    return () => {};
  }
  isListenerAttached = true;

  const handleBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    updateState();
  };

  const handleAppInstalled = () => {
    markInstalled();
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);

  updateState();

  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', handleAppInstalled);
    isListenerAttached = false;
  };
}

// Attach listener immediately upon module load if in browser
if (typeof window !== 'undefined') {
  initInstallPromptListener();
}

export function useInstallPrompt(): InstallPromptState & {
  promptToInstall: () => Promise<'accepted' | 'dismissed' | null>;
  dismissPrompt: () => void;
} {
  const state = useSyncExternalStore(
    subscribeInstallPrompt,
    getInstallPromptSnapshot,
    getServerInstallPromptSnapshot
  );

  return {
    ...state,
    promptToInstall,
    dismissPrompt: recordDismissal,
  };
}

export function useFirstLogSync(queryClient: QueryClient): void {
  useEffect(() => {
    if (hasLoggedFirstActivity()) return;

    syncFirstLogFromQueryClient(queryClient);

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === 'updated' && event.query.state.status === 'success') {
        const key = event.query.queryKey;
        if (key && (key[0] === 'workout_sets' || key[0] === 'nutrition_logs')) {
          const data = event.query.state.data;
          if (Array.isArray(data) && data.length > 0) {
            markFirstLogCompleted();
          }
        }
      }
    });

    return unsubscribe;
  }, [queryClient]);
}

// Test helpers
export function resetInstallPromptStoreForTesting(): void {
  deferredPrompt = null;
  isInstalledState = false;
  platformOverride = null;
  standaloneOverride = null;
  timeOverride = null;
  updateState(true);
}

export function setDeferredPromptForTesting(prompt: BeforeInstallPromptEvent | null): void {
  deferredPrompt = prompt;
  updateState();
}

export function setPlatformOverrideForTesting(
  override: { isIOS: boolean; isIOSSafari: boolean; isOtherIOSBrowser: boolean } | null
): void {
  platformOverride = override;
  updateState();
}

export function setStandaloneOverrideForTesting(override: boolean | null): void {
  standaloneOverride = override;
  updateState();
}

export function setTimeOverrideForTesting(now: number | null): void {
  timeOverride = now;
  updateState();
}
