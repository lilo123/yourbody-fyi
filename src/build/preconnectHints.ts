import { loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite';

/**
 * Resolves a valid HTTP/HTTPS origin from a raw URL string for preconnect hints.
 * Returns null if the URL is missing, invalid, non-HTTP(S), or an unsubstituted placeholder.
 */
export function resolvePreconnectOrigin(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed.startsWith('%') ||
    trimmed === 'undefined' ||
    trimmed === 'null'
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const origin = parsed.origin;
  if (!origin || origin === 'null') {
    return null;
  }

  return origin;
}

/**
 * Builds preconnect and dns-prefetch HtmlTagDescriptor entries for Vite's transformIndexHtml.
 * Returns an empty array if the URL does not resolve to a valid origin.
 */
export function buildPreconnectTags(rawUrl?: string | null): HtmlTagDescriptor[] {
  const origin = resolvePreconnectOrigin(rawUrl);
  if (!origin) {
    return [];
  }

  return [
    {
      tag: 'link',
      attrs: {
        rel: 'preconnect',
        href: origin,
        crossorigin: true,
      },
      injectTo: 'head',
    },
    {
      tag: 'link',
      attrs: {
        rel: 'dns-prefetch',
        href: origin,
      },
      injectTo: 'head',
    },
  ];
}

/**
 * Vite plugin that injects preconnect and dns-prefetch resource hints at build time
 * when a valid Supabase origin URL is configured, avoiding broken placeholder links.
 */
export function preconnectPlugin(rawUrl?: string): Plugin {
  let supabaseUrl = rawUrl;
  return {
    name: 'preconnect-hints-plugin',
    apply: 'build',
    configResolved(config) {
      if (!supabaseUrl) {
        const env = loadEnv(config.mode, config.root || process.cwd(), '');
        supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
      }
    },
    transformIndexHtml() {
      return buildPreconnectTags(supabaseUrl);
    },
  };
}
