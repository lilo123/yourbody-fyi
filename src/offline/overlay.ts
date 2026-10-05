import type { WorkoutSet } from '../types/database';
import type { HistorySession } from '../components/history/useWorkoutHistory';
import type { OutboxOp, OutboxOpNutritionLog } from './types';

/**
 * Pure function: applies pending outbox operations to today's server sets.
 * Marks overlaid entities with `pending: true`.
 */
export function applyPendingToDaySets(
  serverSets: WorkoutSet[],
  ops: OutboxOp[],
  targetDate: string
): (WorkoutSet & { pending?: boolean })[] {
  const result: (WorkoutSet & { pending?: boolean })[] = serverSets.map((s) => ({
    ...s,
    pending: false,
  }));

  // Build maps of workout ensure & rename
  const workoutDateMap = new Map<string, string>();
  const workoutNameMap = new Map<string, string>();

  for (const op of ops) {
    if (op.kind === 'workout.ensure') {
      workoutDateMap.set(op.payload.clientWorkoutId, op.payload.workout_date);
      if (op.payload.name) {
        workoutNameMap.set(op.payload.clientWorkoutId, op.payload.name);
      }
    } else if (op.kind === 'workout.rename') {
      workoutNameMap.set(op.payload.workoutRef, op.payload.name);
    }
  }

  // Filter ops by order of seq
  const sortedOps = [...ops].sort((a, b) => a.seq - b.seq);

  for (const op of sortedOps) {
    if (op.kind === 'set.create') {
      const { id, workoutRef, exercise_id, weight, reps, set_index, set_type, rpe, created_at } =
        op.payload;
      const opDate = workoutDateMap.get(workoutRef) || created_at.slice(0, 10);

      if (opDate === targetDate) {
        const workoutName = workoutNameMap.get(workoutRef);
        const newSet: WorkoutSet & { pending: boolean } = {
          id,
          workout_id: workoutRef,
          exercise_id,
          weight,
          reps,
          set_index,
          set_type: set_type || 'working',
          rpe: rpe ?? null,
          created_at,
          workout_date: targetDate,
          workout_name: workoutName,
          pending: true,
        };
        const existingIdx = result.findIndex((s) => s.id === id);
        if (existingIdx !== -1) {
          result[existingIdx] = {
            ...result[existingIdx],
            ...newSet,
          };
        } else {
          result.push(newSet);
        }
      }
    } else if (op.kind === 'set.batchCreate') {
      const { workoutRef, sets } = op.payload;
      for (const s of sets) {
        const opDate = workoutDateMap.get(workoutRef) || s.created_at.slice(0, 10);
        if (opDate === targetDate) {
          const workoutName = workoutNameMap.get(workoutRef);
          const newSet: WorkoutSet & { pending: boolean } = {
            id: s.id,
            workout_id: workoutRef,
            exercise_id: s.exercise_id,
            weight: s.weight,
            reps: s.reps,
            set_index: s.set_index,
            set_type: s.set_type || 'working',
            rpe: s.rpe ?? null,
            created_at: s.created_at,
            workout_date: targetDate,
            workout_name: workoutName,
            pending: true,
          };
          const existingIdx = result.findIndex((existing) => existing.id === s.id);
          if (existingIdx !== -1) {
            result[existingIdx] = {
              ...result[existingIdx],
              ...newSet,
            };
          } else {
            result.push(newSet);
          }
        }
      }
    } else if (op.kind === 'set.update') {
      const { id, patch } = op.payload;
      const idx = result.findIndex((s) => s.id === id);
      if (idx !== -1) {
        result[idx] = {
          ...result[idx],
          ...patch,
          pending: true,
        };
      }
    } else if (op.kind === 'set.delete') {
      const { id } = op.payload;
      const idx = result.findIndex((s) => s.id === id);
      if (idx !== -1) {
        result.splice(idx, 1);
      }
    } else if (op.kind === 'workout.rename') {
      const { workoutRef, name } = op.payload;
      for (let i = 0; i < result.length; i++) {
        if (result[i].workout_id === workoutRef) {
          result[i] = {
            ...result[i],
            workout_name: name,
            pending: true,
          };
        }
      }
    }
  }

  return result.sort((a, b) => a.set_index - b.set_index);
}

/**
 * Pure function: extracts pending created/updated sets occurring strictly before `targetDate`.
 * Used as input for `computeGhostSets` and PR benchmark calculation.
 */
export function pendingSetsBefore(
  targetDate: string,
  ops: OutboxOp[]
): (WorkoutSet & { workout_date: string; pending: boolean })[] {
  const workoutDateMap = new Map<string, string>();
  for (const op of ops) {
    if (op.kind === 'workout.ensure') {
      workoutDateMap.set(op.payload.clientWorkoutId, op.payload.workout_date);
    }
  }

  const setMap = new Map<string, WorkoutSet & { workout_date: string; pending: boolean }>();
  const sortedOps = [...ops].sort((a, b) => a.seq - b.seq);

  for (const op of sortedOps) {
    if (op.kind === 'set.create') {
      const { id, workoutRef, exercise_id, weight, reps, set_index, set_type, rpe, created_at } =
        op.payload;
      const setDate = workoutDateMap.get(workoutRef) || created_at.slice(0, 10);
      if (setDate < targetDate) {
        setMap.set(id, {
          id,
          workout_id: workoutRef,
          exercise_id,
          weight,
          reps,
          set_index,
          set_type: set_type || 'working',
          rpe: rpe ?? null,
          created_at,
          workout_date: setDate,
          pending: true,
        });
      }
    } else if (op.kind === 'set.batchCreate') {
      const { workoutRef, sets } = op.payload;
      for (const s of sets) {
        const setDate = workoutDateMap.get(workoutRef) || s.created_at.slice(0, 10);
        if (setDate < targetDate) {
          setMap.set(s.id, {
            id: s.id,
            workout_id: workoutRef,
            exercise_id: s.exercise_id,
            weight: s.weight,
            reps: s.reps,
            set_index: s.set_index,
            set_type: s.set_type || 'working',
            rpe: s.rpe ?? null,
            created_at: s.created_at,
            workout_date: setDate,
            pending: true,
          });
        }
      }
    } else if (op.kind === 'set.update') {
      const { id, patch } = op.payload;
      const existing = setMap.get(id);
      if (existing) {
        setMap.set(id, {
          ...existing,
          ...patch,
          pending: true,
        });
      }
    } else if (op.kind === 'set.delete') {
      setMap.delete(op.payload.id);
    }
  }

  return Array.from(setMap.values());
}

/**
 * Pure function: applies pending operations to history session list.
 * Injects synthetic sessions for offline workouts or updates volume/set counts for existing sessions.
 */
export function applyPendingToHistory(
  sessions: HistorySession[],
  ops: OutboxOp[]
): (HistorySession & { pending?: boolean })[] {
  if (!ops || ops.length === 0) {
    return sessions;
  }

  const result: (HistorySession & { pending?: boolean })[] = sessions.map((s) => ({
    ...s,
    pending: false,
  }));

  const workoutDateMap = new Map<string, string>();
  const workoutNameMap = new Map<string, string>();

  for (const op of ops) {
    if (op.kind === 'workout.ensure') {
      workoutDateMap.set(op.payload.clientWorkoutId, op.payload.workout_date);
      if (op.payload.name) {
        workoutNameMap.set(op.payload.clientWorkoutId, op.payload.name);
      }
    } else if (op.kind === 'workout.rename') {
      workoutNameMap.set(op.payload.workoutRef, op.payload.name);
    }
  }

  // Group pending set actions by date
  interface PendingDaySummary {
    workoutRef?: string;
    date: string;
    name?: string;
    createdSets: { id: string; weight: number; reps: number; set_type: string }[];
    updatedSets: Map<string, { weight?: number; reps?: number }>;
    deletedSetIds: Set<string>;
  }

  const daySummaries = new Map<string, PendingDaySummary>();

  function getSummary(date: string, workoutRef?: string): PendingDaySummary {
    let summary = daySummaries.get(date);
    if (!summary) {
      summary = {
        workoutRef,
        date,
        name: workoutRef ? workoutNameMap.get(workoutRef) : undefined,
        createdSets: [],
        updatedSets: new Map(),
        deletedSetIds: new Set(),
      };
      daySummaries.set(date, summary);
    }
    if (workoutRef && !summary.workoutRef) {
      summary.workoutRef = workoutRef;
    }
    return summary;
  }

  const sortedOps = [...ops].sort((a, b) => a.seq - b.seq);

  for (const op of sortedOps) {
    if (op.kind === 'workout.ensure') {
      const summary = getSummary(op.payload.workout_date, op.payload.clientWorkoutId);
      if (op.payload.name) summary.name = op.payload.name;
    } else if (op.kind === 'set.create') {
      const date = workoutDateMap.get(op.payload.workoutRef) || op.payload.created_at.slice(0, 10);
      const summary = getSummary(date, op.payload.workoutRef);
      summary.createdSets.push({
        id: op.payload.id,
        weight: op.payload.weight,
        reps: op.payload.reps,
        set_type: op.payload.set_type || 'working',
      });
    } else if (op.kind === 'set.batchCreate') {
      const { workoutRef, sets } = op.payload;
      for (const s of sets) {
        const date = workoutDateMap.get(workoutRef) || s.created_at.slice(0, 10);
        const summary = getSummary(date, workoutRef);
        summary.createdSets.push({
          id: s.id,
          weight: s.weight,
          reps: s.reps,
          set_type: s.set_type || 'working',
        });
      }
    } else if (op.kind === 'set.update') {
      // Find which summary has this set
      for (const summary of daySummaries.values()) {
        const found = summary.createdSets.find((s) => s.id === op.payload.id);
        if (found) {
          if (op.payload.patch.weight !== undefined) found.weight = op.payload.patch.weight;
          if (op.payload.patch.reps !== undefined) found.reps = op.payload.patch.reps;
          if (op.payload.patch.set_type !== undefined) found.set_type = op.payload.patch.set_type;
          break;
        }
      }
    } else if (op.kind === 'set.delete') {
      for (const summary of daySummaries.values()) {
        const idx = summary.createdSets.findIndex((s) => s.id === op.payload.id);
        if (idx !== -1) {
          summary.createdSets.splice(idx, 1);
        } else {
          summary.deletedSetIds.add(op.payload.id);
        }
      }
    } else if (op.kind === 'workout.rename') {
      for (const summary of daySummaries.values()) {
        if (summary.workoutRef === op.payload.workoutRef) {
          summary.name = op.payload.name;
        }
      }
    }
  }

  // Now apply summaries to sessions
  for (const [date, summary] of daySummaries.entries()) {
    const existingIdx = result.findIndex(
      (s) => s.workout_date === date || s.civil_date === date || s.date.startsWith(date)
    );

    if (existingIdx !== -1) {
      const session = { ...result[existingIdx] };
      let deltaSets = summary.createdSets.length - summary.deletedSetIds.size;
      let deltaVolume = 0;
      for (const s of summary.createdSets) {
        if (s.set_type === 'working') {
          deltaVolume += (s.weight || 0) * (s.reps || 0);
        }
      }
      session.set_count = Math.max(0, session.set_count + deltaSets);
      session.total_volume = Math.max(0, session.total_volume + deltaVolume);
      if (summary.name) {
        session.name = summary.name;
      }
      session.pending = true;
      result[existingIdx] = session;
    } else if (summary.createdSets.length > 0) {
      // Create synthetic session
      let volume = 0;
      for (const s of summary.createdSets) {
        if (s.set_type === 'working') {
          volume += (s.weight || 0) * (s.reps || 0);
        }
      }
      result.push({
        id: summary.workoutRef || `offline-session-${date}`,
        date: `${date}T12:00:00.000Z`,
        workout_date: date,
        civil_date: date,
        name: summary.name || 'Workout',
        set_count: summary.createdSets.length,
        total_volume: volume,
        pending: true,
      });
    }
  }

  return result.sort((a, b) => {
    const dateA = a.workout_date || a.civil_date || a.date;
    const dateB = b.workout_date || b.civil_date || b.date;
    return dateB.localeCompare(dateA);
  });
}

export interface OverlayNutritionLogsOptions {
  date?: string;
  userId?: string;
}

/**
 * Pure function: applies pending nutrition.log outbox operations to nutrition logs.
 * Dedupes by id (pending replaces server log) and marks overlaid entities with `pending: true`.
 * If options.date is provided, filters pending ops to that civil date.
 * If options.userId is provided, filters pending ops to that user.
 */
export function applyPendingToNutritionLogs<
  T extends { id: string; logged_at?: string; logged_date?: string | null }
>(
  serverLogs: T[],
  pendingOps: OutboxOp[],
  options?: OverlayNutritionLogsOptions
): (T & { pending?: boolean })[] {
  const targetUserId = options?.userId;
  const targetDate = options?.date;

  const nutritionOps = pendingOps.filter(
    (op): op is OutboxOpNutritionLog =>
      op.kind === 'nutrition.log' &&
      (!targetUserId || op.userId === targetUserId) &&
      (!targetDate || op.payload.logged_date === targetDate)
  );

  if (nutritionOps.length === 0) {
    return serverLogs.map((log) => ({ ...log, pending: false }));
  }

  // Index existing server logs with pending: false
  const logMap = new Map<string, T & { pending?: boolean }>();
  for (const log of serverLogs) {
    logMap.set(log.id, { ...log, pending: false });
  }

  // Sort pending ops by seq ascending so later ops overwrite earlier
  const sortedOps = [...nutritionOps].sort((a, b) => a.seq - b.seq);

  for (const op of sortedOps) {
    const payload = op.payload;
    const existing = logMap.get(payload.id);
    const syntheticLog: any = {
      ...(existing || {}),
      ...payload,
      has_components: Array.isArray(payload.items) && payload.items.length >= 2,
      created_at: op.createdAt,
      pending: true,
    };
    logMap.set(payload.id, syntheticLog);
  }

  const result = Array.from(logMap.values());

  // Sort descending by civil date / logged_at
  return result.sort((a, b) => {
    const dateA = a.logged_date || (a.logged_at ? a.logged_at.slice(0, 10) : '');
    const dateB = b.logged_date || (b.logged_at ? b.logged_at.slice(0, 10) : '');
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    const timeA = a.logged_at || '';
    const timeB = b.logged_at || '';
    return timeB.localeCompare(timeA);
  });
}
