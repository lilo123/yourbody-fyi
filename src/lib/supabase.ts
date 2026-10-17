import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

if (import.meta.env.PROD && !import.meta.env.SSR) {
  if (!import.meta.env.VITE_SUPABASE_URL) {
    throw new Error('VITE_SUPABASE_URL is required in production environment');
  }
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required in production environment');
  }
}

// Development fallbacks are strictly gated behind import.meta.env.DEV or SSR prerender
const isDev = (Boolean(import.meta.env.DEV) && !import.meta.env.PROD) || Boolean(import.meta.env.SSR);

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  (isDev ? 'http://127.0.0.1:58821' : '');

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  (isDev ? 'dummy_anon_key' : '');

if (typeof globalThis !== 'undefined' && typeof (globalThis as any).WebSocket === 'undefined') {
  (globalThis as any).WebSocket = class DummyWebSocket {};
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

export const authStorageKey = (() => {
  try {
    const parsed = new URL(supabaseUrl);
    const ref = parsed.hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return 'sb-auth-token';
  }
})();

export const AUTH_TOKEN_KEY_REGEX = /^sb-[a-zA-Z0-9_.-]+-auth-token$/;

export function hasValidAuthToken(storage?: Storage): boolean {
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return false;
    const userRaw = s.getItem('yourbody_user');
    if (userRaw && userRaw !== 'null' && userRaw !== 'undefined') {
      return true;
    }
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && AUTH_TOKEN_KEY_REGEX.test(k)) {
        const val = s.getItem(k);
        if (!val) continue;
        try {
          const parsed = JSON.parse(val);
          if (parsed && (parsed.access_token || parsed.user)) {
            return true;
          }
        } catch {
          // Ignore invalid JSON payload
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

