import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as errorReporting from './errorReporting';
import * as sentryClient from './sentryClient';

vi.mock('./sentryClient', () => {
  return {
    initSentry: vi.fn(),
    captureException: vi.fn(),
    scrubEvent: vi.fn((e) => e),
    isBrowserExtensionEvent: vi.fn(() => false),
  };
});

describe('errorReporting', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.clearAllMocks();
    errorReporting.resetErrorReportingForTesting();
  });

  afterEach(() => {
    import.meta.env.VITE_SENTRY_DSN = originalEnv.VITE_SENTRY_DSN;
    import.meta.env.VITE_SENTRY_ENVIRONMENT = originalEnv.VITE_SENTRY_ENVIRONMENT;
    import.meta.env.MODE = originalEnv.MODE;
    errorReporting.resetErrorReportingForTesting();
  });

  it('(a) init is not imported or called when DSN is unset or empty', async () => {
    import.meta.env.VITE_SENTRY_DSN = '';
    expect(errorReporting.isErrorReportingConfigured()).toBe(false);

    await errorReporting.initErrorReporting();
    expect(sentryClient.initSentry).not.toHaveBeenCalled();

    errorReporting.captureException(new Error('test failure'));
    expect(sentryClient.captureException).not.toHaveBeenCalled();
  });

  it('(a) init is not imported or called when DSN is whitespace only', async () => {
    import.meta.env.VITE_SENTRY_DSN = '   ';
    expect(errorReporting.isErrorReportingConfigured()).toBe(false);

    await errorReporting.initErrorReporting();
    expect(sentryClient.initSentry).not.toHaveBeenCalled();
  });

  it('(b) init is dynamically imported and called when DSN is set', async () => {
    const dummyDsn = 'https://abc@o0.ingest.us.sentry.io/0';
    import.meta.env.VITE_SENTRY_DSN = dummyDsn;
    import.meta.env.VITE_SENTRY_ENVIRONMENT = 'staging';

    expect(errorReporting.isErrorReportingConfigured()).toBe(true);

    await errorReporting.initErrorReporting();

    expect(sentryClient.initSentry).toHaveBeenCalledTimes(1);
    expect(sentryClient.initSentry).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: dummyDsn,
        environment: 'staging',
      })
    );
  });

  it('(b) captureException forwards error and sanitizes context when DSN is configured', async () => {
    const dummyDsn = 'https://abc@o0.ingest.us.sentry.io/0';
    import.meta.env.VITE_SENTRY_DSN = dummyDsn;

    await errorReporting.initErrorReporting();

    const sampleError = new Error('Sample crash');
    errorReporting.captureException(sampleError, {
      safeKey: 'ok',
      user_id: 'secret-id',
      mealText: '2 eggs and bacon',
      nutrition: { calories: 500 },
    });

    expect(sentryClient.captureException).toHaveBeenCalledTimes(1);
    expect(sentryClient.captureException).toHaveBeenCalledWith(
      sampleError,
      {
        safeKey: 'ok',
      }
    );
  });

  it('sanitizeContext strips health data and user identifiers recursively', () => {
    const context = {
      view: 'workout',
      userId: 'usr-123',
      meal_prompt: '300g oats',
      nested: {
        email: 'athlete@example.com',
        calories: 1200,
        subsystem: 'sync',
      },
    };

    const sanitized = errorReporting.sanitizeContext(context);
    expect(sanitized).toEqual({
      view: 'workout',
      nested: {
        subsystem: 'sync',
      },
    });
  });
});
