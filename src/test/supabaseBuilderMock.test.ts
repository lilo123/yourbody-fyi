import { describe, it, expect } from 'vitest';
import { createSupabaseBuilder, createSupabaseMock } from './supabaseBuilderMock';

describe('supabaseBuilderMock limit and range fidelity (H28 / L37)', () => {
  it('observably caps query results with .limit(200) on a 500-row fixture', async () => {
    const fixture = Array.from({ length: 500 }, (_, i) => ({
      id: `ex-${i}`,
      name: `Exercise ${String(i).padStart(3, '0')}`,
      body_parts: ['Chest'],
      is_master: true,
    }));

    const builder = createSupabaseBuilder('exercises', fixture);
    const { data, error } = await builder.select('id, name, body_parts, is_master').limit(200);

    expect(error).toBeNull();
    expect(data).toHaveLength(200);
    expect(data[0].id).toBe('ex-0');
    expect(data[199].id).toBe('ex-199');
  });

  it('observably paginates query results with .range(from, to) on a 500-row fixture', async () => {
    const fixture = Array.from({ length: 500 }, (_, i) => ({
      id: `item-${i}`,
      name: `Item ${i}`,
      val: i,
    }));

    const mock = createSupabaseMock({
      tables: {
        items: fixture,
      },
    });

    // Page 1: 0..199 -> 200 items
    const page1Res = await mock.from('items').select('*').range(0, 199);
    expect(page1Res.error).toBeNull();
    expect(page1Res.data).toHaveLength(200);
    expect(page1Res.data[0].id).toBe('item-0');
    expect(page1Res.data[199].id).toBe('item-199');

    // Page 2: 200..399 -> 200 items
    const page2Res = await mock.from('items').select('*').range(200, 399);
    expect(page2Res.error).toBeNull();
    expect(page2Res.data).toHaveLength(200);
    expect(page2Res.data[0].id).toBe('item-200');
    expect(page2Res.data[199].id).toBe('item-399');

    // Page 3: 400..599 -> remaining 100 items (400 to 499)
    const page3Res = await mock.from('items').select('*').range(400, 599);
    expect(page3Res.error).toBeNull();
    expect(page3Res.data).toHaveLength(100);
    expect(page3Res.data[0].id).toBe('item-400');
    expect(page3Res.data[99].id).toBe('item-499');

    // Out of bounds page: 600..700 -> 0 items
    const emptyPage = await mock.from('items').select('*').range(600, 700);
    expect(emptyPage.error).toBeNull();
    expect(emptyPage.data).toHaveLength(0);
  });

  it('evaluates .order() before .limit() exactly like PostgREST', async () => {
    const fixture = [
      { id: '1', name: 'Zebra', score: 10 },
      { id: '2', name: 'Apple', score: 30 },
      { id: '3', name: 'Mango', score: 20 },
      { id: '4', name: 'Banana', score: 50 },
      { id: '5', name: 'Carrot', score: 40 },
    ];

    // Order by name ascending then limit 3 -> Apple, Banana, Carrot
    const ascBuilder = createSupabaseBuilder('fruits', fixture);
    const ascRes = await ascBuilder.select('*').order('name', { ascending: true }).limit(3);
    expect(ascRes.data.map((r: any) => r.name)).toEqual(['Apple', 'Banana', 'Carrot']);

    // Order by score descending then limit 2 -> Banana (50), Carrot (40)
    const descBuilder = createSupabaseBuilder('fruits', fixture);
    const descRes = await descBuilder.select('*').order('score', { ascending: false }).limit(2);
    expect(descRes.data.map((r: any) => r.name)).toEqual(['Banana', 'Carrot']);
  });

  it('keeps embedded table limits separate from top-level limits in limitCalls', async () => {
    const fixture = [
      { id: 'w-1', name: 'Workout 1' },
      { id: 'w-2', name: 'Workout 2' },
      { id: 'w-3', name: 'Workout 3' },
    ];

    const builder = createSupabaseBuilder('workouts', fixture);
    // Embedded limit on foreign table 'sets'
    builder.limit(50, { foreignTable: 'sets' });
    // Top-level limit on workouts
    builder.limit(2);

    const { data } = await builder.select('id, name');
    expect(data).toHaveLength(2);
    expect(builder.limitCalls).toEqual([
      { count: 50, referencedTable: 'sets' },
      { count: 2, referencedTable: undefined },
    ]);
  });
});
