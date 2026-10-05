import { describe, it, expect } from 'vitest';
import { AUTH_STORAGE_PREFIX } from '../context/AuthContext';
import { getOfflineDbName } from '../offline/db';
import { getOutboxLockName } from '../offline/flusher';
import { getAiQueueLockName } from '../offline/aiQueue';
import { BROADCAST_CHANNEL_NAME } from '../offline/outbox';

const OLD_BRAND = 'cybergym'; // check-brand: allow

describe('Runtime brand identifier invariants (D-YB-4)', () => {
  it('asserts localStorage prefix is yourbody_ and does not contain old brand', () => {
    expect(AUTH_STORAGE_PREFIX).toBe('yourbody_');
    expect(AUTH_STORAGE_PREFIX.toLowerCase()).not.toContain(OLD_BRAND);
  });

  it('asserts offline IndexedDB name builder produces yourbody-offline-<uid>', () => {
    const dbName = getOfflineDbName('test-user-42');
    expect(dbName).toBe('yourbody-offline-test-user-42');
    expect(dbName.toLowerCase()).not.toContain(OLD_BRAND);
  });

  it('asserts outbox lock name builder produces yourbody-outbox-<uid>', () => {
    const lockName = getOutboxLockName('test-user-42');
    expect(lockName).toBe('yourbody-outbox-test-user-42');
    expect(lockName.toLowerCase()).not.toContain(OLD_BRAND);
  });

  it('asserts AI queue lock name builder produces yourbody-aiq-<uid>', () => {
    const lockName = getAiQueueLockName('test-user-42');
    expect(lockName).toBe('yourbody-aiq-test-user-42');
    expect(lockName.toLowerCase()).not.toContain(OLD_BRAND);
  });

  it('asserts outbox BroadcastChannel name is yourbody_outbox_channel', () => {
    expect(BROADCAST_CHANNEL_NAME).toBe('yourbody_outbox_channel');
    expect(BROADCAST_CHANNEL_NAME.toLowerCase()).not.toContain(OLD_BRAND);
  });
});
