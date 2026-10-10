/**
 * Error reporting facade for Yourbody web client.
 *
 * Lazily loads the Sentry SDK via dynamic import only when VITE_SENTRY_DSN
 * is set to a non-empty string. If unset, this module remains a zero-overhead no-op
 * and the Sentry bundle is not fetched.
 */

declare const __APP_COMMIT__: string | undefined;

let sentryModulePromise: Promise<typeof import('./sentryClient') | null> | null = null;
let sentryClient: typeof import('./sentryClient') | null = null;

const SENSITIVE_KEY_PATTERNS = [
  'email',
  'user_id',
  'userid',
  'token',
  'auth',
  'password',
  'secret',
  'meal',
  'prompt',
  'food',
  'dish',
  'nutrition',
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'macro',
];

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object') {
    return undefined;
  }

  const cleanContext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      cleanContext[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      cleanContext[key] = value;
    }
  }
  return cleanContext;
}

export function isErrorReportingConfigured(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  return typeof dsn === 'string' && dsn.trim().length > 0;
}

export function resetErrorReportingForTesting(): void {
  sentryModulePromise = null;
  sentryClient = null;
}

export async function initErrorReporting(): Promise<void> {
  if (!isErrorReportingConfigured()) {
    return;
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN!.trim();

  if (!sentryModulePromise) {
    sentryModulePromise = import('./sentryClient')
      .then((mod) => {
        sentryClient = mod;
        const environment =
          import.meta.env.VITE_SENTRY_ENVIRONMENT ||
          import.meta.env.MODE ||
          'production';
        const release =
          typeof __APP_COMMIT__ !== 'undefined'
            ? __APP_COMMIT__
            : import.meta.env.VITE_APP_COMMIT || undefined;

        mod.initSentry({
          dsn,
          environment,
          release,
        });
        return mod;
      })
      .catch((err) => {
        console.warn('[errorReporting] Failed to load error reporting SDK:', err);
        return null;
      });
  }

  await sentryModulePromise;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!isErrorReportingConfigured()) {
    return;
  }

  const sanitized = sanitizeContext(context);

  if (sentryClient) {
    sentryClient.captureException(error, sanitized);
  } else {
    // If reporting was not initialized yet, kick off lazy initialization and capture upon completion
    initErrorReporting()
      .then(() => {
        if (sentryClient) {
          sentryClient.captureException(error, sanitized);
        }
      })
      .catch(() => {});
  }
}
