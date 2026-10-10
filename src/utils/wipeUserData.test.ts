import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wipeUserData } from './wipeUserData';
import * as offlineDbModule from '../offline/db';
import { QueryClient } from '@tanstack/react-query';

describe('wipeUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('wipe helper deletes the right DB name only', async () => {
    const targetUserId = '11111111-1111-4111-8111-111111111111';
    const otherUserId = '22222222-2222-4222-8222-222222222222';

    const deletedDbNames: string[] = [];
    vi.spyOn(offlineDbModule, 'deleteOfflineDb').mockImplementation(async (uid: string) => {
      deletedDbNames.push(offlineDbModule.getOfflineDbName(uid));
    });

    await wipeUserData(targetUserId);

    expect(deletedDbNames).toEqual([`yourbody-offline-${targetUserId}`]);
    expect(deletedDbNames).not.toContain(`yourbody-offline-${otherUserId}`);
  });

  it('clears query client cache when provided', async () => {
    const queryClient = new QueryClient();
    const clearSpy = vi.spyOn(queryClient, 'clear');
    vi.spyOn(offlineDbModule, 'deleteOfflineDb').mockResolvedValue();

    await wipeUserData('test-user-id', { queryClient });

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('clears user-specific and session yourbody_* localStorage keys while preserving other users and unrelated keys', async () => {
    const targetUserId = '11111111-1111-4111-8111-111111111111';
    const otherUserId = '22222222-2222-4222-8222-222222222222';

    // Populate localStorage
    localStorage.setItem('yourbody_user', JSON.stringify({ id: targetUserId }));
    localStorage.setItem('yourbody_view_mode', 'athlete');
    localStorage.setItem('yourbody_auto_rest_timer', 'true');
    localStorage.setItem(`yourbody_last_route_${targetUserId}`, '/workout');
    localStorage.setItem(`yourbody_outbox_pending_${targetUserId}`, '3');

    // Other user's keys
    localStorage.setItem(`yourbody_last_route_${otherUserId}`, '/nutrition');
    localStorage.setItem(`yourbody_outbox_pending_${otherUserId}`, '1');

    // Unrelated key
    localStorage.setItem('theme_preference', 'dark');

    vi.spyOn(offlineDbModule, 'deleteOfflineDb').mockResolvedValue();

    await wipeUserData(targetUserId);

    // Target user keys removed
    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(localStorage.getItem('yourbody_view_mode')).toBeNull();
    expect(localStorage.getItem('yourbody_auto_rest_timer')).toBeNull();
    expect(localStorage.getItem(`yourbody_last_route_${targetUserId}`)).toBeNull();
    expect(localStorage.getItem(`yourbody_outbox_pending_${targetUserId}`)).toBeNull();

    // Other user and unrelated keys preserved
    expect(localStorage.getItem(`yourbody_last_route_${otherUserId}`)).toBe('/nutrition');
    expect(localStorage.getItem(`yourbody_outbox_pending_${otherUserId}`)).toBe('1');
    expect(localStorage.getItem('theme_preference')).toBe('dark');
  });

  it('handles empty userId gracefully without crashing', async () => {
    const deleteSpy = vi.spyOn(offlineDbModule, 'deleteOfflineDb');
    await wipeUserData('');
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
