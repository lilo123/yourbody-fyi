/**
 * Sets & Workouts Data Layer Writers
 *
 * Guarantees:
 * 1. Sets are always resolved and written by exercise_id UUID (never by name).
 * 2. Next set_index is derived as max(set_index)+1 from existing sets.
 * 3. Workouts are strictly scoped to the user's local civil date (YYYY-MM-DD).
 * 4. Concurrent getOrCreateWorkout calls safely resolve to a single row via
 *    The unique (user_id, workout_date) constraint and select-after-23505 recovery.
 * 5. All production writes route through durable outbox (enqueueAndAwait)
 *    with optimistic local representation and automatic background sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  enqueueAndAwait,
  getOutboxOps,
  newId,
  getActiveUserId,
  classifyError,
  type SetTypeKind,
  type SetPatchFields,
} from '../offline';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

export interface InsertSetPayload {
  id?: string;
  workoutId?: string;
  createdAt?: string;
  exerciseId: string;
  weight: number;
  reps: number;
  setIndex?: number;
  setType?: 'working' | 'warmup' | 'drop';
  rpe?: number | null;
  workoutDate?: string;
  targetUserId?: string;
}

export interface LoggedSetResult {
  id: string;
  workout_id: string;
  exercise_id: string;
  weight: number;
  reps: number;
  set_index: number;
  set_type: string;
  rpe: number | null;
  created_at: string;
  pending?: boolean;
  civil_date?: string;
  workout_date?: string;
}

/**
 * Derives the next set_index as max(set_index) + 1 from logged sets.
 * Prevents duplicate set_index when earlier sets in the session were deleted.
 */
export function getNextSetIndex(existingSets: Array<{ set_index?: number | null }>): number {
  if (!existingSets || existingSets.length === 0) return 1;
  let maxIndex = 0;
  for (const s of existingSets) {
    const idx = Number(s?.set_index);
    if (!isNaN(idx) && idx > maxIndex) {
      maxIndex = idx;
    }
  }
  return maxIndex + 1;
}

/**
 * Resolves a stable workout reference (UUID) for a given user and civil date.
 * If server workout ID is available in cache, returns it.
 * Otherwise returns a client-generated workout UUID stored in localStorage and enqueues workout.ensure.
 */
export async function resolveWorkoutRefForDate(
  userId: string,
  workoutDate: string,
  routineName: string = 'Free Workout',
  cachedServerId?: string
): Promise<string> {
  if (cachedServerId && isUUID(cachedServerId)) {
    return cachedServerId;
  }

  // 1. Check outbox for pending workout.ensure for this user & date
  try {
    const ops = await getOutboxOps(userId);
    const ensureOp = ops.find(
      (op) => op.kind === 'workout.ensure' && op.payload.workout_date === workoutDate
    );
    if (ensureOp && ensureOp.kind === 'workout.ensure' && ensureOp.payload.clientWorkoutId) {
      return ensureOp.payload.clientWorkoutId;
    }
  } catch {}

  // 2. Check localStorage for previously generated client workout id on this device
  const storageKey = `yourbody_client_workout_${userId}_${workoutDate}`;
  let clientWorkoutId: string | null = null;
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && isUUID(stored)) {
        clientWorkoutId = stored;
      }
    } catch {}
  }

  // 3. Generate a new client workout id if not already created
  if (!clientWorkoutId) {
    clientWorkoutId = newId();
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageKey, clientWorkoutId);
      } catch {}
    }
  }

  await enqueueAndAwait({
    userId,
    kind: 'workout.ensure',
    payload: {
      clientWorkoutId,
      workout_date: workoutDate,
      name: routineName,
    },
  });

  return clientWorkoutId;
}

/**
 * Gets or creates the unique workout session row for a user on a given civil date.
 * Handles concurrent insert races (PostgreSQL error 23505) by recovering the existing row.
 */
export async function getOrCreateWorkout(
  client: SupabaseClient,
  userId: string,
  workoutDate: string,
  routineName: string = 'Free Workout'
): Promise<string> {
  if (!userId) throw new Error('Authenticated user required to log workout');
  if (!workoutDate) throw new Error('Workout date required');

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return resolveWorkoutRefForDate(userId, workoutDate, routineName);
  }

  // 1. Check if workout session already exists for this civil date (local day bounds)
  const startOfDay = `${workoutDate}T00:00:00.000Z`;
  const endOfDay = `${workoutDate}T23:59:59.999Z`;

  async function findWorkoutSession(): Promise<{ data: { id: string } | null; error?: any }> {
    const primary = await client
      .from('workouts')
      .select('id')
      .eq('user_id', userId)
      .eq('workout_date', workoutDate)
      .limit(1)
      .maybeSingle();

    if (!primary.error) {
      return primary;
    }

    const errCode = String(primary.error?.code || '');
    const isMissingColumn =
      errCode.includes('PGRST') ||
      errCode === '42703' ||
      primary.error?.message?.includes('workout_date');

    if (isMissingColumn) {
      return await client
        .from('workouts')
        .select('id')
        .eq('user_id', userId)
        .gte('date', startOfDay)
        .lte('date', endOfDay)
        .limit(1)
        .maybeSingle();
    }

    return primary;
  }

  try {
    const { data: existingWorkout, error: findError } = await findWorkoutSession();
    if (findError) {
      const classified = classifyError(findError);
      if (classified.kind === 'TRANSIENT') {
        return await resolveWorkoutRefForDate(userId, workoutDate, routineName);
      }
      throw findError;
    }

    if (existingWorkout?.id) {
      return existingWorkout.id;
    }

    // 2. Insert new workout row if none exists
    const insertPayload: Record<string, any> = {
      user_id: userId,
      name: routineName,
      date: workoutDate,
      workout_date: workoutDate,
    };

    let { data: newWorkout, error: insertError } = await client
      .from('workouts')
      .insert([insertPayload])
      .select('id')
      .single();

    if (
      insertError &&
      (insertError.code === 'PGRST204' ||
        insertError.code === '42703' ||
        String(insertError.code).includes('PGRST') ||
        insertError.message?.includes('workout_date'))
    ) {
      delete insertPayload.workout_date;
      const retry = await client
        .from('workouts')
        .insert([insertPayload])
        .select('id')
        .single();
      newWorkout = retry.data;
      insertError = retry.error;
    }

    // 3. Handle concurrent creation collision (23505 unique constraint violation)
    if (insertError) {
      const isConflict =
        insertError.code === '23505' ||
        insertError.message?.includes('duplicate key') ||
        insertError.message?.includes('unique constraint');

      if (isConflict) {
        const { data: winningWorkout } = await findWorkoutSession();

        if (winningWorkout?.id) {
          return winningWorkout.id;
        }
      }

      const classified = classifyError(insertError);
      if (classified.kind === 'TRANSIENT') {
        return await resolveWorkoutRefForDate(userId, workoutDate, routineName);
      }

      throw insertError;
    }

    if (!newWorkout?.id) {
      throw new Error('Failed to create workout: no ID returned');
    }

    return newWorkout.id;
  } catch (err: any) {
    const classified = classifyError(err);
    if (classified.kind === 'TRANSIENT') {
      return await resolveWorkoutRefForDate(userId, workoutDate, routineName);
    }
    throw err;
  }
}

/**
 * Inserts a single set record into the sets table, resolved strictly by exercise_id UUID.
 * Routes through durable outbox (enqueueAndAwait) when offline or in standard client mode.
 */
export async function insertSet(
  _client: SupabaseClient,
  workoutId: string,
  payload: InsertSetPayload,
  userId?: string
): Promise<LoggedSetResult> {
  if (!workoutId) throw new Error('workoutId is required');
  if (!payload.exerciseId) throw new Error('exerciseId UUID is required');

  const setId = payload.id || newId();
  const captureTime = payload.createdAt || new Date().toISOString();
  const effectiveUserId = userId || payload.targetUserId || getActiveUserId() || '';

  const result = await enqueueAndAwait({
    userId: effectiveUserId,
    kind: 'set.create',
    payload: {
      id: setId,
      workoutRef: workoutId,
      exercise_id: payload.exerciseId,
      weight: payload.weight,
      reps: payload.reps,
      set_index: payload.setIndex ?? 1,
      set_type: (payload.setType as SetTypeKind) || 'working',
      rpe: payload.rpe ?? null,
      created_at: captureTime,
    },
  });

  return {
    id: setId,
    workout_id: workoutId,
    exercise_id: payload.exerciseId,
    weight: payload.weight,
    reps: payload.reps,
    set_index: payload.setIndex ?? 1,
    set_type: payload.setType || 'working',
    rpe: payload.rpe ?? null,
    created_at: captureTime,
    pending: result.status === 'queued',
    workout_date: payload.workoutDate,
    civil_date: payload.workoutDate,
  };
}

/**
 * Batch inserts multiple sets into the sets table.
 */
export async function batchInsertSets(
  _client: SupabaseClient,
  workoutId: string,
  payloads: InsertSetPayload[],
  userId?: string
): Promise<LoggedSetResult[]> {
  if (!workoutId) throw new Error('workoutId is required');
  if (payloads.length === 0) return [];

  for (const p of payloads) {
    if (!p.exerciseId) throw new Error('exerciseId UUID is required for each set');
  }

  const effectiveUserId = userId || payloads[0]?.targetUserId || getActiveUserId() || '';

  const batchItems = payloads.map((p) => {
    const setId = p.id || newId();
    const captureTime = p.createdAt || new Date().toISOString();
    return {
      id: setId,
      exercise_id: p.exerciseId,
      weight: p.weight,
      reps: p.reps,
      set_index: p.setIndex ?? 1,
      set_type: (p.setType as SetTypeKind) || 'working',
      rpe: p.rpe ?? null,
      created_at: captureTime,
      workoutDate: p.workoutDate,
    };
  });

  const res = await enqueueAndAwait({
    userId: effectiveUserId,
    kind: 'set.batchCreate',
    payload: {
      workoutRef: workoutId,
      sets: batchItems.map((item) => ({
        id: item.id,
        exercise_id: item.exercise_id,
        weight: item.weight,
        reps: item.reps,
        set_index: item.set_index,
        set_type: item.set_type,
        rpe: item.rpe,
        created_at: item.created_at,
      })),
    },
  });

  return batchItems.map((item) => ({
    id: item.id,
    workout_id: workoutId,
    exercise_id: item.exercise_id,
    weight: item.weight,
    reps: item.reps,
    set_index: item.set_index,
    set_type: item.set_type,
    rpe: item.rpe,
    created_at: item.created_at,
    pending: res.status === 'queued',
    workout_date: item.workoutDate,
    civil_date: item.workoutDate,
  }));
}

/**
 * Updates an existing set record.
 */
export async function updateSet(
  _client: SupabaseClient,
  setId: string,
  updates: Partial<InsertSetPayload>,
  expected?: SetPatchFields,
  userId?: string
): Promise<LoggedSetResult> {
  if (!setId) throw new Error('setId is required');
  const patch: SetPatchFields = {};
  if (updates.weight !== undefined) patch.weight = updates.weight;
  if (updates.reps !== undefined) patch.reps = updates.reps;
  if (updates.setIndex !== undefined) patch.set_index = updates.setIndex;
  if (updates.setType !== undefined) patch.set_type = updates.setType as SetTypeKind;
  if (updates.rpe !== undefined) patch.rpe = updates.rpe;
  if (updates.exerciseId !== undefined) patch.exercise_id = updates.exerciseId;

  const effectiveUserId = userId || updates.targetUserId || getActiveUserId() || '';

  const res = await enqueueAndAwait(
    {
      userId: effectiveUserId,
      kind: 'set.update',
      payload: {
        id: setId,
        patch,
        expected,
      },
    },
    { timeoutMs: 2500 }
  );

  return {
    id: setId,
    workout_id: updates.workoutId || '',
    exercise_id: updates.exerciseId || '',
    weight: updates.weight ?? 0,
    reps: updates.reps ?? 0,
    set_index: updates.setIndex ?? 1,
    set_type: updates.setType || 'working',
    rpe: updates.rpe ?? null,
    created_at: new Date().toISOString(),
    pending: res.status === 'queued',
  };
}

/**
 * Deletes a set record by ID.
 */
export async function deleteSet(
  _client: SupabaseClient,
  setId: string,
  optionsOrUserId?: string | { workoutDate?: string; targetUserId?: string }
): Promise<void> {
  if (!setId) throw new Error('setId is required');

  const targetUserId =
    typeof optionsOrUserId === 'string'
      ? optionsOrUserId
      : optionsOrUserId?.targetUserId || getActiveUserId() || '';

  await enqueueAndAwait({
    userId: targetUserId,
    kind: 'set.delete',
    payload: { id: setId },
  });
}
