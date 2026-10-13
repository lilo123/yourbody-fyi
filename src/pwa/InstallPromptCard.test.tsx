import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { InstallPromptCard } from './InstallPromptCard';
import {
  resetInstallPromptStoreForTesting,
  setDeferredPromptForTesting,
  setPlatformOverrideForTesting,
  setStandaloneOverrideForTesting,
  markFirstLogCompleted,
  type BeforeInstallPromptEvent,
} from './installPromptStore';

function createMockPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as any;
  event.platforms = ['web'];
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event as BeforeInstallPromptEvent;
}

describe('InstallPromptCard Component', () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstallPromptStoreForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetInstallPromptStoreForTesting();
    localStorage.clear();
  });

  it('renders nothing when shouldShowPrompt is false (e.g. before first log)', () => {
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    // User has not logged first workout set or meal

    const { container } = render(<InstallPromptCard />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
  });

  it('renders title, Install button, and dismiss button on Chrome/Android when deferred prompt exists and first log completed', () => {
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    render(<InstallPromptCard />);

    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
    expect(screen.getByText('Install Yourbody')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss install prompt' })).toBeInTheDocument();
  });

  it('calls prompt() when Install button is clicked and hides card upon accept', async () => {
    const mockEvent = createMockPromptEvent('accepted');
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    render(<InstallPromptCard />);

    const installBtn = screen.getByRole('button', { name: 'Install' });
    await act(async () => {
      fireEvent.click(installBtn);
    });

    expect(mockEvent.prompt).toHaveBeenCalledTimes(1);
    // After acceptance, card hides
    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
  });

  it('renders instruction "Tap Share, then Add to Home Screen" on iOS Safari without Install button', () => {
    setStandaloneOverrideForTesting(false);
    setPlatformOverrideForTesting({
      isIOS: true,
      isIOSSafari: true,
      isOtherIOSBrowser: false,
    });
    markFirstLogCompleted();

    render(<InstallPromptCard />);

    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();
    expect(screen.getByText('Install Yourbody')).toBeInTheDocument();
    expect(screen.getByText('Tap Share, then Add to Home Screen')).toBeInTheDocument();
    // No Install button on iOS Safari
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    // Dismiss button still present
    expect(screen.getByRole('button', { name: 'Dismiss install prompt' })).toBeInTheDocument();
  });

  it('clicking dismiss (X) button hides the card immediately', () => {
    const mockEvent = createMockPromptEvent();
    setDeferredPromptForTesting(mockEvent);
    setStandaloneOverrideForTesting(false);
    markFirstLogCompleted();

    render(<InstallPromptCard />);

    expect(screen.getByTestId('install-prompt-card')).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss install prompt' });
    act(() => {
      fireEvent.click(dismissBtn);
    });

    expect(screen.queryByTestId('install-prompt-card')).toBeNull();
  });
});
