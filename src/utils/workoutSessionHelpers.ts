import type { ActiveWorkoutSession } from './workoutSessionStore';

export const SESSION_PREFIX = 'yourbody_active_session_';
export const POINTER_PREFIX = 'yourbody_current_session_pointer_';
export const DRAFT_EXERCISES_PREFIX = 'yourbody_active_exercises_';
export const ROUTINE_PREFIX = 'yourbody_routine_';
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Renames an exercise across all active workout sessions for a user (shim for L39 / backward compatibility).
 */
export function renameExerciseInSessions(
  userId: string,
  oldName: string,
  newName: string,
  saveSessionFn: (session: ActiveWorkoutSession, setPointer?: boolean) => void,
  pendingDraftsMap: Map<string, any>
): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined' || !userId || !oldName || !newName) {
    return;
  }
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return;

  const prefix = `${SESSION_PREFIX}${userId}_`;
  const keysToUpdate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keysToUpdate.push(key);
    }
  }

  const matchesOld = (name: string) => name === oldName || name === trimmedOld;

  for (const key of keysToUpdate) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session: ActiveWorkoutSession = JSON.parse(raw);
      if (!session || session.schemaVersion !== 1) continue;

      let changed = false;

      // Update exercises array
      if (Array.isArray(session.exercises) && session.exercises.some(matchesOld)) {
        session.exercises = session.exercises.map((n) => (matchesOld(n) ? trimmedNew : n));
        changed = true;
      }

      // Migrate targetSetCounts
      const oldSetKey = session.targetSetCounts
        ? session.targetSetCounts[oldName] !== undefined
          ? oldName
          : session.targetSetCounts[trimmedOld] !== undefined
          ? trimmedOld
          : null
        : null;
      if (oldSetKey && session.targetSetCounts) {
        session.targetSetCounts[trimmedNew] = session.targetSetCounts[oldSetKey];
        delete session.targetSetCounts[oldSetKey];
        changed = true;
      }

      // Migrate targetRepCounts
      const oldRepKey = session.targetRepCounts
        ? session.targetRepCounts[oldName] !== undefined
          ? oldName
          : session.targetRepCounts[trimmedOld] !== undefined
          ? trimmedOld
          : null
        : null;
      if (oldRepKey && session.targetRepCounts) {
        session.targetRepCounts[trimmedNew] = session.targetRepCounts[oldRepKey];
        delete session.targetRepCounts[oldRepKey];
        changed = true;
      }

      // Migrate expandedExercises
      if (Array.isArray(session.expandedExercises) && session.expandedExercises.some(matchesOld)) {
        session.expandedExercises = session.expandedExercises.map((n) => (matchesOld(n) ? trimmedNew : n));
        changed = true;
      }

      // Re-key inputDrafts: `${oldName}_${idx}` -> `${newName}_${idx}`
      if (session.inputDrafts) {
        const draftKeys = Object.keys(session.inputDrafts);
        for (const dKey of draftKeys) {
          let matchedPrefix: string | null = null;
          if (dKey.startsWith(`${oldName}_`)) {
            matchedPrefix = `${oldName}_`;
          } else if (dKey.startsWith(`${trimmedOld}_`)) {
            matchedPrefix = `${trimmedOld}_`;
          }

          if (matchedPrefix) {
            const setSuffix = dKey.slice(matchedPrefix.length);
            if (/^\d+$/.test(setSuffix)) {
              session.inputDrafts[`${trimmedNew}_${setSuffix}`] = session.inputDrafts[dKey];
              delete session.inputDrafts[dKey];
              changed = true;
            }
          }
        }
      }

      if (changed) {
        saveSessionFn(session, false);
      }
    } catch {
      // Ignore corrupted entries
    }
  }

  // Migrate pending in-memory drafts
  const pendingKeys = Array.from(pendingDraftsMap.keys());
  for (const qKey of pendingKeys) {
    const item = pendingDraftsMap.get(qKey);
    if (item && item.userId === userId && (item.exName === oldName || item.exName === trimmedOld)) {
      pendingDraftsMap.delete(qKey);
      const newQKey = `${item.userId}::${item.date}::${trimmedNew}_${item.setIndex}`;
      pendingDraftsMap.set(newQKey, { ...item, exName: trimmedNew });
    }
  }
}
