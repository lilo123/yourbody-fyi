import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchExerciseCatalogPage,
  insertCustomExercise,
  DuplicateExerciseError,
  encodeCatalogCursor,
  flattenCatalogPages,
  fetchAllVisibleExercises,
  EXERCISE_SUMMARY_PROJECTION,
  EXERCISE_LIBRARY_PROJECTION,
} from './exercises';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import type { InvalidationClient } from './invalidate';

vi.mock('./supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    /* sb */ ["from"]: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
  },
}));

describe('exercises lib', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('encodeCatalogCursor', () => {
    it('encodes name and id into base64 cursor', () => {
      const cursor = encodeCatalogCursor('Bench Press', 'e1111111-1111-1111-1111-111111111111');
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);
    });
  });

  describe('fetchExerciseCatalogPage', () => {
    it('calls get_exercise_catalog with normalized parameters', async () => {
      const mockRows = [
        {
          id: '1',
          name: 'Zercher Squat',
          body_parts: ['Legs'],
          equipment: 'barbell',
          is_master: true,
          user_id: null,
          is_archived: false,
          is_hidden: false,
          total_count: 1,
        },
      ];
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: mockRows, error: null } as any);

      const result = await fetchExerciseCatalogPage({
        search: 'rdl',
        scope: 'all',
        equipment: 'barbell',
        limit: 50,
      });

      expect(supabase.rpc).toHaveBeenCalledWith('get_exercise_catalog', {
        p_search: 'romanian deadlift', // alias expanded
        p_scope: 'all',
        p_equipment: 'barbell',
        p_include_hidden: false,
        p_limit: 50,
        p_cursor: null,
      });

      expect(result.items).toEqual(mockRows);
      expect(result.totalCount).toBe(1);
      expect(result.nextCursor).toBeNull(); // Less than limit 50
    });

    it('generates nextCursor when page has limit rows', async () => {
      const mockRows = Array.from({ length: 10 }, (_, i) => ({
        id: `00000000-0000-0000-0000-00000000000${i}`,
        name: `Exercise ${i}`,
        body_parts: ['Legs'],
        equipment: null,
        is_master: true,
        user_id: null,
        is_archived: false,
        is_hidden: false,
        total_count: 50,
      }));
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: mockRows, error: null } as any);

      const result = await fetchExerciseCatalogPage({
        limit: 10,
      });

      expect(result.items.length).toBe(10);
      expect(result.nextCursor).toBeTruthy();
    });
  });

  describe('insertCustomExercise', () => {
    it('throws DuplicateExerciseError on client when name + equipment duplicate exists (L35)', async () => {
      const existingCatalog = [
        { name: 'Bench Press', equipment: 'barbell' },
        { name: 'Overhead Press', equipment: null },
      ];

      // Exact match
      await expect(
        insertCustomExercise(
          { name: 'Bench Press', equipment: 'barbell' },
          undefined,
          existingCatalog
        )
      ).rejects.toThrow(DuplicateExerciseError);

      // Normalized match (case / alias / spaces)
      await expect(
        insertCustomExercise(
          { name: '  bench   press  ', equipment: 'barbell' },
          undefined,
          existingCatalog
        )
      ).rejects.toThrow(DuplicateExerciseError);
    });

    it('allows coexistence when equipment differs (L35: Bench Press Barbell vs Dumbbell)', async () => {
      const existingCatalog = [{ name: 'Bench Press', equipment: 'barbell' }];

      const mockInserted = {
        id: 'new-id',
        name: 'Bench Press',
        body_parts: ['Chest'],
        equipment: 'dumbbell',
        is_master: false,
        user_id: 'test-user-id',
        is_archived: false,
        is_hidden: false,
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockInserted, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      vi.mocked(supabase['from']).mockReturnValue({ insert: mockInsert } as any);

      const result = await insertCustomExercise(
        { name: 'Bench Press', bodyParts: ['Chest'], equipment: 'dumbbell' },
        undefined,
        existingCatalog
      );

      expect(result).toEqual(mockInserted);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bench Press',
          equipment: 'dumbbell',
          is_master: false,
        })
      );
    });

    it('invalidates exercise queries via queryClient on successful insert', async () => {
      const mockInserted = {
        id: 'new-id',
        name: 'Zercher Squat',
        body_parts: ['Legs'],
        equipment: 'barbell',
        is_master: false,
        user_id: 'user-123',
        is_archived: false,
        is_hidden: false,
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockInserted, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      vi.mocked(supabase['from']).mockReturnValue({ insert: mockInsert } as any);

      const mockQueryClient: InvalidationClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
      };

      await insertCustomExercise(
        { name: 'Zercher Squat', bodyParts: ['Legs'], equipment: 'barbell', targetUserId: 'user-123' },
        mockQueryClient
      );

      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.exercises.all })
      );
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.exerciseCatalog.all })
      );
    });
  });

  describe('flattenCatalogPages', () => {
    it('flattens pages correctly', () => {
      const pages = [
        { items: [{ id: '1', name: 'A' } as any], nextCursor: 'c1', totalCount: 2 },
        { items: [{ id: '2', name: 'B' } as any], nextCursor: null, totalCount: 2 },
      ];
      expect(flattenCatalogPages({ pages, pageParams: [null, 'c1'] })).toEqual([
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ]);
      expect(flattenCatalogPages(null)).toEqual([]);
    });
  });

  describe('fetchAllVisibleExercises', () => {
    it('pages until a short page (210 rows -> 2 requests at page 200) and returns complete catalog with tail exercise', async () => {
      const mock210 = Array.from({ length: 210 }, (_, i) => ({
        id: `ex-${i + 1}`,
        name: i === 209 ? 'Zottman Curl' : `Exercise ${String(i + 1).padStart(3, '0')}`,
        body_parts: ['Arms'],
        is_master: true,
      }));

      const rangeCalls: Array<[number, number]> = [];

      vi.mocked(supabase['from']).mockImplementation((_table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((rangeStart: number, rangeEnd: number) => {
            rangeCalls.push([rangeStart, rangeEnd]);
            return Promise.resolve({
              data: mock210.slice(rangeStart, rangeEnd + 1),
              error: null,
            });
          }),
        };
        return builder;
      });

      const result = await fetchAllVisibleExercises();

      expect(rangeCalls).toEqual([
        [0, 199],
        [200, 399],
      ]);
      expect(result).toHaveLength(210);
      expect(result[209].name).toBe('Zottman Curl');
    });

    it('applies isArchived filter when explicitly specified', async () => {
      const eqCalls: Array<[string, any]> = [];

      vi.mocked(supabase['from']).mockImplementation((_table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            eqCalls.push([col, val]);
            return builder;
          }),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
        return builder;
      });

      await fetchAllVisibleExercises(EXERCISE_SUMMARY_PROJECTION, { isArchived: false });
      expect(eqCalls).toContainEqual(['is_archived', false]);

      eqCalls.length = 0;
      await fetchAllVisibleExercises(EXERCISE_SUMMARY_PROJECTION);
      expect(eqCalls.some(([col]) => col === 'is_archived')).toBe(false);
    });

    it('applies userId scope filter when provided', async () => {
      const orCalls: string[] = [];
      const eqCalls: Array<[string, any]> = [];

      vi.mocked(supabase['from']).mockImplementation((_table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            eqCalls.push([col, val]);
            return builder;
          }),
          or: vi.fn().mockImplementation((expr: string) => {
            orCalls.push(expr);
            return builder;
          }),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
        return builder;
      });

      // Valid UUID
      const testUserId = '11111111-1111-4111-8111-111111111111';
      await fetchAllVisibleExercises(EXERCISE_LIBRARY_PROJECTION, { userId: testUserId });
      expect(orCalls).toContainEqual(`is_master.eq.true,user_id.eq.${testUserId}`);

      // Invalid UUID or null
      orCalls.length = 0;
      eqCalls.length = 0;
      await fetchAllVisibleExercises(EXERCISE_LIBRARY_PROJECTION, { userId: null });
      expect(orCalls).toHaveLength(0);
      expect(eqCalls).toContainEqual(['is_master', true]);

      // Omitted userId
      orCalls.length = 0;
      eqCalls.length = 0;
      await fetchAllVisibleExercises(EXERCISE_SUMMARY_PROJECTION);
      expect(orCalls).toHaveLength(0);
      expect(eqCalls.some(([col]) => col === 'is_master')).toBe(false);
    });

    it('respects custom pageSize option', async () => {
      const mock50 = Array.from({ length: 50 }, (_, i) => ({
        id: `ex-${i}`,
        name: `Exercise ${i}`,
        body_parts: ['Legs'],
        is_master: true,
      }));

      const rangeCalls: Array<[number, number]> = [];

      vi.mocked(supabase['from']).mockImplementation((_table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((rangeStart: number, rangeEnd: number) => {
            rangeCalls.push([rangeStart, rangeEnd]);
            return Promise.resolve({
              data: mock50.slice(rangeStart, rangeEnd + 1),
              error: null,
            });
          }),
        };
        return builder;
      });

      const result = await fetchAllVisibleExercises(EXERCISE_SUMMARY_PROJECTION, { pageSize: 20 });
      expect(rangeCalls).toEqual([
        [0, 19],
        [20, 39],
        [40, 59],
      ]);
      expect(result).toHaveLength(50);
    });

    it('throws error when database returns an error', async () => {
      vi.mocked(supabase['from']).mockImplementation((_table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('Database connection failed'),
          }),
        };
        return builder;
      });

      await expect(fetchAllVisibleExercises()).rejects.toThrow('Database connection failed');
    });
  });
});
