import { describe, expect, it, vi } from 'vitest';
import { resolveSentryPluginConfig } from './sentryPluginConfig.ts';

describe('resolveSentryPluginConfig', () => {
  it('returns enabled config when all three Sentry env vars are non-empty', () => {
    const env = {
      SENTRY_AUTH_TOKEN: 'token-x',
      SENTRY_ORG: 'org-x',
      SENTRY_PROJECT: 'proj-x',
    };
    const sha = 'sha-abc';
    const result = resolveSentryPluginConfig(env, sha);

    expect(result.enabled).toBe(true);
    expect(result.sourcemap).toBe('hidden');
    expect(result.options).not.toBeNull();
    expect(result.options?.authToken).toBe('token-x');
    expect(result.options?.org).toBe('org-x');
    expect(result.options?.project).toBe('proj-x');
    expect(result.options?.telemetry).toBe(false);
    expect(result.options?.release.name).toBe('sha-abc');
    expect(result.options?.sourcemaps.filesToDeleteAfterUpload).toEqual(['dist/**/*.map', 'dist/*.map']);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => result.options?.errorHandler(new Error('network error'))).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('disables when SENTRY_AUTH_TOKEN is missing', () => {
    const env = {
      SENTRY_ORG: 'org-x',
      SENTRY_PROJECT: 'proj-x',
    };
    const result = resolveSentryPluginConfig(env, 'sha-abc');
    expect(result.enabled).toBe(false);
    expect(result.sourcemap).toBeUndefined();
    expect(result.options).toBeNull();
  });

  it('disables when SENTRY_ORG is missing', () => {
    const env = {
      SENTRY_AUTH_TOKEN: 'token-x',
      SENTRY_PROJECT: 'proj-x',
    };
    const result = resolveSentryPluginConfig(env, 'sha-abc');
    expect(result.enabled).toBe(false);
    expect(result.sourcemap).toBeUndefined();
    expect(result.options).toBeNull();
  });

  it('disables when SENTRY_PROJECT is missing', () => {
    const env = {
      SENTRY_AUTH_TOKEN: 'token-x',
      SENTRY_ORG: 'org-x',
    };
    const result = resolveSentryPluginConfig(env, 'sha-abc');
    expect(result.enabled).toBe(false);
    expect(result.sourcemap).toBeUndefined();
    expect(result.options).toBeNull();
  });

  it('disables when any variable is empty or whitespace only', () => {
    expect(
      resolveSentryPluginConfig(
        {
          SENTRY_AUTH_TOKEN: '   ',
          SENTRY_ORG: 'org-x',
          SENTRY_PROJECT: 'proj-x',
        },
        'sha-abc'
      ).enabled
    ).toBe(false);

    expect(
      resolveSentryPluginConfig(
        {
          SENTRY_AUTH_TOKEN: 'token-x',
          SENTRY_ORG: '',
          SENTRY_PROJECT: 'proj-x',
        },
        'sha-abc'
      ).enabled
    ).toBe(false);

    expect(
      resolveSentryPluginConfig(
        {
          SENTRY_AUTH_TOKEN: 'token-x',
          SENTRY_ORG: 'org-x',
          SENTRY_PROJECT: '  ',
        },
        'sha-abc'
      ).enabled
    ).toBe(false);
  });
});
