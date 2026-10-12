import { describe, expect, it } from 'vitest';
import type { IndexHtmlTransformHook } from 'vite';
import {
  buildPreconnectTags,
  preconnectPlugin,
  resolvePreconnectOrigin,
} from './preconnectHints.ts';

describe('preconnectHints', () => {
  describe('resolvePreconnectOrigin', () => {
    it('resolves valid https url to origin', () => {
      expect(resolvePreconnectOrigin('https://example.supabase.co')).toBe(
        'https://example.supabase.co'
      );
    });

    it('resolves valid http url with port to origin', () => {
      expect(resolvePreconnectOrigin('http://127.0.0.1:58821')).toBe(
        'http://127.0.0.1:58821'
      );
      expect(resolvePreconnectOrigin('http://localhost:54321')).toBe(
        'http://localhost:54321'
      );
    });

    it('strips path, query, and trailing slashes to isolate origin', () => {
      expect(
        resolvePreconnectOrigin('  https://project-ref.supabase.co/rest/v1?test=1/  ')
      ).toBe('https://project-ref.supabase.co');
    });

    it('returns null for empty, whitespace, null, or undefined', () => {
      expect(resolvePreconnectOrigin('')).toBeNull();
      expect(resolvePreconnectOrigin('   ')).toBeNull();
      expect(resolvePreconnectOrigin(null)).toBeNull();
      expect(resolvePreconnectOrigin(undefined)).toBeNull();
    });

    it('returns null for unsubstituted vite env placeholders', () => {
      expect(resolvePreconnectOrigin('%VITE_SUPABASE_URL%')).toBeNull();
      expect(resolvePreconnectOrigin('%SUPABASE_URL%')).toBeNull();
      expect(resolvePreconnectOrigin('undefined')).toBeNull();
      expect(resolvePreconnectOrigin('null')).toBeNull();
    });

    it('returns null for invalid or non-http protocols', () => {
      expect(resolvePreconnectOrigin('not-a-valid-url')).toBeNull();
      expect(resolvePreconnectOrigin('://missing-scheme')).toBeNull();
      expect(resolvePreconnectOrigin('javascript:alert(1)')).toBeNull();
      expect(resolvePreconnectOrigin('data:text/plain;base64,hello')).toBeNull();
      expect(resolvePreconnectOrigin('file:///path/to/file')).toBeNull();
    });
  });

  describe('buildPreconnectTags', () => {
    it('returns preconnect and dns-prefetch tag descriptors when origin is valid', () => {
      const tags = buildPreconnectTags('https://example.supabase.co');
      expect(tags).toEqual([
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://example.supabase.co',
            crossorigin: true,
          },
          injectTo: 'head',
        },
        {
          tag: 'link',
          attrs: {
            rel: 'dns-prefetch',
            href: 'https://example.supabase.co',
          },
          injectTo: 'head',
        },
      ]);
    });

    it('returns empty array when origin is invalid or missing', () => {
      expect(buildPreconnectTags('')).toEqual([]);
      expect(buildPreconnectTags(undefined)).toEqual([]);
      expect(buildPreconnectTags('%VITE_SUPABASE_URL%')).toEqual([]);
      expect(buildPreconnectTags('invalid-url')).toEqual([]);
    });
  });

  describe('preconnectPlugin', () => {
    it('creates a build-apply plugin returning tag descriptors', () => {
      const plugin = preconnectPlugin('https://example.supabase.co');
      expect(plugin.name).toBe('preconnect-hints-plugin');
      expect(plugin.apply).toBe('build');

      const hook = plugin.transformIndexHtml as IndexHtmlTransformHook;
      expect(typeof hook).toBe('function');

      const result = hook.call({} as any, '<!doctype html><html><head></head></html>', {} as any);
      expect(result).toEqual([
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://example.supabase.co',
            crossorigin: true,
          },
          injectTo: 'head',
        },
        {
          tag: 'link',
          attrs: {
            rel: 'dns-prefetch',
            href: 'https://example.supabase.co',
          },
          injectTo: 'head',
        },
      ]);
    });

    it('returns empty tag array when url is not set', () => {
      const plugin = preconnectPlugin('');
      const hook = plugin.transformIndexHtml as IndexHtmlTransformHook;
      const result = hook.call({} as any, '<!doctype html><html><head></head></html>', {} as any);
      expect(result).toEqual([]);
    });
  });
});
