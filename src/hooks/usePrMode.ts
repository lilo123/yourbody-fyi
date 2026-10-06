import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import type { PrMode } from '../lib/prComparator';

export { type PrMode };

export interface UsePrModeReturn {
  mode: PrMode;
  setMode: (mode: PrMode) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

/**
 * Hook for managing personal record (PR) calculation mode ('weight' vs 'e1rm').
 * Single source of truth is profile.pr_mode from AuthContext (mirroring useWeightUnit).
 * Optimistic update via in-memory state; writes to public.users via Supabase,
 * refreshes AuthContext profile, and rolls back inline on failure.
 * Decisions: PR ranking mode profile setting.
 */
export function usePrMode(): UsePrModeReturn {
  const { user, profile, refreshProfile } = useAuth();

  const [optimisticMode, setOptimisticMode] = useState<PrMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode: PrMode =
    optimisticMode ?? (profile?.pr_mode === 'e1rm' ? 'e1rm' : 'weight');

  const setMode = useCallback(
    async (newMode: PrMode) => {
      if (newMode === mode && !error) return;
      setIsSaving(true);
      setError(null);
      setOptimisticMode(newMode);

      try {
        if (!user?.id) {
          throw new Error('Not authenticated');
        }

        const { error: updateError } = await (supabase
          .from('users') as any)
          .update({ pr_mode: newMode })
          .eq('id', user.id);

        if (updateError) {
          throw updateError;
        }

        if (refreshProfile) {
          await refreshProfile();
        }
      } catch (err) {
        setOptimisticMode(null);
        const msg =
          err instanceof Error
            ? err.message
            : (err as { message?: string })?.message || 'Failed to update PR mode';
        setError(msg);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [mode, error, user, refreshProfile]
  );

  return { mode, setMode, isSaving, error };
}
