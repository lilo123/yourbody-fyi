import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkoutSet } from '../types/database';

/**
 * Refetches a single canonical workout set from the database by ID.
 * Returns null if the row is missing (e.g. deleted elsewhere).
 */
export async function fetchSetById(
  client: SupabaseClient,
  setId: string
): Promise<WorkoutSet | null> {
  if (!setId) return null;
  const { data, error } = await (client.from('sets') as any)
    .select('*')
    .eq('id', setId)
    .maybeSingle();

  if (error) throw error;
  return (data as WorkoutSet) || null;
}
