import { describe, expect, it } from 'vitest';
import {
  buildCspConnectSrcPolicy,
  getWsOrigin,
  SENTRY_INGEST_ORIGIN,
} from './cspPolicy.ts';

describe('cspPolicy', () => {
  describe('getWsOrigin', () => {
    it('converts https protocol to wss', () => {
      const parsedUrl = new URL('https://example.supabase.co');
      expect(getWsOrigin(parsedUrl)).toBe('wss://example.supabase.co');
    });

    it('converts http protocol to ws with port', () => {
      const parsedUrl = new URL('http://127.0.0.1:58821');
      expect(getWsOrigin(parsedUrl)).toBe('ws://127.0.0.1:58821');
    });

    it('returns null for unsupported protocols', () => {
      const parsedUrl = new URL('ftp://example.supabase.co');
      expect(getWsOrigin(parsedUrl)).toBeNull();
    });
  });

  describe('buildCspConnectSrcPolicy', () => {
    it('builds connect-src policy for https prod-like URL', () => {
      const policy = buildCspConnectSrcPolicy('https://project-ref.supabase.co');
      expect(policy).toBe(
        `connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co ${SENTRY_INGEST_ORIGIN} capacitor://localhost`
      );
      expect(policy).not.toContain('*.supabase.co');
      expect(policy).toContain(SENTRY_INGEST_ORIGIN);
    });

    it('builds connect-src policy for http localhost URL with port', () => {
      const policy = buildCspConnectSrcPolicy('http://127.0.0.1:58821');
      expect(policy).toBe(
        `connect-src 'self' http://127.0.0.1:58821 ws://127.0.0.1:58821 ${SENTRY_INGEST_ORIGIN} capacitor://localhost`
      );
      expect(policy).toContain('http://127.0.0.1:58821');
      expect(policy).toContain('ws://127.0.0.1:58821');
    });

    it('builds connect-src policy for http localhost name with port', () => {
      const policy = buildCspConnectSrcPolicy('http://localhost:54321');
      expect(policy).toBe(
        `connect-src 'self' http://localhost:54321 ws://localhost:54321 ${SENTRY_INGEST_ORIGIN} capacitor://localhost`
      );
    });

    it('trims whitespace around input URL and ignores path/query', () => {
      const policy = buildCspConnectSrcPolicy('  https://project-ref.supabase.co/rest/v1?test=1  ');
      expect(policy).toBe(
        `connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co ${SENTRY_INGEST_ORIGIN} capacitor://localhost`
      );
    });

    it('returns null for empty string', () => {
      expect(buildCspConnectSrcPolicy('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(buildCspConnectSrcPolicy('   ')).toBeNull();
    });

    it('returns null for undefined and null inputs', () => {
      expect(buildCspConnectSrcPolicy(undefined)).toBeNull();
      expect(buildCspConnectSrcPolicy(null)).toBeNull();
    });

    it('returns null for invalid URLs', () => {
      expect(buildCspConnectSrcPolicy('not-a-valid-url')).toBeNull();
      expect(buildCspConnectSrcPolicy('://missing-scheme')).toBeNull();
    });

    it('returns null for non-http/https protocols', () => {
      expect(buildCspConnectSrcPolicy('javascript:alert(1)')).toBeNull();
      expect(buildCspConnectSrcPolicy('data:text/plain;base64,SGVsbG8=')).toBeNull();
      expect(buildCspConnectSrcPolicy('file:///path/to/file')).toBeNull();
    });
  });
});
