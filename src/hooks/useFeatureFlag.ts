import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { AuthContext } from '../context/AuthContextTypes';

export const APP_CONFIG_QUERY_KEY = ['app_config'] as const;

// Flags are a small, maintainer-curated set; the bound keeps the query cheap and explicit.
const APP_CONFIG_ROW_LIMIT = 200;

export interface AppConfigRow {
  key: string;
  value: unknown;
}

/**
 * Access server-side application configuration and feature flags from public.app_config.
 * Fetches all rows once under the ['app_config'] query key, cached with ~5 min staleTime.
 * Enabled only when a user session exists.
 * Offline / never-fetched / error returns the last cached value if any, else defaultValue.
 * Never throws, never blocks render.
 * Flag is ON only when value === true (JSON boolean); anything else falls back to defaultValue.
 */
export function useFeatureFlag(key: string, defaultValue: boolean = false): boolean {
  const auth = useContext(AuthContext);
  const hasSession = Boolean(auth?.user);

  const { data } = useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('app_config')
        .select('key,value')
        .limit(APP_CONFIG_ROW_LIMIT);

      if (error) {
        throw error;
      }

      return (rows || []) as AppConfigRow[];
    },
    staleTime: 5 * 60 * 1000,
    enabled: hasSession,
  });

  if (!hasSession) {
    return defaultValue;
  }

  if (!data || !Array.isArray(data)) {
    return defaultValue;
  }

  const match = data.find((row) => row.key === key);
  if (!match) {
    return defaultValue;
  }

  if (match.value === true) {
    return true;
  }

  if (match.value === false) {
    return false;
  }

  return defaultValue;
}
