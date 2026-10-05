import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { workoutSessionStore, type ActiveWorkoutSession } from '../utils/workoutSessionStore';
import {
  evaluateUpdateSafety,
  registerUpdateBlocker,
  unregisterUpdateBlocker,
  markFormDirty,
  resetUpdateSafetyForTesting,
} from './updateSafety';
import * as outboxModule from '../offline/outbox';
import * as aiQueueModule from '../offline/aiQueue';

describe('PWA updateSafety per D-YB2-3', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const otherUserId = '00000000-0000-4000-8000-000000000002';
  const testDate = '2026-09-30';

  beforeEach(() => {
    localStorage.clear();
    resetUpdateSafetyForTesting();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    resetUpdateSafetyForTesting();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('reports status clear when no blockers are present', () => {
    const result = evaluateUpdateSafety({ userId });
    expect(result.status).toBe('clear');
  });

  describe('Active workout session evaluation', () => {
    it('does NOT block update when session has only ghost sets (no drafts and no logged sets)', () => {
      const ghostSession: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_ghost',
        userId,
        workoutDate: testDate,
        routineName: 'Chest Day',
        exercises: ['Bench Press'],
        targetSetCounts: { 'Bench Press': 3 },
        targetRepCounts: { 'Bench Press': 10 },
        expandedExercises: ['Bench Press'],
        inputDrafts: {},
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };

      workoutSessionStore.saveSession(ghostSession, true);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('clear');
    });

    it('returns soft blocker when active session has typed draft inputs', () => {
      const activeSessionWithDrafts: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_drafts',
        userId,
        workoutDate: testDate,
        routineName: 'Chest Day',
        exercises: ['Bench Press'],
        targetSetCounts: { 'Bench Press': 3 },
        targetRepCounts: { 'Bench Press': 10 },
        expandedExercises: ['Bench Press'],
        inputDrafts: {
          'Bench Press_0': { weight: '135', reps: '10' },
        },
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };

      workoutSessionStore.saveSession(activeSessionWithDrafts, true);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('soft');
      if (result.status === 'soft') {
        expect(result.items).toEqual([{ kind: 'workout' }]);
      }
    });

    it('returns soft blocker when active session has logged sets in React Query cache', () => {
      const activeSessionWithoutDrafts: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_logged_sets',
        userId,
        workoutDate: testDate,
        routineName: 'Chest Day',
        exercises: ['Bench Press'],
        targetSetCounts: { 'Bench Press': 3 },
        targetRepCounts: { 'Bench Press': 10 },
        expandedExercises: ['Bench Press'],
        inputDrafts: {},
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };

      workoutSessionStore.saveSession(activeSessionWithoutDrafts, true);

      const mockQueryClient = {
        getQueryData: vi.fn().mockImplementation((queryKey: unknown[]) => {
          if (
            Array.isArray(queryKey) &&
            queryKey[0] === 'workout_sets' &&
            queryKey[1] === userId &&
            queryKey[2] === testDate
          ) {
            return [{ id: 'set-1', weight: 135, reps: 10 }];
          }
          return undefined;
        }),
      } as unknown as QueryClient;

      const result = evaluateUpdateSafety({ userId, queryClient: mockQueryClient });
      expect(result.status).toBe('soft');
      if (result.status === 'soft') {
        expect(result.items).toEqual([{ kind: 'workout' }]);
      }
    });

    it('does not block update if the session is completed', () => {
      const completedSession: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_completed',
        userId,
        workoutDate: testDate,
        routineName: 'Chest Day',
        exercises: ['Bench Press'],
        targetSetCounts: { 'Bench Press': 3 },
        targetRepCounts: { 'Bench Press': 10 },
        expandedExercises: [],
        inputDrafts: {
          'Bench Press_0': { weight: '135', reps: '10' },
        },
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      workoutSessionStore.saveSession(completedSession, false);
      localStorage.setItem(`yourbody_current_session_pointer_${userId}`, testDate);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('clear');
    });

    it('does not block update if the session belongs to a different user', () => {
      const otherUserSession: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_other_user',
        userId: otherUserId,
        workoutDate: testDate,
        routineName: 'Leg Day',
        exercises: ['Squat'],
        targetSetCounts: { Squat: 3 },
        targetRepCounts: { Squat: 5 },
        expandedExercises: ['Squat'],
        inputDrafts: {
          'Squat_0': { weight: '225', reps: '5' },
        },
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };

      workoutSessionStore.saveSession(otherUserSession, true);

      // Check for current user (userId) who has no session
      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('clear');
    });

    it('skips workout check entirely when signed out (no userId)', () => {
      const sessionWithDrafts: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_anonymous',
        userId: 'some-user',
        workoutDate: testDate,
        routineName: 'Back Day',
        exercises: ['Deadlift'],
        targetSetCounts: { Deadlift: 1 },
        targetRepCounts: { Deadlift: 5 },
        expandedExercises: ['Deadlift'],
        inputDrafts: {
          'Deadlift_0': { weight: '315', reps: '5' },
        },
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };

      workoutSessionStore.saveSession(sessionWithDrafts, true);

      // Signed out check (userId is null / undefined)
      const result = evaluateUpdateSafety({ userId: null });
      expect(result.status).toBe('clear');
    });
  });

  describe('Hard blockers', () => {
    it('returns hard blocker when outbox replay is in flight', () => {
      vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(true);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('Syncing changes in progress');
      }
    });

    it('returns hard blocker when AI queue is analyzing', () => {
      vi.spyOn(aiQueueModule, 'getCachedAiQueue').mockReturnValue({
        items: [],
        counts: { queued: 0, analyzing: 1, ready: 0, failed: 0, total: 1 },
        isAnalyzing: true,
      });

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('AI analysis in progress');
      }
    });

    it('returns hard blocker when another modal dialog is open', () => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('Close open dialog before updating');
      }

      modal.remove();
      expect(evaluateUpdateSafety({ userId }).status).toBe('clear');
    });

    it('does NOT treat our own update confirmation dialog as an open modal blocker', () => {
      const updateDialog = document.createElement('div');
      updateDialog.setAttribute('role', 'dialog');
      updateDialog.setAttribute('aria-modal', 'true');
      updateDialog.setAttribute('data-testid', 'update-confirm-dialog');
      document.body.appendChild(updateDialog);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('clear');

      updateDialog.remove();
    });

    it('returns hard blocker for unknown custom registered blockers', () => {
      registerUpdateBlocker('camera-recording', () => 'Recording in progress');

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('Recording in progress');
      }

      unregisterUpdateBlocker('camera-recording');
      expect(evaluateUpdateSafety({ userId }).status).toBe('clear');
    });

    it('handles blockers returning boolean false with fallback reason', () => {
      registerUpdateBlocker('busy-task', () => false);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('Update currently blocked');
      }
    });

    it('handles throwing custom blockers safely by returning hard safety error', () => {
      registerUpdateBlocker('faulty', () => {
        throw new Error('Explosion');
      });

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('hard');
      if (result.status === 'hard') {
        expect(result.reason).toBe('Safety check error');
      }
    });
  });

  describe('Soft blockers', () => {
    it('returns soft blocker with count when outbox has pending ops', () => {
      vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
      vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
        pending: 3,
        attention: 0,
        syncing: false,
        authRequired: false,
        lastSyncedCount: 0,
        needsAttentionOps: [],
      });

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('soft');
      if (result.status === 'soft') {
        expect(result.items).toEqual([{ kind: 'outbox', count: 3 }]);
      }
    });

    it('returns soft blocker for staged-meal and manual-meal-form', () => {
      markFormDirty('staged-meal', true);

      const mealResult = evaluateUpdateSafety({ userId });
      expect(mealResult.status).toBe('soft');
      if (mealResult.status === 'soft') {
        expect(mealResult.items).toEqual([{ kind: 'meal' }]);
      }

      markFormDirty('staged-meal', false);
      markFormDirty('manual-meal-form', true);

      const manualResult = evaluateUpdateSafety({ userId });
      expect(manualResult.status).toBe('soft');
      if (manualResult.status === 'soft') {
        expect(manualResult.items).toEqual([{ kind: 'meal' }]);
      }

      markFormDirty('manual-meal-form', false);
    });

    it('returns soft blocker for other generic forms', () => {
      markFormDirty('exercise-create-form', true);

      const formResult = evaluateUpdateSafety({ userId });
      expect(formResult.status).toBe('soft');
      if (formResult.status === 'soft') {
        expect(formResult.items).toEqual([{ kind: 'form' }]);
      }

      markFormDirty('exercise-create-form', false);
    });

    it('aggregates multiple soft blockers into items array', () => {
      // 1. Workout with drafts
      const activeSession: ActiveWorkoutSession = {
        schemaVersion: 1,
        sessionId: 'sess_multi',
        userId,
        workoutDate: testDate,
        routineName: 'Chest Day',
        exercises: ['Bench Press'],
        targetSetCounts: { 'Bench Press': 3 },
        targetRepCounts: { 'Bench Press': 10 },
        expandedExercises: ['Bench Press'],
        inputDrafts: { 'Bench Press_0': { weight: '135', reps: '10' } },
        startedAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        completedAt: null,
      };
      workoutSessionStore.saveSession(activeSession, true);

      // 2. Outbox pending 2
      vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
      vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
        pending: 2,
        attention: 0,
        syncing: false,
        authRequired: false,
        lastSyncedCount: 0,
        needsAttentionOps: [],
      });

      // 3. Staged meal
      markFormDirty('staged-meal', true);

      // 4. Other form
      markFormDirty('settings-form', true);

      const result = evaluateUpdateSafety({ userId });
      expect(result.status).toBe('soft');
      if (result.status === 'soft') {
        expect(result.items).toEqual([
          { kind: 'workout' },
          { kind: 'outbox', count: 2 },
          { kind: 'meal' },
          { kind: 'form' },
        ]);
      }
    });
  });
});
