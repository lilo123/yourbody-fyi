export const CURRENT_TERMS_VERSION = '2026-10-10';

export function isTermsConsentEnabled(): boolean {
  return import.meta.env.VITE_FEATURE_TERMS_CONSENT === 'true';
}
