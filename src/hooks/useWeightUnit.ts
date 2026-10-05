import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import type { WeightUnit } from '../utils/weight';

/**
 * Returns the currently active weight unit for the logged-in user.
 * Defaults to 'lb' if not authenticated, unset, or unknown.
 */
export function useWeightUnit(): WeightUnit {
  const { profile } = useAuth();
  if (profile?.weight_unit === 'kg' || profile?.weight_unit === 'lb') {
    return profile.weight_unit;
  }
  return 'lb';
}

export interface UseWeightUnitPreferenceReturn {
  unit: WeightUnit;
  setUnit: (u: WeightUnit) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

/**
 * Hook for managing user weight unit preference.
 * Writes to the server first without optimistic flipping.
 * Updates public.users filtered strictly by the user's own id, then refreshes AuthContext.
 * Throws and records error on failure, leaving active unit unchanged.
 */
export function useWeightUnitPreference(): UseWeightUnitPreferenceReturn {
  const { user, refreshProfile } = useAuth();
  const unit = useWeightUnit();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUnit = useCallback(
    async (u: WeightUnit) => {
      setIsSaving(true);
      setError(null);
      try {
        if (!user?.id) {
          throw new Error('Not authenticated');
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({ weight_unit: u })
          .eq('id', user.id);

        if (updateError) {
          throw updateError;
        }

        await refreshProfile();
      } catch (err) {
        const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Failed to update weight unit';
        setError(msg);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [user, refreshProfile]
  );

  return { unit, setUnit, isSaving, error };
}
