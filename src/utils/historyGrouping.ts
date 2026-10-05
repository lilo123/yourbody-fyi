import type { WorkoutSet, Exercise } from '../types/database';
import { resolveExerciseLabel } from './exerciseLabel';

export interface ExerciseGroup<T = WorkoutSet & { workout_date?: string; workout_name?: string }> {
  exerciseId: string;
  exerciseName: string;
  bodyPart: string;
  sets: T[];
  totalVolume: number;
}

export function groupSessionSetsByExercise<T extends {
  id?: string;
  exercise_id?: string;
  exercise_name?: string;
  weight?: number;
  reps?: number;
  set_index?: number | null;
  created_at?: string;
}>(
  sets: T[],
  exercises: Exercise[]
): ExerciseGroup<T>[] {
  const groups: ExerciseGroup<T>[] = [];
  const groupMap = new Map<string, ExerciseGroup<T>>();

  sets.forEach((set) => {
    const rawExId = set.exercise_id || '';
    const rawExName = set.exercise_name || (set as any).exercise?.name || '';
    const matched = exercises.find(
      (e) =>
        (rawExId && (e.id === rawExId || e.name.toLowerCase() === rawExId.toLowerCase())) ||
        (rawExName && e.name.toLowerCase() === rawExName.toLowerCase())
    );
    // Group by the resolved name when the exercise is known, which is what this function has
    // always done -- two rows sharing a name (a custom duplicate of a master exercise, say) must
    // stay a single card. Unresolved sets key on the raw id instead: their label collapses to
    // "Unknown Exercise", so keying on the label would merge unrelated exercises into one group.
    const groupKey = matched ? matched.name : rawExId || rawExName || 'unknown';
    const exName = resolveExerciseLabel(
      matched ? matched.name : rawExName || rawExId,
      'Unknown Exercise'
    );
    const bodyPart = (matched?.body_parts && matched.body_parts.length > 0) ? matched.body_parts[0] : 'Other';
    const volume = (Number(set.weight) || 0) * (Number(set.reps) || 0);

    if (!groupMap.has(groupKey)) {
      const group: ExerciseGroup<T> = {
        exerciseId: rawExId || (matched ? matched.id : groupKey),
        exerciseName: exName,
        bodyPart,
        sets: [],
        totalVolume: 0,
      };
      groupMap.set(groupKey, group);
      groups.push(group);
    }

    const group = groupMap.get(groupKey)!;
    group.sets.push(set);
    group.totalVolume += volume;
  });

  groups.forEach((g) => {
    g.sets.sort((a, b) => {
      const idxDiff = (a.set_index ?? 0) - (b.set_index ?? 0);
      if (idxDiff !== 0) return idxDiff;
      if (a.created_at && b.created_at) return a.created_at.localeCompare(b.created_at);
      return 0;
    });
  });

  // Track encounter order for stable sort tie-breaking (D-YB-8)
  const groupEncounterIndex = new Map<ExerciseGroup<T>, number>();
  groups.forEach((g, idx) => {
    groupEncounterIndex.set(g, idx);
  });

  // Helper to extract earliest valid timestamp (ms) among sets in a group
  const getEarliestTimestamp = (group: ExerciseGroup<T>): number | null => {
    let earliest: number | null = null;
    for (const s of group.sets) {
      if (!s.created_at || typeof s.created_at !== 'string') continue;
      try {
        const time = Date.parse(s.created_at);
        if (!Number.isNaN(time)) {
          if (earliest === null || time < earliest) {
            earliest = time;
          }
        }
      } catch {
        // Fall back gracefully on unparseable dates; never throw
      }
    }
    return earliest;
  };

  // Order exercise groups by the EARLIEST created_at among the sets the card shows (working sets),
  // oldest first. Stable sort: ties (e.g. batchCreate) keep encounter order. Missing/invalid created_at
  // falls back to encounter order and never throws.
  groups.sort((a, b) => {
    const timeA = getEarliestTimestamp(a);
    const timeB = getEarliestTimestamp(b);
    const idxA = groupEncounterIndex.get(a) ?? 0;
    const idxB = groupEncounterIndex.get(b) ?? 0;

    if (timeA !== null && timeB !== null) {
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return idxA - idxB;
    }
    if (timeA !== null && timeB === null) {
      return -1;
    }
    if (timeA === null && timeB !== null) {
      return 1;
    }
    return idxA - idxB;
  });

  return groups;
}
