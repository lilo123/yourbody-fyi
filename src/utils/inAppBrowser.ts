export type InAppBrowserType = 'instagram' | 'facebook';

/**
 * Detects whether the current user agent represents an Instagram or Facebook in-app browser.
 * Instagram UA contains 'Instagram'.
 * Facebook UA contains 'FBAN', 'FBAV', or 'FB_IAB'.
 */
export function detectInAppBrowser(userAgent: string): InAppBrowserType | null {
  if (!userAgent || typeof userAgent !== 'string') {
    return null;
  }
  if (userAgent.includes('Instagram')) {
    return 'instagram';
  }
  if (
    userAgent.includes('FBAN') ||
    userAgent.includes('FBAV') ||
    userAgent.includes('FB_IAB')
  ) {
    return 'facebook';
  }
  return null;
}

/**
 * Checks whether the user agent is an iOS device.
 */
export function isIos(userAgent: string): boolean {
  if (!userAgent || typeof userAgent !== 'string') return false;
  return /iPhone|iPad|iPod/i.test(userAgent);
}

/**
 * Checks whether the user agent is an Android device.
 */
export function isAndroid(userAgent: string): boolean {
  if (!userAgent || typeof userAgent !== 'string') return false;
  return /Android/i.test(userAgent);
}

/**
 * Constructs an Android intent URI to open the current URL directly in Chrome.
 * Scheme: intent://<url-without-scheme>#Intent;scheme=https;package=com.android.chrome;end
 */
export function getAndroidIntentUrl(url: string): string {
  if (!url) return '';
  const withoutScheme = url.replace(/^https?:\/\//, '');
  return `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;end`;
}
