import React, { useState } from 'react';
import { Compass, X } from 'lucide-react';
import { StatusBanner } from './StatusBanner';
import {
  detectInAppBrowser,
  isIos,
  isAndroid,
  getAndroidIntentUrl,
} from '../../utils/inAppBrowser';

export interface InAppBrowserBannerProps {
  className?: string;
  userAgent?: string;
}

const SESSION_STORAGE_KEY = 'yb_inapp_dismissed';

export const InAppBrowserBanner: React.FC<InAppBrowserBannerProps> = ({
  className = '',
  userAgent,
}) => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return (
        typeof window !== 'undefined' &&
        window.sessionStorage?.getItem(SESSION_STORAGE_KEY) === 'true'
      );
    } catch {
      return false;
    }
  });

  const resolvedUa =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const inAppType = detectInAppBrowser(resolvedUa);

  if (dismissed || !inAppType) {
    return null;
  }

  const isIosDevice = isIos(resolvedUa);
  const isAndroidDevice = isAndroid(resolvedUa);

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const androidIntentUrl = getAndroidIntentUrl(currentUrl);

  const handleDismiss = () => {
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage?.setItem(SESSION_STORAGE_KEY, 'true');
      }
    } catch {
      // ignore storage errors
    }
    setDismissed(true);
  };

  const handleCopy = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(currentUrl);
      } catch {
        // ignore clipboard errors
      }
    }
  };

  return (
    <StatusBanner
      tone="info"
      rawLayout={true}
      testId="in-app-browser-banner"
      className={`w-full border-b border-cyan-500/30 bg-cyan-950/80 text-cyan-200 box-border ${className}`}
      message="Open in your browser for the best experience."
    >
      <div className="max-w-6xl mx-auto px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 box-border w-full">
        <div className="flex items-start sm:items-center gap-2 min-w-0">
          <Compass
            className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5 sm:mt-0"
            aria-hidden="true"
          />
          <div className="text-xs font-normal text-zinc-200 min-w-0 break-words">
            <span>Open in your browser for the best experience.</span>
            {isIosDevice && (
              <span className="block sm:inline sm:ml-1 text-zinc-400">
                Tap … and choose Open in Safari.
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          {isAndroidDevice && (
            <a
              href={androidIntentUrl}
              data-testid="in-app-browser-android-intent"
              className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation"
            >
              Open in Chrome
            </a>
          )}
          <button
            type="button"
            onClick={handleCopy}
            data-testid="in-app-browser-copy"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center rounded-xl text-xs font-bold border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 transition active:scale-95 touch-manipulation cursor-pointer"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            data-testid="in-app-browser-dismiss"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-zinc-400 hover:text-white transition touch-manipulation cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </StatusBanner>
  );
};

export default InAppBrowserBanner;
