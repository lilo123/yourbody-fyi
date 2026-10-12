import { describe, it, expect, vi } from 'vitest';
import { fetchSetById } from './fetchSet';

describe('fetchSetById', () => {
  it('returns null if setId is empty', async () => {
    const mockClient = {} as any;
    const result = await fetchSetById(mockClient, '');
    expect(result).toBeNull();
  });

  it('fetches set row from Supabase by id', async () => {
    const mockRow = {
      id: 'set-123',
      workout_id: 'workout-456',
      exercise_id: 'ex-789',
      weight: 185,
      reps: 8,
      set_type: 'working',
      rpe: 8.5,
    };
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockRow, error: null });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    const mockClient: any = { ['from']: mockFrom };

    const result = await fetchSetById(mockClient, 'set-123');
    expect(mockFrom).toHaveBeenCalledWith('sets');
    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockEq).toHaveBeenCalledWith('id', 'set-123');
    expect(result).toEqual(mockRow);
  });

  it('returns null if row does not exist', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockClient: any = { ['from']: vi.fn().mockReturnValue({ select: mockSelect }) };

    const result = await fetchSetById(mockClient, 'set-deleted');
    expect(result).toBeNull();
  });

  it('throws error when database query fails', async () => {
    const dbError = new Error('DB connection failed');
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockClient: any = { ['from']: vi.fn().mockReturnValue({ select: mockSelect }) };

    await expect(fetchSetById(mockClient, 'set-err')).rejects.toThrow('DB connection failed');
  });
});
