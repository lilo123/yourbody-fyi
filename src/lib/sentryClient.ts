/**
 * Lazy Sentry SDK client. Loaded only when VITE_SENTRY_DSN is configured.
 */
import * as Sentry from '@sentry/react';

export interface SentryConfigOptions {
  dsn: string;
  environment?: string;
  release?: string;
}

const EXTENSION_SCHEMES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'safari-web-extension://',
  'edge-extension://',
  'extension://',
];

export function isBrowserExtensionEvent(event: Sentry.ErrorEvent): boolean {
  // Check stack trace frames
  const frames =
    event.exception?.values?.flatMap((val) => val.stacktrace?.frames || []) || [];
  for (const frame of frames) {
    const filename = frame.filename || '';
    if (EXTENSION_SCHEMES.some((scheme) => filename.includes(scheme))) {
      return true;
    }
  }

  // Check event message and exception values
  const message = event.message || '';
  if (EXTENSION_SCHEMES.some((scheme) => message.includes(scheme))) {
    return true;
  }

  for (const val of event.exception?.values || []) {
    const valMessage = val.value || '';
    if (EXTENSION_SCHEMES.some((scheme) => valMessage.includes(scheme))) {
      return true;
    }
  }

  return false;
}

export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Drop events originating from browser extensions
  if (isBrowserExtensionEvent(event)) {
    return null;
  }

  // Health app invariant: Never attach user identifiers or email
  delete event.user;

  // Scrub request data, cookies, and sensitive authorization headers
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['Cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['Authorization'];
    }
  }

  // Scrub any health-sensitive or user-identifying fields from extra context
  if (event.extra) {
    const sensitiveTerms = [
      'meal',
      'nutrition',
      'calorie',
      'protein',
      'carb',
      'fat',
      'fiber',
      'food',
      'dish',
      'prompt',
      'email',
      'user_id',
      'userid',
    ];
    for (const key of Object.keys(event.extra)) {
      const lower = key.toLowerCase();
      if (sensitiveTerms.some((term) => lower.includes(term))) {
        delete event.extra[key];
      }
    }
  }

  return event;
}

type IntegrationsFn = Extract<
  NonNullable<Sentry.BrowserOptions['integrations']>,
  (...args: never[]) => unknown
>;
type IntegrationsParam = Parameters<IntegrationsFn>[0];

export function initSentry(options: SentryConfigOptions): void {
  const initOptions = {
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Disable console, fetch, xhr, and dom breadcrumbs; navigation history is kept
    integrations: (defaultIntegrations: IntegrationsParam) => {
      const filtered = defaultIntegrations.filter(
        (i) => i.name !== 'Breadcrumbs' && i.name !== 'Console'
      );
      return [
        ...filtered,
        Sentry.breadcrumbsIntegration({
          fetch: false,
          xhr: false,
          dom: false,
          history: true,
          sentry: false,
        }),
      ];
    },
    beforeBreadcrumb(breadcrumb: Sentry.Breadcrumb) {
      // Retain navigation breadcrumbs only
      if (breadcrumb.category === 'navigation' || breadcrumb.type === 'navigation') {
        return breadcrumb;
      }
      return null;
    },
    beforeSend(event: Sentry.ErrorEvent) {
      return scrubEvent(event);
    },
  };

  Sentry.init(initOptions as Sentry.BrowserOptions);
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    Sentry.captureException(error, context);
  } catch (err) {
    console.warn('[errorReporting] Sentry captureException error:', err);
  }
}
