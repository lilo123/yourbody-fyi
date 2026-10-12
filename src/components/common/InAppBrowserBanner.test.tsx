import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InAppBrowserBanner } from './InAppBrowserBanner';

describe('InAppBrowserBanner', () => {
  const INSTAGRAM_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 324.0.0.18.109';
  const INSTAGRAM_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.6312.118 Mobile Safari/537.36 Instagram 324.0.0.37.115';
  const FACEBOOK_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/456.0.0.40.109;]';
  const SAFARI_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1';
  const CHROME_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.118 Mobile Safari/537.36';

  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders banner for Instagram UA', () => {
    render(<InAppBrowserBanner userAgent={INSTAGRAM_IOS_UA} />);
    const banner = screen.getByTestId('in-app-browser-banner');
    expect(banner).toBeDefined();
    expect(banner).toHaveTextContent(
      'Open in your browser for the best experience.'
    );
  });

  it('renders banner for Facebook UA', () => {
    render(<InAppBrowserBanner userAgent={FACEBOOK_IOS_UA} />);
    expect(screen.getByTestId('in-app-browser-banner')).toBeDefined();
  });

  it('does NOT render banner for normal Safari or Chrome UAs', () => {
    const { unmount } = render(<InAppBrowserBanner userAgent={SAFARI_IOS_UA} />);
    expect(screen.queryByTestId('in-app-browser-banner')).toBeNull();
    unmount();

    render(<InAppBrowserBanner userAgent={CHROME_ANDROID_UA} />);
    expect(screen.queryByTestId('in-app-browser-banner')).toBeNull();
  });

  it('renders iOS hint on iOS in-app browser', () => {
    render(<InAppBrowserBanner userAgent={INSTAGRAM_IOS_UA} />);
    expect(
      screen.getByText('Tap … and choose Open in Safari.')
    ).toBeDefined();
    expect(screen.queryByTestId('in-app-browser-android-intent')).toBeNull();
  });

  it('renders Android action with intent URI on Android in-app browser', () => {
    render(<InAppBrowserBanner userAgent={INSTAGRAM_ANDROID_UA} />);
    const intentLink = screen.getByTestId('in-app-browser-android-intent');
    expect(intentLink).toBeDefined();
    expect(intentLink.textContent).toBe('Open in Chrome');
    expect(intentLink.getAttribute('href')).toContain('intent://');
    expect(intentLink.getAttribute('href')).toContain(
      '#Intent;scheme=https;package=com.android.chrome;end'
    );
    expect(screen.queryByText('Tap … and choose Open in Safari.')).toBeNull();
  });

  it('copies current URL to clipboard when Copy link is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<InAppBrowserBanner userAgent={INSTAGRAM_IOS_UA} />);
    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith(window.location.href);
  });

  it('dismisses banner and sets sessionStorage flag when X is clicked', () => {
    render(<InAppBrowserBanner userAgent={INSTAGRAM_IOS_UA} />);
    expect(screen.getByTestId('in-app-browser-banner')).toBeDefined();

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissBtn);

    expect(screen.queryByTestId('in-app-browser-banner')).toBeNull();
    expect(sessionStorage.getItem('yb_inapp_dismissed')).toBe('true');
  });

  it('does NOT render if previously dismissed in the session', () => {
    sessionStorage.setItem('yb_inapp_dismissed', 'true');
    render(<InAppBrowserBanner userAgent={INSTAGRAM_IOS_UA} />);
    expect(screen.queryByTestId('in-app-browser-banner')).toBeNull();
  });
});
