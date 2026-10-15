import { useState, useEffect, useRef, useCallback } from 'react';
import { getLocalDateStr } from '../../utils/date';
import type { StagedMeal } from './nutritionEngineHelpers';
import {
  loadStagedMealDraft,
  saveStagedMealDraft,
  clearStagedMealDraft,
} from './stagedMealDraft';

export interface UseStagedMealDraftReturn {
  stagedMeal: StagedMeal | null;
  setStagedMeal: React.Dispatch<React.SetStateAction<StagedMeal | null>>;
  clearDraft: () => void;
}

export function useStagedMealDraft(
  targetUserId: string,
  onDraftRestored?: (draft: StagedMeal) => void
): UseStagedMealDraftReturn {
  const [stagedMeal, setStagedMeal] = useState<StagedMeal | null>(() => {
    return loadStagedMealDraft(targetUserId, getLocalDateStr(new Date()));
  });

  const onDraftRestoredRef = useRef(onDraftRestored);
  onDraftRestoredRef.current = onDraftRestored;

  const prevUserIdRef = useRef<string>(targetUserId);

  useEffect(() => {
    if (prevUserIdRef.current !== targetUserId) {
      const wasEmpty = !prevUserIdRef.current;
      prevUserIdRef.current = targetUserId;
      if (targetUserId) {
        const restored = loadStagedMealDraft(targetUserId, getLocalDateStr(new Date()));
        if (restored || !wasEmpty) {
          setStagedMeal(restored);
          if (restored) {
            onDraftRestoredRef.current?.(restored);
          }
        }
      } else {
        setStagedMeal(null);
      }
    }
  }, [targetUserId]);

  useEffect(() => {
    if (!targetUserId) return;
    saveStagedMealDraft(targetUserId, getLocalDateStr(new Date()), stagedMeal);
  }, [stagedMeal, targetUserId]);

  const clearDraft = useCallback(() => {
    clearStagedMealDraft(targetUserId);
    setStagedMeal(null);
  }, [targetUserId]);

  return { stagedMeal, setStagedMeal, clearDraft };
}
