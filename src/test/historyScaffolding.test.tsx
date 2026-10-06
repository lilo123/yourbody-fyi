import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});
import { screen, waitFor } from '@testing-library/react';
import {
  renderHistoryView,
  setupHistoryMocks as baseSetupHistoryMocks,
  createMockWorkoutSession,
  createMockExercise,
  createBoundarySessions,
  clickTimeRangeChip,
  searchExercisesInput,
  toggleWorkoutViewMode,
  toggleHistoryDomain,
} from './historyScaffolding';
import { clearMockHistory } from './supabaseBuilderMock';
import { supabase } from '../lib/supabase';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-athlete-id', email: 'athlete@example.com' },
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-athlete-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

/**
 * Smoke tests for History behavioural scaffolding.
 *
 * Cites:
 * - HISTORY_AUDIT_REPORT.md line 105:
 *   "Chips, search and category behaviour have no tests (only CSS class / placeholder checks) |
 *    Tests | HistoryView.test.tsx:231,1907-1922; Virtualization.test.tsx:201 V-s |
 *    Add behavioural tests (see acceptance)"
 * - HISTORY_AUDIT_REPORT.md line 255 (Batch B0):
 *   "B0 Test infra | Test scaffolding | ... Land first so the other batches' tests
 *    actually exercise the caps and timezones. Other batches add new test files only; nobody edits
 *    HistoryView.test.tsx except B2."
 */
function setupHistoryMocks(options?: any) {
  baseSetupHistoryMocks(options);
  const origImpl = (supabase.rpc as any).getMockImplementation();
  (supabase.rpc as any).mockImplementation((fn: string, args: any) => {
    if (fn === 'get_history_sessions_v2') {
      const sessions = options?.sessions || [];
      const rows = sessions.map((s: any) => ({
        ...s,
        civil_date: s.civil_date || (s.date ? String(s.date).split('T')[0] : ''),
        total_count: sessions.length,
      }));
      return Promise.resolve({ data: rows, error: null });
    }
    return origImpl ? origImpl(fn, args) : Promise.resolve({ data: null, error: null });
  });
}

describe('History scaffolding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
  });

  it('renders HistoryView with mock sessions and exercises using renderHistoryView helper', async () => {
    const sessions = [
      createMockWorkoutSession({
        id: 'session-smoke-1',
        name: 'Heavy Leg Day',
        date: '2026-09-20T10:00:00Z',
        set_count: 5,
        total_volume: 4500,
      }),
    ];
    const exercises = [
      createMockExercise({ id: 'ex-sq', name: 'Barbell Back Squat', body_parts: ['Legs'] }),
    ];

    setupHistoryMocks({ sessions, exercises });
    renderHistoryView();

    await waitFor(() => {
      expect(screen.getByText('Heavy Leg Day')).toBeDefined();
    });
    expect(screen.getByText('Workout History')).toBeDefined();
    expect(screen.getByText('By Session')).toBeDefined();
    expect(screen.getByText('By Exercise')).toBeDefined();
  });

  it('exercises time range chip interaction helper (clickTimeRangeChip)', async () => {
    setupHistoryMocks();
    renderHistoryView();

    await waitFor(() => {
      expect(screen.getByTestId('history-range-all')).toBeDefined();
    });

    const chip30 = clickTimeRangeChip('30d');
    expect(chip30).toBeDefined();

    const chip90 = clickTimeRangeChip('90d');
    expect(chip90).toBeDefined();

    const chipAll = clickTimeRangeChip('all');
    expect(chipAll).toBeDefined();
  });

  it('exercises view-mode toggle and search exercise helper (searchExercisesInput)', async () => {
    const exercises = [
      createMockExercise({ id: 'ex-1', name: 'Incline Dumbbell Press', body_parts: ['Chest'] }),
      createMockExercise({ id: 'ex-2', name: 'Standing Calf Raise', body_parts: ['Calves'] }),
    ];
    setupHistoryMocks({ exercises });
    renderHistoryView();

    // Toggle to By Exercise
    toggleWorkoutViewMode('exercise');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search exercise library...')).toBeDefined();
    });

    const input = searchExercisesInput('Incline');
    expect(input.value).toBe('Incline');
  });

  it('generates boundary sessions with createBoundarySessions for date-filtering tests', () => {
    const ref = new Date('2026-09-26T12:00:00Z');
    const boundaries = createBoundarySessions(ref);

    expect(boundaries).toHaveLength(3);
    expect(boundaries[0].id).toBe('session-29d');
    expect(boundaries[1].id).toBe('session-30d');
    expect(boundaries[2].id).toBe('session-31d');

    // Confirm dates span 29, 30, and 31 days prior to reference date
    const d29 = new Date(boundaries[0].date);
    const d30 = new Date(boundaries[1].date);
    const d31 = new Date(boundaries[2].date);
    expect(Math.round((ref.getTime() - d29.getTime()) / (24 * 3600 * 1000))).toBe(29);
    expect(Math.round((ref.getTime() - d30.getTime()) / (24 * 3600 * 1000))).toBe(30);
    expect(Math.round((ref.getTime() - d31.getTime()) / (24 * 3600 * 1000))).toBe(31);
  });

  it('exercises domain switcher helper (toggleHistoryDomain)', async () => {
    setupHistoryMocks();
    renderHistoryView();

    toggleHistoryDomain('nutrition');
    await waitFor(() => {
      expect(screen.getByText('Nutrition History')).toBeDefined();
    });

    toggleHistoryDomain('workouts');
    await waitFor(() => {
      expect(screen.getByText('Workout History')).toBeDefined();
    });
  });
});
