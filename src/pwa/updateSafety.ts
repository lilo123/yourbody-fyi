import type { QueryClient } from '@tanstack/react-query';
import { workoutSessionStore } from '../utils/workoutSessionStore';
import { getSyncingStatus, getCachedOutboxSummary } from '../offline/outbox';
import { getCachedAiQueue } from '../offline/aiQueue';

export type SoftItem =
  | { kind: 'workout' }
  | { kind: 'outbox'; count: number }
  | { kind: 'meal' }
  | { kind: 'form' };

export type UpdateSafetyResult =
  | { status: 'clear' }
  | { status: 'hard'; reason: string }
  | { status: 'soft'; items: SoftItem[] };

export interface EvaluateUpdateSafetyOptions {
  userId?: string | null;
  queryClient?: QueryClient | null;
}

export type UpdateBlockerFn = () => string | null | undefined | boolean;

const customBlockers = new Map<string, UpdateBlockerFn>();
const dirtyForms = new Set<string>();

/**
 * Register a custom update blocker.
 * Returning a non-empty string or boolean false blocks the update with that reason.
 */
export function registerUpdateBlocker(id: string, blocker: UpdateBlockerFn): void {
  customBlockers.set(id, blocker);
}

/**
 * Unregister a custom update blocker.
 */
export function unregisterUpdateBlocker(id: string): void {
  customBlockers.delete(id);
}

/**
 * Track dirty/unsaved form state.
 */
export function markFormDirty(id: string, dirty: boolean): void {
  if (dirty) {
    dirtyForms.add(id);
  } else {
    dirtyForms.delete(id);
  }
}

/**
 * Built-in check for open accessible modals.
 * Excludes our own update confirmation dialog (marked with data-testid="update-confirm-dialog").
 */
function checkOpenModal(): string | null {
  if (typeof document === 'undefined') return null;

  const openModals = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  for (let i = 0; i < openModals.length; i++) {
    const modal = openModals[i];
    if (
      modal.getAttribute('data-testid') === 'update-confirm-dialog' ||
      modal.closest('[data-testid="update-confirm-dialog"]')
    ) {
      continue;
    }
    return 'Close open dialog before updating';
  }

  return null;
}

/**
 * Evaluates all built-in and registered update blockers.
 *
 * Hard blockers:
 * - Outbox replay in flight
 * - AI parse in flight
 * - Another aria-modal open dialog (excluding update confirm dialog)
 * - Unknown registered string blockers
 *
 * Soft blockers:
 * - Active workout session for the current user with non-blank typed drafts or logged sets
 * - Outbox pending > 0 (while not syncing)
 * - Dirty meal forms ('staged-meal' / 'manual-meal-form')
 * - Other dirty forms
 *
 * Clear:
 * - No hard blockers and no soft blockers present
 */
export function evaluateUpdateSafety(
  options: EvaluateUpdateSafetyOptions = {}
): UpdateSafetyResult {
  // 1. Hard: Outbox replay in flight
  try {
    if (getSyncingStatus()) {
      return { status: 'hard', reason: 'Syncing changes in progress' };
    }
  } catch {
    // Ignore outbox status errors
  }

  // 2. Hard: AI parse in flight
  if (options.userId) {
    try {
      const aiQueueState = getCachedAiQueue(options.userId);
      if (aiQueueState.isAnalyzing) {
        return { status: 'hard', reason: 'AI analysis in progress' };
      }
    } catch {
      // Ignore AI queue errors
    }
  }

  // 3. Hard: Another open accessible modal
  const modalReason = checkOpenModal();
  if (modalReason) {
    return { status: 'hard', reason: modalReason };
  }

  // 4. Hard: Unknown registered custom blockers (fail safe)
  for (const [id, blocker] of customBlockers) {
    if (id === 'outbox') {
      // Outbox is evaluated natively
      continue;
    }
    try {
      const result = blocker();
      if (typeof result === 'string' && result.trim().length > 0) {
        return { status: 'hard', reason: result.trim() };
      }
      if (result === false) {
        return { status: 'hard', reason: 'Update currently blocked' };
      }
    } catch {
      return { status: 'hard', reason: 'Safety check error' };
    }
  }

  // Collect soft blocker items
  const softItems: SoftItem[] = [];

  // Soft 1: Active workout session with typed drafts or logged sets
  // Signed out -> never gated by workout pointers. Ghost-only is not a blocker.
  if (options.userId) {
    try {
      const activeSession = workoutSessionStore.getActiveSession(options.userId);
      if (activeSession && activeSession.completedAt === null) {
        const hasDrafts = Object.values(activeSession.inputDrafts || {}).some(
          (draft) =>
            (Boolean(draft?.weight) && String(draft.weight).trim().length > 0) ||
            (Boolean(draft?.reps) && String(draft.reps).trim().length > 0)
        );

        let hasLoggedSets = false;
        if (options.queryClient && activeSession.workoutDate) {
          try {
            const cachedSets = options.queryClient.getQueryData([
              'workout_sets',
              options.userId,
              activeSession.workoutDate,
            ]);
            if (Array.isArray(cachedSets) && cachedSets.length > 0) {
              hasLoggedSets = true;
            }
          } catch {
            // Ignore cache read errors
          }
        }

        if (hasDrafts || hasLoggedSets) {
          softItems.push({ kind: 'workout' });
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  // Soft 2: Outbox pending > 0 (not syncing)
  if (options.userId) {
    try {
      const summary = getCachedOutboxSummary(options.userId);
      if (summary.pending > 0) {
        softItems.push({ kind: 'outbox', count: summary.pending });
      }
    } catch {
      // Ignore outbox errors
    }
  }

  // Soft 3: Dirty meal form ('staged-meal' / 'manual-meal-form')
  const hasMeal = dirtyForms.has('staged-meal') || dirtyForms.has('manual-meal-form');
  if (hasMeal) {
    softItems.push({ kind: 'meal' });
  }

  // Soft 4: Other dirty forms
  let hasOtherForm = false;
  for (const id of dirtyForms) {
    if (id !== 'staged-meal' && id !== 'manual-meal-form') {
      hasOtherForm = true;
      break;
    }
  }
  if (hasOtherForm) {
    softItems.push({ kind: 'form' });
  }

  if (softItems.length > 0) {
    return { status: 'soft', items: softItems };
  }

  return { status: 'clear' };
}

/**
 * Test helper to reset blocker registry and dirty forms.
 */
export function resetUpdateSafetyForTesting(): void {
  customBlockers.clear();
  dirtyForms.clear();
}
