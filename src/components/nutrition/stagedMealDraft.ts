import type { StagedMeal } from './nutritionEngineHelpers';

export const STAGED_MEAL_STORAGE_PREFIX = 'yourbody_staged_meal_';

export interface StagedMealDraftEnvelope {
  userId: string;
  date: string;
  meal: StagedMeal;
}

export function getStagedMealStorageKey(userId: string): string {
  return `${STAGED_MEAL_STORAGE_PREFIX}${userId}`;
}

export function loadStagedMealDraft(
  userId: string | undefined | null,
  todayDateStr: string
): StagedMeal | null {
  if (!userId || !todayDateStr) return null;
  if (typeof window === 'undefined' || !window.sessionStorage) return null;

  const key = getStagedMealStorageKey(userId);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw) as StagedMealDraftEnvelope;
    if (!envelope || typeof envelope !== 'object') {
      window.sessionStorage.removeItem(key);
      return null;
    }

    // Multi-user isolation invariant: never show another user's draft
    if (envelope.userId !== userId) {
      return null;
    }

    // Civil day partition invariant: drop and evict stale-day drafts
    if (envelope.date !== todayDateStr) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    // Must be a valid staged meal with at least one item
    if (
      !envelope.meal ||
      typeof envelope.meal !== 'object' ||
      !Array.isArray(envelope.meal.items) ||
      envelope.meal.items.length === 0
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return envelope.meal;
  } catch {
    // Corrupt JSON or storage access errors are safely evicted and swallowed
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }
}

export function saveStagedMealDraft(
  userId: string | undefined | null,
  todayDateStr: string,
  meal: StagedMeal | null
): void {
  if (!userId) return;
  if (typeof window === 'undefined' || !window.sessionStorage) return;

  const key = getStagedMealStorageKey(userId);
  if (!meal || !Array.isArray(meal.items) || meal.items.length === 0) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }

  try {
    const envelope: StagedMealDraftEnvelope = {
      userId,
      date: todayDateStr,
      meal,
    };
    window.sessionStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Retry once without photoUrl to avoid storage QuotaExceededError from large base64 data URLs
    try {
      const mealWithoutPhoto = { ...meal };
      delete mealWithoutPhoto.photoUrl;
      const envelopeWithoutPhoto: StagedMealDraftEnvelope = {
        userId,
        date: todayDateStr,
        meal: mealWithoutPhoto,
      };
      window.sessionStorage.setItem(key, JSON.stringify(envelopeWithoutPhoto));
    } catch {
      // If retry without photoUrl also throws, evict key so stale draft does not resurrect
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }
}

export function clearStagedMealDraft(userId: string | undefined | null): void {
  if (!userId) return;
  if (typeof window === 'undefined' || !window.sessionStorage) return;

  try {
    window.sessionStorage.removeItem(getStagedMealStorageKey(userId));
  } catch {
    // ignore
  }
}

export function clearAllStagedMealDrafts(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;

  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith(STAGED_MEAL_STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}
