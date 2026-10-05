import { supabase as defaultSupabase } from '../lib/supabase';
import type { OutboxOp } from './types';
import { resolveWorkoutRef } from './idmap';

export interface ReplayResult {
  canonicalId?: string;
  alreadyApplied?: boolean;
}

function numbersEqual(a: any, b: any, tolerance = 1e-6): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const numA = Number(a);
  const numB = Number(b);
  if (isNaN(numA) || isNaN(numB)) {
    return String(a) === String(b);
  }
  return Math.abs(numA - numB) < tolerance;
}

function fieldsMatch(serverRow: Record<string, any>, fields: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const serverVal = serverRow[key];
    if (typeof value === 'number' || typeof serverVal === 'number') {
      if (!numbersEqual(serverVal, value)) return false;
    } else if (serverVal !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Replays a single outbox operation against the Supabase database.
 * Designed to be idempotent.
 */
export async function executeReplayOp(
  op: OutboxOp,
  client = defaultSupabase
): Promise<ReplayResult> {
  switch (op.kind) {
    case 'workout.ensure': {
      const { clientWorkoutId, workout_date, name } = op.payload;
      // Step 1: Upsert with ignoreDuplicates on (user_id, workout_date)
      const { error: upsertErr } = await (client.from('workouts') as any).upsert(
        {
          id: clientWorkoutId,
          user_id: op.userId,
          date: workout_date,
          workout_date,
          name: name ?? null,
        },
        { onConflict: 'user_id,workout_date', ignoreDuplicates: true }
      );
      if (upsertErr) throw upsertErr;

      // Step 2: Query the canonical workout id by (user_id, workout_date)
      const { data: canonicalRow, error: selErr } = await (client.from('workouts') as any)
        .select('id')
        .eq('user_id', op.userId)
        .eq('workout_date', workout_date)
        .single();

      if (selErr) throw selErr;
      if (!canonicalRow?.id) {
        throw new Error(`Failed to resolve canonical workout for date ${workout_date}`);
      }

      return { canonicalId: canonicalRow.id };
    }

    case 'workout.rename': {
      const { workoutRef, name } = op.payload;
      const workoutId = await resolveWorkoutRef(op.userId, workoutRef);

      const { error } = await (client.from('workouts') as any)
        .update({ name })
        .eq('id', workoutId);

      if (error) throw error;
      return {};
    }

    case 'set.create': {
      const { id, workoutRef, exercise_id, weight, reps, set_index, set_type, rpe, created_at } =
        op.payload;
      const workoutId = await resolveWorkoutRef(op.userId, workoutRef);

      const { error } = await (client.from('sets') as any).upsert(
        {
          id,
          workout_id: workoutId,
          exercise_id,
          weight,
          reps,
          set_index,
          set_type: set_type || 'working',
          rpe: rpe ?? null,
          created_at,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      );

      if (error) throw error;
      return {};
    }

    case 'set.batchCreate': {
      const { workoutRef, sets } = op.payload;
      if (!sets || sets.length === 0) return {};
      const workoutId = await resolveWorkoutRef(op.userId, workoutRef);

      const rows = sets.map((s) => ({
        id: s.id,
        workout_id: workoutId,
        exercise_id: s.exercise_id,
        weight: s.weight,
        reps: s.reps,
        set_index: s.set_index,
        set_type: s.set_type || 'working',
        rpe: s.rpe ?? null,
        created_at: s.created_at,
      }));

      const { error } = await (client.from('sets') as any).upsert(
        rows,
        { onConflict: 'id', ignoreDuplicates: true }
      );

      if (error) throw error;
      return {};
    }

    case 'set.update': {
      const { id, patch, expected } = op.payload;

      // Step 1: Select existing row from server
      const { data: existingRow, error: selErr } = await (client.from('sets') as any)
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (selErr) throw selErr;

      // Missing row -> deleted elsewhere
      if (!existingRow) {
        throw new Error('deleted elsewhere');
      }

      // Step 2: Check if patch is already applied
      if (fieldsMatch(existingRow, patch)) {
        return { alreadyApplied: true };
      }

      // Step 3: Check pre-image (expected)
      if (expected && !fieldsMatch(existingRow, expected)) {
        throw new Error('changed elsewhere');
      }

      // Step 4: Apply update
      const { error: upErr } = await (client.from('sets') as any)
        .update(patch)
        .eq('id', id);

      if (upErr) throw upErr;
      return {};
    }

    case 'set.delete': {
      const { id } = op.payload;
      const { error } = await (client.from('sets') as any).delete().eq('id', id);
      if (error) throw error;
      return {};
    }

    case 'nutrition.log': {
      const { incrementDishId, ...row } = op.payload;

      // Upsert with ignoreDuplicates on id, selecting 'id' to check insertion status
      const { data, error } = await (client.from('nutrition_logs') as any)
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
        .select('id');

      if (error) throw error;

      const insertedCount = Array.isArray(data) ? data.length : 0;
      if (insertedCount === 0) {
        // 0 rows = already applied = success
        return { alreadyApplied: true, canonicalId: row.id };
      }

      // Increment custom_dishes.use_count ONLY if exactly 1 row returned
      // use_count is a non-critical counter; if reading/updating fails, warn but do not fail the replay
      if (insertedCount === 1 && incrementDishId) {
        try {
          const { data: dishData, error: dishErr } = await (client.from('custom_dishes') as any)
            .select('use_count')
            .eq('id', incrementDishId)
            .maybeSingle();

          if (dishErr) {
            console.warn(`[replay] Failed to read custom_dishes use_count for dish ${incrementDishId}:`, dishErr);
          } else if (dishData) {
            const currentCount = typeof dishData.use_count === 'number' ? dishData.use_count : 0;
            const { error: incErr } = await (client.from('custom_dishes') as any)
              .update({ use_count: currentCount + 1 })
              .eq('id', incrementDishId);
            if (incErr) {
              console.warn(`[replay] Failed to update custom_dishes use_count for dish ${incrementDishId}:`, incErr);
            }
          }
        } catch (counterErr) {
          console.warn(`[replay] Unexpected error updating custom_dishes use_count for dish ${incrementDishId}:`, counterErr);
        }
      }

      return { canonicalId: row.id };
    }

    default:
      throw new Error(`Unknown op kind: ${(op as any).kind}`);
  }
}
