import { describe, it, expect } from 'vitest';
import {
  detectInAppBrowser,
  isIos,
  isAndroid,
  getAndroidIntentUrl,
} from './inAppBrowser';

describe('detectInAppBrowser', () => {
  // Realistic Instagram iOS UA
  const INSTAGRAM_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 324.0.0.18.109 (iPhone14,5; iOS 17_4_1; en_US; en-US; scale=3.00; 1170x2532; 583492804)';

  // Realistic Instagram Android UA
  const INSTAGRAM_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.6312.118 Mobile Safari/537.36 Instagram 324.0.0.37.115 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; en_US; 583492804)';

  // Realistic Facebook iOS UA (contains FBAN and FBAV)
  const FACEBOOK_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/456.0.0.40.109;FBBV/583492804;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.4.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';

  // Realistic Facebook Android UA (contains FB_IAB and FBAV)
  const FACEBOOK_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-G998B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.119 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/455.0.0.44.109;]';

  // Realistic normal browsers
  const SAFARI_IOS_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1';
  const SAFARI_DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15';
  const CHROME_ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.118 Mobile Safari/537.36';
  const CHROME_DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
  const FIREFOX_ANDROID_UA =
    'Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0';
  const FIREFOX_DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';
  const SAMSUNG_INTERNET_UA =
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.5938.140 Mobile Safari/537.36';

  it('detects Instagram on iOS', () => {
    expect(detectInAppBrowser(INSTAGRAM_IOS_UA)).toBe('instagram');
  });

  it('detects Instagram on Android', () => {
    expect(detectInAppBrowser(INSTAGRAM_ANDROID_UA)).toBe('instagram');
  });

  it('detects Facebook on iOS', () => {
    expect(detectInAppBrowser(FACEBOOK_IOS_UA)).toBe('facebook');
  });

  it('detects Facebook on Android', () => {
    expect(detectInAppBrowser(FACEBOOK_ANDROID_UA)).toBe('facebook');
  });

  it('returns null for normal Safari on iOS and Desktop', () => {
    expect(detectInAppBrowser(SAFARI_IOS_UA)).toBeNull();
    expect(detectInAppBrowser(SAFARI_DESKTOP_UA)).toBeNull();
  });

  it('returns null for normal Chrome on Android and Desktop', () => {
    expect(detectInAppBrowser(CHROME_ANDROID_UA)).toBeNull();
    expect(detectInAppBrowser(CHROME_DESKTOP_UA)).toBeNull();
  });

  it('returns null for normal Firefox on Android and Desktop', () => {
    expect(detectInAppBrowser(FIREFOX_ANDROID_UA)).toBeNull();
    expect(detectInAppBrowser(FIREFOX_DESKTOP_UA)).toBeNull();
  });

  it('returns null for Samsung Internet', () => {
    expect(detectInAppBrowser(SAMSUNG_INTERNET_UA)).toBeNull();
  });

  it('handles empty or malformed user agents safely', () => {
    expect(detectInAppBrowser('')).toBeNull();
    expect(detectInAppBrowser(null as unknown as string)).toBeNull();
    expect(detectInAppBrowser(undefined as unknown as string)).toBeNull();
  });
});

describe('isIos and isAndroid helpers', () => {
  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15';
  const IPAD_UA =
    'Mozilla/5.0 (iPad; CPU OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15';
  const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36';
  const DESKTOP_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

  it('correctly identifies iOS devices', () => {
    expect(isIos(IPHONE_UA)).toBe(true);
    expect(isIos(IPAD_UA)).toBe(true);
    expect(isIos(ANDROID_UA)).toBe(false);
    expect(isIos(DESKTOP_UA)).toBe(false);
    expect(isIos('')).toBe(false);
  });

  it('correctly identifies Android devices', () => {
    expect(isAndroid(ANDROID_UA)).toBe(true);
    expect(isAndroid(IPHONE_UA)).toBe(false);
    expect(isAndroid(IPAD_UA)).toBe(false);
    expect(isAndroid(DESKTOP_UA)).toBe(false);
    expect(isAndroid('')).toBe(false);
  });
});

describe('getAndroidIntentUrl', () => {
  it('formats intent URI with package and scheme for https URLs', () => {
    const url = 'https://yourbody.fyi/login';
    expect(getAndroidIntentUrl(url)).toBe(
      'intent://yourbody.fyi/login#Intent;scheme=https;package=com.android.chrome;end'
    );
  });

  it('formats intent URI for root URL', () => {
    const url = 'https://yourbody.fyi/';
    expect(getAndroidIntentUrl(url)).toBe(
      'intent://yourbody.fyi/#Intent;scheme=https;package=com.android.chrome;end'
    );
  });

  it('returns empty string if url is missing', () => {
    expect(getAndroidIntentUrl('')).toBe('');
  });
});
