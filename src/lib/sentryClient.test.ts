import { describe, it, expect } from 'vitest';
import { scrubEvent, isBrowserExtensionEvent } from './sentryClient';
import type { ErrorEvent } from '@sentry/react';

describe('sentryClient privacy and extension scrubbing', () => {
  it('detects and drops events originating from browser extensions', () => {
    const extensionEvent: ErrorEvent = {
      type: undefined,
      event_id: 'ext-1',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Extension background injected error',
            stacktrace: {
              frames: [
                { filename: 'chrome-extension://abcdefg/content.js', lineno: 42 },
                { filename: 'https://yourbody.fyi/src/main.tsx', lineno: 10 },
              ],
            },
          },
        ],
      },
    };

    expect(isBrowserExtensionEvent(extensionEvent)).toBe(true);
    expect(scrubEvent(extensionEvent)).toBeNull();
  });

  it('detects and drops events with moz-extension in message', () => {
    const mozEvent: ErrorEvent = {
      type: undefined,
      event_id: 'ext-2',
      message: 'Script error at moz-extension://12345/page.js',
    };

    expect(isBrowserExtensionEvent(mozEvent)).toBe(true);
    expect(scrubEvent(mozEvent)).toBeNull();
  });

  it('scrubs user identifiers, cookies, request data, and meal/nutrition data', () => {
    const rawEvent: ErrorEvent = {
      type: undefined,
      event_id: 'evt-100',
      user: {
        id: 'usr-abc',
        email: 'athlete@yourbody.fyi',
        username: 'runner1',
      },
      request: {
        url: 'https://yourbody.fyi/api/parse',
        cookies: { session_token: 'abc123secret' },
        data: { meal: '3 scrambled eggs', calories: 240 },
        headers: {
          'authorization': 'Bearer secret-jwt',
          'content-type': 'application/json',
          'cookie': 'session=xyz',
        },
      },
      extra: {
        route: '/nutrition',
        mealDescription: 'chicken rice',
        nutritionFacts: { protein: 40 },
        systemTime: 12345678,
      },
    };

    const scrubbed = scrubEvent(rawEvent);
    expect(scrubbed).not.toBeNull();
    // User must be completely deleted
    expect(scrubbed?.user).toBeUndefined();

    // Request data and cookies must be deleted
    expect(scrubbed?.request?.cookies).toBeUndefined();
    expect(scrubbed?.request?.data).toBeUndefined();
    expect(scrubbed?.request?.headers?.['cookie']).toBeUndefined();
    expect(scrubbed?.request?.headers?.['authorization']).toBeUndefined();
    expect(scrubbed?.request?.headers?.['content-type']).toBe('application/json');

    // Health data in extra must be stripped
    expect(scrubbed?.extra?.route).toBe('/nutrition');
    expect(scrubbed?.extra?.systemTime).toBe(12345678);
    expect(scrubbed?.extra?.mealDescription).toBeUndefined();
    expect(scrubbed?.extra?.nutritionFacts).toBeUndefined();
  });
});
