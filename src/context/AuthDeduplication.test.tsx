import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './AuthContext';
import { CoachProvider } from './CoachContext';
import { useAuth } from '../hooks/useAuth';
import { useCoach } from '../hooks/useCoach';
import { supabase } from '../lib/supabase';
import {
  createSupabaseBuilder,
  getRecordedTables,
  getRecordedSelects,
  clearMockHistory,
} from '../test/supabaseBuilderMock';
import type { UserProfile } from '../types/database';
import { clearInFlight } from '../utils/promiseDedupe';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('F-15: In-Flight Promise Deduplication', () => {
  let queryClient: QueryClient;

  const mockProfile: UserProfile = {
    id: 'user-dedupe-123',
    email: 'dedupe@yourbody.fyi',
    username: 'DedupeUser',
    role: 'coach',
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
    auto_rest_timer: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const athleteLinksData = [
    {
      athlete_id: 'ath-1',
      status: 'active',
      linked_at: '2026-09-01T00:00:00Z',
      athlete: {
        id: 'ath-1',
        username: 'Athlete 1',
        email: 'ath1@example.com',
        role: 'athlete',
        created_at: '2026-09-01T00:00:00Z',
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    clearInFlight();
    localStorage.clear();
    localStorage.setItem('yourbody_user', JSON.stringify(mockProfile));
    localStorage.setItem(`yourbody_user_timezone_${mockProfile.id}`, mockProfile.timezone || 'UTC');

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder('users', mockProfile);
      }
      if (table === 'coach_athlete_links') {
        return createSupabaseBuilder('coach_athlete_links', {
          data: athleteLinksData,
          error: null,
        });
      }
      return createSupabaseBuilder(table, {});
    });

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          user: { id: mockProfile.id, email: mockProfile.email },
        },
      },
    });

    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('deduplicates concurrent refreshProfile callers to exactly 1 users network query', async () => {
    let authContextVal: any = null;

    const DualCallerConsumer: React.FC = () => {
      const auth = useAuth();
      React.useEffect(() => {
        authContextVal = auth;
      });
      return <div>DualCaller</div>;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <DualCallerConsumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    // Wait for initial session hydration to complete
    await waitFor(() => {
      expect(authContextVal.user?.id).toBe(mockProfile.id);
    });

    // Clear queries fired during initial mount/hydration
    clearMockHistory();
    expect(getRecordedTables().filter((t) => t === 'users').length).toBe(0);

    // Fire 3 simultaneous concurrent refreshProfile calls
    await act(async () => {
      const p1 = authContextVal.refreshProfile();
      const p2 = authContextVal.refreshProfile();
      const p3 = authContextVal.refreshProfile();
      await Promise.all([p1, p2, p3]);
    });

    // Despite 3 concurrent callers, users table query count MUST be exactly 1
    const userQueries = getRecordedTables().filter((t) => t === 'users');
    expect(userQueries.length).toBe(1);
    expect(getRecordedSelects()).toContainEqual({
      table: 'users',
      projection: 'id, email, username, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, is_coach_mode, coach_code, coach_tier, max_athletes, created_at, timezone, weight_unit, pr_mode',
    });
  });

  it('preserves staleness: sequential refreshProfile calls fire separate network queries', async () => {
    let authContextVal: any = null;

    const Consumer: React.FC = () => {
      const auth = useAuth();
      React.useEffect(() => {
        authContextVal = auth;
      });
      return <div>Consumer</div>;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    clearMockHistory();

    // Call 1
    await act(async () => {
      await authContextVal.refreshProfile();
    });
    expect(getRecordedTables().filter((t) => t === 'users').length).toBe(1);

    // Call 2 after Call 1 settled
    await act(async () => {
      await authContextVal.refreshProfile();
    });
    expect(getRecordedTables().filter((t) => t === 'users').length).toBe(2);
  });

  it('deduplicates concurrent refreshAthletes callers to exactly 1 coach_athlete_links query', async () => {
    let coachContextVal: any = null;
    let authContextVal: any = null;

    const CoachConsumer: React.FC = () => {
      const auth = useAuth();
      const coach = useCoach();
      React.useEffect(() => {
        authContextVal = auth;
        coachContextVal = coach;
      });
      return <div>CoachConsumer</div>;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <CoachConsumer />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Wait for initial session hydration to complete
    await waitFor(() => {
      expect(authContextVal.user?.id).toBe(mockProfile.id);
    });

    clearMockHistory();
    expect(
      getRecordedTables().filter((t) => t === 'coach_athlete_links').length
    ).toBe(0);

    // Fire 3 simultaneous concurrent refreshAthletes calls
    await act(async () => {
      const p1 = coachContextVal.refreshAthletes();
      const p2 = coachContextVal.refreshAthletes();
      const p3 = coachContextVal.refreshAthletes();
      await Promise.all([p1, p2, p3]);
    });

    // Despite 3 concurrent callers, coach_athlete_links table query count MUST be exactly 1
    const linksQueries = getRecordedTables().filter(
      (t) => t === 'coach_athlete_links'
    );
    expect(linksQueries.length).toBe(1);
    expect(getRecordedSelects()).toContainEqual({
      table: 'coach_athlete_links',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
    });
  });

  it('preserves staleness for CoachContext: sequential refreshAthletes calls fire separate queries', async () => {
    let coachContextVal: any = null;
    let authContextVal: any = null;

    const CoachConsumer: React.FC = () => {
      const auth = useAuth();
      const coach = useCoach();
      React.useEffect(() => {
        authContextVal = auth;
        coachContextVal = coach;
      });
      return <div>CoachConsumer</div>;
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <CoachConsumer />
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Wait for initial session hydration to complete
    await waitFor(() => {
      expect(authContextVal.user?.id).toBe(mockProfile.id);
    });

    clearMockHistory();

    // Call 1
    await act(async () => {
      await coachContextVal.refreshAthletes();
    });
    expect(
      getRecordedTables().filter((t) => t === 'coach_athlete_links').length
    ).toBe(1);

    // Call 2 after Call 1 settled
    await act(async () => {
      await coachContextVal.refreshAthletes();
    });
    expect(
      getRecordedTables().filter((t) => t === 'coach_athlete_links').length
    ).toBe(2);
  });
});
