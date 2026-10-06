import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSessionSets } from '../components/history/useHistoryData';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
    rpc: vi.fn(),
  },
}));

describe('useHistoryData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
  });

  it('fetchSessionSets queries rpe and set_type, and excludes warmup/drop sets', async () => {
    const mockSetsFromDb = [
      {
        id: 's-1',
        workout_id: 'w-1',
        exercise_id: 'ex-1',
        weight: 225,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        rpe: 8,
        created_at: '2026-09-01T12:00:00Z',
      },
      {
        id: 's-warmup',
        workout_id: 'w-1',
        exercise_id: 'ex-1',
        weight: 135,
        reps: 10,
        set_index: 0,
        set_type: 'warmup',
        rpe: 5,
        created_at: '2026-09-01T11:55:00Z',
      },
      {
        id: 's-drop',
        workout_id: 'w-1',
        exercise_id: 'ex-1',
        weight: 185,
        reps: 8,
        set_index: 2,
        set_type: 'drop',
        rpe: 9,
        created_at: '2026-09-01T12:05:00Z',
      },
    ];

    let selectProjection = '';
    (supabase.from as any).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: mockSetsFromDb, error: null });
      const origSelect = b.select.bind(b);
      b.select = vi.fn((proj: string) => {
        selectProjection = proj;
        return origSelect(proj);
      });
      return b;
    });

    const sets = await fetchSessionSets('w-1');

    // Must select rpe and set_type from sets table
    expect(selectProjection).toContain('rpe');
    expect(selectProjection).toContain('set_type');

    // Warm-up and drop sets must be hidden on every screen
    expect(sets.length).toBe(1);
    expect(sets[0].id).toBe('s-1');
    expect(sets[0].weight).toBe(225);
    expect(sets[0].rpe).toBe(8);
    expect(sets[0].set_type).toBe('working');
  });
});
