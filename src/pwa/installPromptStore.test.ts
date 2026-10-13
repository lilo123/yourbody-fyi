import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  isStandalone,
  getPlatformInfo,
  isDismissed,
  recordDismissal,
  hasLoggedFirstActivity,
  markFirstLogCompleted,
  markInstalled,
  promptToInstall,
  syncFirstLogFromQueryClient,
  getInstallPromptSnapshot,
  updateInstallPromptState,
  resetInstallPromptStoreForTesting,
  setDeferredPromptForTesting,
  setPlatformOverrideForTesting,
  setStandaloneOverrideForTesting,
  setTimeOverrideForTesting,
  INSTALL_DISMISSED_AT_KEY,
  INSTALL_DISMISS_COUNT_KEY,
  FIRST_LOG_KEY,
  INSTALLED_KEY,
  THIRTY_DAYS_MS,
  type BeforeInstallPromptEvent,
} from './installPromptStore';

function createMockBeforeInstallPromptEvent(): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as any;
  event.platforms = ['web'];
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event as BeforeInstallPromptEvent;
}

describe('Deferred PWA Install Prompt Store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstallPromptStoreForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetInstallPromptStoreForTesting();
    localStorage.clear();
  });

  it('captures beforeinstallprompt event before mount and keeps it in store', async () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    const preventDefaultSpy = vi.spyOn(mockEvent, 'preventDefault');

    // Simulate early event dispatched on window before any component mounts
    window.dispatchEvent(mockEvent);

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.canPrompt).toBe(true);

    // Prompting invokes the captured event's prompt() method
    const outcome = await promptToInstall();
    expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
  });

  it('visibility rule: hidden before user has logged first workout set or meal', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    expect(hasLoggedFirstActivity()).toBe(false);
    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.hasLoggedFirstActivity).toBe(false);
    expect(snapshot.shouldShowPrompt).toBe(false);
  });

  it('visibility rule: shown after user has logged their first workout set or meal', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);

    markFirstLogCompleted();

    expect(hasLoggedFirstActivity()).toBe(true);
    expect(localStorage.getItem(FIRST_LOG_KEY)).toBe('true');

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.hasLoggedFirstActivity).toBe(true);
    expect(snapshot.shouldShowPrompt).toBe(true);
  });

  it('visibility rule: never shown when running in standalone mode (display-mode: standalone or navigator.standalone)', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    markFirstLogCompleted();

    // With standalone override
    setStandaloneOverrideForTesting(true);
    expect(isStandalone()).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    setStandaloneOverrideForTesting(false);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);

    // Verify window.matchMedia check
    setStandaloneOverrideForTesting(null);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    updateInstallPromptState();

    expect(isStandalone()).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    window.matchMedia = originalMatchMedia;
  });

  it('visibility rule: dismiss (X) hides it for 30 days', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    const t0 = 1000000000;
    setTimeOverrideForTesting(t0);

    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);

    // First dismissal
    recordDismissal(t0);

    expect(localStorage.getItem(INSTALL_DISMISS_COUNT_KEY)).toBe('1');
    expect(localStorage.getItem(INSTALL_DISMISSED_AT_KEY)).toBe(String(t0));
    expect(isDismissed(t0)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    // After 15 days: still hidden
    const t15Days = t0 + 15 * 24 * 60 * 60 * 1000;
    setTimeOverrideForTesting(t15Days);
    expect(isDismissed(t15Days)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    // After 29 days: still hidden
    const t29Days = t0 + 29 * 24 * 60 * 60 * 1000;
    setTimeOverrideForTesting(t29Days);
    expect(isDismissed(t29Days)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    // After 31 days (> 30 days): reappears
    const t31Days = t0 + THIRTY_DAYS_MS + 1000;
    setTimeOverrideForTesting(t31Days);
    expect(isDismissed(t31Days)).toBe(false);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);
  });

  it('visibility rule: after 2 dismissals never show again', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    const t0 = 1000000000;
    setTimeOverrideForTesting(t0);

    // First dismissal
    recordDismissal(t0);
    expect(localStorage.getItem(INSTALL_DISMISS_COUNT_KEY)).toBe('1');

    // 31 days later, user sees prompt again
    const t31Days = t0 + THIRTY_DAYS_MS + 1000;
    setTimeOverrideForTesting(t31Days);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);

    // Second dismissal
    recordDismissal(t31Days);
    expect(localStorage.getItem(INSTALL_DISMISS_COUNT_KEY)).toBe('2');
    expect(isDismissed(t31Days)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    // 60 days later: still hidden
    const t60Days = t31Days + THIRTY_DAYS_MS + 1000;
    setTimeOverrideForTesting(t60Days);
    expect(isDismissed(t60Days)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);

    // 365 days later: still hidden forever
    const t365Days = t31Days + 365 * 24 * 60 * 60 * 1000;
    setTimeOverrideForTesting(t365Days);
    expect(isDismissed(t365Days)).toBe(true);
    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(false);
  });

  it('visibility rule: iOS Safari platform shows instruction path without beforeinstallprompt event', () => {
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    // iOS Safari: iPhone user agent without CriOS/FxiOS
    setPlatformOverrideForTesting({
      isIOS: true,
      isIOSSafari: true,
      isOtherIOSBrowser: false,
    });

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.isIOSSafari).toBe(true);
    expect(snapshot.canPrompt).toBe(true);
    // Shows prompt on iOS Safari even with no beforeinstallprompt event
    expect(snapshot.shouldShowPrompt).toBe(true);
  });

  it('visibility rule: iOS third-party browsers (CriOS, FxiOS) do not show prompt', () => {
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    // Chrome on iOS (CriOS)
    setPlatformOverrideForTesting({
      isIOS: true,
      isIOSSafari: false,
      isOtherIOSBrowser: true,
    });

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.isIOSSafari).toBe(false);
    expect(snapshot.canPrompt).toBe(false);
    expect(snapshot.shouldShowPrompt).toBe(false);
  });

  it('getPlatformInfo accurately detects iOS Safari vs Chrome iOS vs Android', () => {
    const iphoneSafariUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const iphoneChromeUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/117.0.5938.108 Mobile/15E148 Safari/604.1';
    const androidChromeUA =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

    const safariInfo = getPlatformInfo(iphoneSafariUA, 'iPhone', 5);
    expect(safariInfo.isIOS).toBe(true);
    expect(safariInfo.isIOSSafari).toBe(true);
    expect(safariInfo.isOtherIOSBrowser).toBe(false);

    const chromeIOSInfo = getPlatformInfo(iphoneChromeUA, 'iPhone', 5);
    expect(chromeIOSInfo.isIOS).toBe(true);
    expect(chromeIOSInfo.isIOSSafari).toBe(false);
    expect(chromeIOSInfo.isOtherIOSBrowser).toBe(true);

    const androidInfo = getPlatformInfo(androidChromeUA, 'Linux armv8l', 5);
    expect(androidInfo.isIOS).toBe(false);
    expect(androidInfo.isIOSSafari).toBe(false);
    expect(androidInfo.isOtherIOSBrowser).toBe(false);
  });

  it('visibility rule: accepting the install prompt hides the card immediately and permanently', async () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);

    const outcome = await promptToInstall();
    expect(outcome).toBe('accepted');

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.isInstalled).toBe(true);
    expect(snapshot.shouldShowPrompt).toBe(false);
    expect(localStorage.getItem(INSTALLED_KEY)).toBe('true');
  });

  it('visibility rule: browser firing appinstalled hides the card immediately', () => {
    const mockEvent = createMockBeforeInstallPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    expect(getInstallPromptSnapshot().shouldShowPrompt).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    const snapshot = getInstallPromptSnapshot();
    expect(snapshot.isInstalled).toBe(true);
    expect(snapshot.shouldShowPrompt).toBe(false);
    expect(localStorage.getItem(INSTALLED_KEY)).toBe('true');
  });

  it('first-log detection: syncFirstLogFromQueryClient detects existing workout sets or meals without network calls', () => {
    const queryClient = new QueryClient();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(hasLoggedFirstActivity()).toBe(false);

    // 1. With empty query data -> not marked
    queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-12'], []);
    syncFirstLogFromQueryClient(queryClient);
    expect(hasLoggedFirstActivity()).toBe(false);

    // 2. With logged workout set in cache -> marked completed
    queryClient.setQueryData(['workout_sets', 'user-1', '2026-10-12'], [
      { id: 'set-1', reps: 10, weight: 100 },
    ]);
    syncFirstLogFromQueryClient(queryClient);
    expect(hasLoggedFirstActivity()).toBe(true);

    // 3. Zero network calls made
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('first-log detection: syncFirstLogFromQueryClient detects existing meals in nutrition_logs', () => {
    const queryClient = new QueryClient();

    expect(hasLoggedFirstActivity()).toBe(false);

    queryClient.setQueryData(['nutrition_logs', 'user-1'], [
      { id: 'meal-1', food_name: 'Chicken Rice', calories: 600 },
    ]);
    syncFirstLogFromQueryClient(queryClient);

    expect(hasLoggedFirstActivity()).toBe(true);
  });

  it('makes zero network calls during entire lifecycle of prompt operations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mockEvent = createMockBeforeInstallPromptEvent();

    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();
    recordDismissal();
    await promptToInstall();
    markInstalled();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
