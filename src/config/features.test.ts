import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CURRENT_TERMS_VERSION, isTermsConsentEnabled } from './features';

describe('features', () => {
  const originalEnv = import.meta.env.VITE_FEATURE_TERMS_CONSENT;

  beforeEach(() => {
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = originalEnv;
  });

  afterEach(() => {
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = originalEnv;
  });

  it('exposes the expected current terms version', () => {
    expect(CURRENT_TERMS_VERSION).toBe('2026-10-10');
  });

  it('returns false when VITE_FEATURE_TERMS_CONSENT is undefined, empty, or false', () => {
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = undefined;
    expect(isTermsConsentEnabled()).toBe(false);

    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = '';
    expect(isTermsConsentEnabled()).toBe(false);

    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'false';
    expect(isTermsConsentEnabled()).toBe(false);

    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = '1';
    expect(isTermsConsentEnabled()).toBe(false);
  });

  it('returns true only when VITE_FEATURE_TERMS_CONSENT is strictly "true"', () => {
    (import.meta.env as any).VITE_FEATURE_TERMS_CONSENT = 'true';
    expect(isTermsConsentEnabled()).toBe(true);
  });
});
