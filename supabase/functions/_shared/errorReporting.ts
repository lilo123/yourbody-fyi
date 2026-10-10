/**
 * Shared Sentry error reporting helper for Supabase Edge Functions (Deno).
 *
 * Initialised ONLY when Deno.env.get('SENTRY_DSN') is set to a non-empty string.
 * Otherwise, captureException is a safe no-op.
 * Under no circumstances may Sentry errors propagate or disrupt function responses.
 */

let isSentryInitialized = false;

export function isEdgeReportingConfigured(): boolean {
  const dsn = Deno.env.get('SENTRY_DSN');
  return typeof dsn === 'string' && dsn.trim().length > 0;
}

export function resetEdgeReportingForTesting(): void {
  isSentryInitialized = false;
}

export function scrubEdgeEvent(event: any): any {
  // Strip request data, cookies, and sensitive headers
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['Cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['Authorization'];
    }
  }

  // Never attach user ID, email, or identifiers
  delete event.user;

  // Scrub any meal, nutrition, or sensitive fields from extra context
  if (event.extra) {
    const sensitiveKeys = [
      'meal',
      'input',
      'prompt',
      'nutrition',
      'calories',
      'protein',
      'carbs',
      'fat',
      'fiber',
      'email',
      'userid',
      'user_id',
    ];
    for (const key of Object.keys(event.extra)) {
      if (sensitiveKeys.some((pattern) => key.toLowerCase().includes(pattern))) {
        delete event.extra[key];
      }
    }
  }

  return event;
}

export async function initEdgeSentry(): Promise<any> {
  const dsn = Deno.env.get('SENTRY_DSN')?.trim();
  if (!dsn) {
    return null;
  }

  try {
    const Sentry = await import("@sentry/deno");
    if (!isSentryInitialized) {
      const initOptions: Record<string, any> = {
        dsn,
        environment:
          Deno.env.get('ENVIRONMENT') ||
          Deno.env.get('DENO_ENV') ||
          'production',
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend(event: any) {
          return scrubEdgeEvent(event);
        },
      };
      Sentry.init(initOptions as any);
      isSentryInitialized = true;
    }
    return Sentry;
  } catch (err) {
    console.warn('[errorReporting] Failed to initialize Sentry for Deno:', err);
    return null;
  }
}

export async function captureException(
  err: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    if (!isEdgeReportingConfigured()) {
      return;
    }
    const Sentry = await initEdgeSentry();
    if (Sentry && typeof Sentry.captureException === 'function') {
      Sentry.captureException(err, context);
      if (typeof Sentry.flush === 'function') {
        await Sentry.flush(2000);
      }
    }
  } catch (error) {
    // Sentry failure can NEVER break the function response
    console.warn('[errorReporting] Sentry captureException error:', error);
  }
}
