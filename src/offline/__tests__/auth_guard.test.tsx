import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { getAuthRequiredStatus, setAuthRequiredStatus } from '../outbox';
import { enqueue, getOutboxOps } from '../outbox';
import { setIdMapping, getIdMapping } from '../idmap';
import { getOfflineDb } from '../db';
import { wipeUserData } from '../../utils/wipeUserData';
import type { UserProfile } from '../../types/database';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    ['from']: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

const TestConsumer: React.FC = () => {
  const { user, profile, loading, signOut } = useAuth();
  return (
    <div>
      <div data-testid="auth-loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="auth-user-id">{user?.id || 'none'}</div>
      <div data-testid="auth-profile-username">{profile?.username || 'none'}</div>
      <button data-testid="auth-signout-btn" onClick={() => signOut()}>
        Sign Out
      </button>
    </div>
  );
};

describe('auth_guard (A8 + A9 Offline Auth Guarantees)', () => {
  let queryClient: QueryClient;

  const mockUser: UserProfile = {
    id: 'user-offline-guard-123',
    email: 'guard@yourbody.fyi',
    username: 'OfflineWarrior',
    role: 'athlete',
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
    auto_rest_timer: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setAuthRequiredStatus(false);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    ((supabase as any)['from']).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockUser, error: null }),
      update: vi.fn().mockReturnThis(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('offline resume retains user state and cached credentials when getSession fails', async () => {
    // Simulate device being offline
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));

    // getSession fails or returns null while offline
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Initial render has cached user
    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockUser.id);
    expect(screen.getByTestId('auth-loading').textContent).toBe('false');

    // Simulate returning to app (visibilitychange) while offline
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait short delay to ensure no async clearing occurred
    await new Promise((r) => setTimeout(r, 50));

    // User is NOT cleared and authRequired is NOT flagged
    expect(screen.getByTestId('auth-user-id').textContent).toBe(mockUser.id);
    expect(localStorage.getItem('yourbody_user')).not.toBeNull();
    expect(getAuthRequiredStatus()).toBe(false);
  });

  it('online boot with invalid session clears user and does NOT set authRequired status (D-YB2-2)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));

    // Session is invalid online
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    });

    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(getAuthRequiredStatus()).toBe(false);
  });

  it('online resume with invalid session clears user and sets authRequired status when user was authenticated (D-YB2-2)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));

    // Session is initially valid
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: mockUser.id, email: mockUser.email } },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(mockUser.id);
    });

    // Device resumes while online, but session is now revoked/null
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    });

    expect(localStorage.getItem('yourbody_user')).toBeNull();
    expect(getAuthRequiredStatus()).toBe(true);
  });

  it('signOut clears rq store while preserving outbox and idmap in IndexedDB', async () => {
    const userId = mockUser.id;
    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: userId, email: mockUser.email } },
      },
    });

    // Populate IndexedDB with rq data, outbox op, and idmap
    const db = await getOfflineDb(userId);
    await db.put('rq', { clientState: { mutations: [], queries: [] }, timestamp: Date.now() }, 'persisted-query-cache');
    await setIdMapping(userId, 'client-w-1', 'server-w-1');
    await enqueue({
      userId,
      kind: 'workout.ensure',
      payload: {
        clientWorkoutId: 'client-w-1',
        workout_date: '2026-03-30',
      },
    });

    // Verify initial IDB state
    expect(await db.get('rq', 'persisted-query-cache')).toBeDefined();
    expect(await getIdMapping(userId, 'client-w-1')).toBe('server-w-1');
    const opsBefore = await getOutboxOps(userId);
    expect(opsBefore).toHaveLength(1);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(userId);
    });

    // Trigger signOut
    const signOutBtn = screen.getByTestId('auth-signout-btn');
    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    });

    // Verify IndexedDB: rq cleared, outbox and idmap preserved
    const rqAfter = await db.get('rq', 'persisted-query-cache');
    expect(rqAfter).toBeUndefined();

    const idMappingAfter = await getIdMapping(userId, 'client-w-1');
    expect(idMappingAfter).toBe('server-w-1');

    const opsAfter = await getOutboxOps(userId);
    expect(opsAfter).toHaveLength(1);

    const dbsAfter = await indexedDB.databases();
    expect(dbsAfter.some((d) => d.name === `yourbody-offline-${userId}`)).toBe(true);
  });

  it('account deletion flow (wipeUserData followed by signOut) does not leave or recreate offline IndexedDB', async () => {
    const userId = mockUser.id;
    localStorage.setItem('yourbody_user', JSON.stringify(mockUser));

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: userId, email: mockUser.email } },
      },
    });

    // Populate IndexedDB with offline data so DB exists
    const db = await getOfflineDb(userId);
    await db.put('rq', { clientState: { mutations: [], queries: [] }, timestamp: Date.now() }, 'persisted-query-cache');
    await setIdMapping(userId, 'client-w-1', 'server-w-1');
    db.close();

    // Verify DB exists in indexedDB.databases()
    const dbsBefore = await indexedDB.databases();
    expect(dbsBefore.some((d) => d.name === `yourbody-offline-${userId}`)).toBe(true);

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe(userId);
    });

    // Account deletion flow: wipeUserData then signOut
    await wipeUserData(userId, { queryClient });

    const signOutBtn = screen.getByTestId('auth-signout-btn');
    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-user-id').textContent).toBe('none');
    });

    // Verify no offline DB exists for this user in indexedDB.databases()
    const dbsAfter = await indexedDB.databases();
    const userDb = dbsAfter.find((d) => d.name === `yourbody-offline-${userId}`);
    expect(userDb).toBeUndefined();
  });
});
