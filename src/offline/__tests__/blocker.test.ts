import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerOutboxUpdateBlocker, pendingBeforeSignOut } from '../blocker';
import {
  evaluateUpdateSafety,
  registerUpdateBlocker,
  unregisterUpdateBlocker,
  resetUpdateSafetyForTesting,
} from '../../pwa/updateSafety';
import * as flusherModule from '../flusher';
import * as outboxModule from '../outbox';

describe('registerOutboxUpdateBlocker', () => {
  const userId = 'user-blocker-1';

  beforeEach(() => {
    resetUpdateSafetyForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetUpdateSafetyForTesting();
    unregisterUpdateBlocker('outbox');
    vi.restoreAllMocks();
  });

  it('evaluates outbox pending ops as soft update blocker', () => {
    vi.spyOn(flusherModule, 'getActiveUserId').mockReturnValue(userId);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
    vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
      pending: 2,
      attention: 0,
      syncing: false,
      authRequired: false,
      lastSyncedCount: 0,
      needsAttentionOps: [],
    });

    registerOutboxUpdateBlocker(registerUpdateBlocker);
    const safety = evaluateUpdateSafety({ userId });

    expect(safety.status).toBe('soft');
    if (safety.status === 'soft') {
      expect(safety.items).toEqual([{ kind: 'outbox', count: 2 }]);
    }
  });

  it('evaluates outbox syncing as hard update blocker', () => {
    vi.spyOn(flusherModule, 'getActiveUserId').mockReturnValue(userId);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(true);

    registerOutboxUpdateBlocker(registerUpdateBlocker);
    const safety = evaluateUpdateSafety({ userId });

    expect(safety.status).toBe('hard');
    if (safety.status === 'hard') {
      expect(safety.reason).toBe('Syncing changes in progress');
    }
  });

  it('allows PWA update when outbox has 0 pending ops', () => {
    vi.spyOn(flusherModule, 'getActiveUserId').mockReturnValue(userId);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
    vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
      pending: 0,
      attention: 0,
      syncing: false,
      authRequired: false,
      lastSyncedCount: 0,
      needsAttentionOps: [],
    });

    registerOutboxUpdateBlocker(registerUpdateBlocker);
    const safety = evaluateUpdateSafety({ userId });

    expect(safety.status).toBe('clear');
  });

  it('blocks PWA update when active user has pending ops in localStorage from another tab', () => {
    vi.spyOn(flusherModule, 'getActiveUserId').mockReturnValue(userId);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
    localStorage.setItem(`yourbody_outbox_pending_${userId}`, '2');

    try {
      registerOutboxUpdateBlocker(registerUpdateBlocker);
      const safety = evaluateUpdateSafety({ userId });

      expect(safety.status).toBe('soft');
      if (safety.status === 'soft') {
        expect(safety.items).toEqual([{ kind: 'outbox', count: 2 }]);
      }
    } finally {
      localStorage.removeItem(`yourbody_outbox_pending_${userId}`);
    }
  });

  it('allows PWA update when another user has pending ops in localStorage but active user has 0', () => {
    vi.spyOn(flusherModule, 'getActiveUserId').mockReturnValue(userId);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
    // Another user's retained outbox
    localStorage.setItem('yourbody_outbox_pending_other-user', '5');

    try {
      registerOutboxUpdateBlocker(registerUpdateBlocker);
      const safety = evaluateUpdateSafety({ userId });

      expect(safety.status).toBe('clear');
    } finally {
      localStorage.removeItem('yourbody_outbox_pending_other-user');
    }
  });
});

describe('pendingBeforeSignOut', () => {
  it('returns count of pending ops for user', async () => {
    vi.spyOn(outboxModule, 'getOutboxOps').mockResolvedValue([
      { state: 'pending' },
      { state: 'completed' },
      { state: 'attention' },
    ] as any);
    const count = await pendingBeforeSignOut('user-1');
    expect(count).toBe(2);
  });

  it('returns sentinel 1 on IDB error to trigger sign-out confirmation safely', async () => {
    vi.spyOn(outboxModule, 'getOutboxOps').mockRejectedValue(new Error('IndexedDB transaction failed'));
    const count = await pendingBeforeSignOut('user-1');
    expect(count).toBe(1);
  });
});
