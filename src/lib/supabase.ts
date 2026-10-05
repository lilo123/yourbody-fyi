import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

if (import.meta.env.PROD) {
  if (!import.meta.env.VITE_SUPABASE_URL) {
    throw new Error('VITE_SUPABASE_URL is required in production environment');
  }
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_ANON_KEY is required in production environment');
  }
}

// Development fallbacks are strictly gated behind import.meta.env.DEV
const isDev = Boolean(import.meta.env.DEV) && !import.meta.env.PROD;

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  (isDev ? 'http://127.0.0.1:58821' : '');

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  (isDev ? 'dummy_anon_key' : '');

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

