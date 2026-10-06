/**
 * Pure Personal Record (PR) Comparator and E1RM Calculator.
 *
 * Implements single source of truth for PR ranking across the application,
 * mirroring PostgreSQL get_exercise_benchmarks and get_exercise_stats RPCs exactly.
 * Decisions: PR ranking mode profile setting.
 */

export type PrMode = 'weight' | 'e1rm';

export interface PrSetCandidate {
  id?: string;
  weight: number;
  reps: number;
  date?: string;
  workout_date?: string;
  civil_date?: string;
  created_at?: string;
  set_index?: number;
}

/**
 * Calculates Estimated 1-Rep Max using the Epley formula: weight * (1 + reps / 30).
 * Bodyweight / zero-weight sets return 0.
 * Rounded to 2 decimal places to match PostgreSQL ROUND(..., 2) and avoid float drift.
 */
export function e1rm(weight: number, reps: number): number {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (w <= 0) return 0;
  if (r <= 0) return w;
  return Math.round(w * (1.0 + r / 30.0) * 100) / 100;
}

function extractDate(candidate: PrSetCandidate): string {
  return candidate.civil_date || candidate.workout_date || candidate.date || '';
}

/**
 * Compares two sets for PR ranking.
 * Returns negative if `a` is a better PR than `b` (comes first in descending ranking),
 * positive if `b` is better than `a`, and 0 if strictly tied on all criteria.
 *
 * Mode 'weight':
 *   weight DESC, reps DESC, date ASC, created_at ASC, set_index ASC, id ASC
 *
 * Mode 'e1rm':
 *   eligible DESC (weight <= 0 OR reps <= 12),
 *   (e1rm if eligible else weight) DESC,
 *   weight DESC, reps DESC, date ASC, created_at ASC, set_index ASC, id ASC
 *
 * Invariant: Exercise with only ineligible sets falls back to weight ranking by construction.
 */
export function comparePrSets<T extends PrSetCandidate>(a: T, b: T, mode: PrMode = 'weight'): number {
  const wA = Number(a.weight) || 0;
  const wB = Number(b.weight) || 0;
  const rA = Number(a.reps) || 0;
  const rB = Number(b.reps) || 0;

  if (mode === 'e1rm') {
    // 1. Eligibility: weighted sets with reps > 12 are excluded from e1RM ranking
    const eligibleA = wA <= 0 || rA <= 12;
    const eligibleB = wB <= 0 || rB <= 12;

    if (eligibleA !== eligibleB) {
      return eligibleA ? -1 : 1;
    }

    // 2. Score: e1rm if eligible else weight
    const scoreA = eligibleA ? (wA <= 0 ? 0 : e1rm(wA, rA)) : wA;
    const scoreB = eligibleB ? (wB <= 0 ? 0 : e1rm(wB, rB)) : wB;

    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
  }

  // 3. Weight DESC (tie-break for equal e1rm, or primary criterion in weight mode)
  if (wA !== wB) {
    return wB - wA;
  }

  // 4. Reps DESC (bodyweight ranking, or tie-break for equal weight)
  if (rA !== rB) {
    return rB - rA;
  }

  // 5. Date ASC (earlier workout date wins)
  const dateA = extractDate(a);
  const dateB = extractDate(b);
  if (dateA && dateB && dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }

  // 6. Created_at ASC (earlier creation timestamp wins)
  const createdA = a.created_at || '';
  const createdB = b.created_at || '';
  if (createdA && createdB && createdA !== createdB) {
    return createdA.localeCompare(createdB);
  }

  // 7. Set_index ASC (intra-session earlier set index wins)
  const idxA = a.set_index ?? 0;
  const idxB = b.set_index ?? 0;
  if (idxA !== idxB) {
    return idxA - idxB;
  }

  // 8. ID ASC (deterministic tie-break)
  const idA = a.id || '';
  const idB = b.id || '';
  return idA.localeCompare(idB);
}

/**
 * Selects the winning PR set from an array of candidates.
 * Returns null if the array is empty.
 */
export function pickPrSet<T extends PrSetCandidate>(sets: T[], mode: PrMode = 'weight'): T | null {
  if (!sets || sets.length === 0) return null;
  let best = sets[0];
  for (let i = 1; i < sets.length; i++) {
    if (comparePrSets(sets[i], best, mode) < 0) {
      best = sets[i];
    }
  }
  return best;
}
