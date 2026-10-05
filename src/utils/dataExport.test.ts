import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveDateBounds,
  escapeCsvCell,
  formatItemsSummary,
  serializeToExportJson,
  serializeToExportCsvFiles,
  fetchExportBundle,
  downloadExportFiles,
  executeDataExport,
  EXPORT_PAGE_SIZE,
  WORKOUT_EXPORT_PROJECTION,
  NUTRITION_EXPORT_PROJECTION,
  CUSTOM_DISH_EXPORT_PROJECTION,
  ROUTINE_EXPORT_PROJECTION,
  type ExportBundle,
  type DataExportOptions,
  type GeneratedExportFile,
} from './dataExport';
import {
  SupabaseQueryBuilderMock,
  getRecordedSelects,
  getRecordedTables,
  clearMockHistory,
} from '../test/supabaseBuilderMock';
import type { NutritionItem } from './itemModel';

vi.mock('../lib/supabase', async () => {
  const { createSupabaseMock } = await import('../test/supabaseBuilderMock');
  const mock = createSupabaseMock();
  return {
    supabase: mock,
  };
});

import { supabase } from '../lib/supabase';
const mockSupabase = supabase as unknown as ReturnType<typeof import('../test/supabaseBuilderMock').createSupabaseMock>;

describe('dataExport utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearMockHistory();
    for (const table of ['workouts', 'nutrition_logs', 'custom_dishes', 'routine_templates', 'users']) {
      mockSupabase.getBuilders(table).length = 0;
    }
  });

  describe('resolveDateBounds', () => {
    const fixedReference = new Date('2026-09-23T12:00:00Z');

    it('calculates 7d date bounds correctly', () => {
      const bounds = resolveDateBounds('7d', undefined, undefined, fixedReference);
      expect(bounds.endDate).toBe('2026-09-23');
      expect(bounds.startDate).toBe('2026-09-16');
    });

    it('calculates 30d date bounds correctly', () => {
      const bounds = resolveDateBounds('30d', undefined, undefined, fixedReference);
      expect(bounds.endDate).toBe('2026-09-23');
      expect(bounds.startDate).toBe('2026-08-24');
    });

    it('calculates 90d date bounds correctly', () => {
      const bounds = resolveDateBounds('90d', undefined, undefined, fixedReference);
      expect(bounds.endDate).toBe('2026-09-23');
      expect(bounds.startDate).toBe('2026-06-25');
    });

    it('returns nulls for all preset', () => {
      const bounds = resolveDateBounds('all', undefined, undefined, fixedReference);
      expect(bounds.startDate).toBeNull();
      expect(bounds.endDate).toBeNull();
    });

    it('returns normalized dates for custom preset', () => {
      const bounds = resolveDateBounds('custom', '2026-01-01', '2026-01-31');
      expect(bounds.startDate).toBe('2026-01-01');
      expect(bounds.endDate).toBe('2026-01-31');
    });

    it('swaps start and end dates when startDate > endDate in custom preset', () => {
      const bounds = resolveDateBounds('custom', '2026-05-15', '2026-05-01');
      expect(bounds.startDate).toBe('2026-05-01');
      expect(bounds.endDate).toBe('2026-05-15');
    });

    it('handles missing custom dates gracefully', () => {
      const bounds = resolveDateBounds('custom');
      expect(bounds.startDate).toBeNull();
      expect(bounds.endDate).toBeNull();
    });

    it('rejects malformed custom date strings and returns null', () => {
      const bounds = resolveDateBounds('custom', 'invalid-date', 'not-a-date');
      expect(bounds.startDate).toBeNull();
      expect(bounds.endDate).toBeNull();
    });
  });

  describe('escapeCsvCell', () => {
    it('returns empty string for null, undefined, or NaN', () => {
      expect(escapeCsvCell(null)).toBe('');
      expect(escapeCsvCell(undefined)).toBe('');
      expect(escapeCsvCell(Number.NaN)).toBe('');
    });

    it('formats plain numbers and booleans as strings', () => {
      expect(escapeCsvCell(123)).toBe('123');
      expect(escapeCsvCell(0)).toBe('0');
      expect(escapeCsvCell(true)).toBe('true');
      expect(escapeCsvCell(false)).toBe('false');
    });

    it('preserves numeric negative values as numbers', () => {
      expect(escapeCsvCell(-10)).toBe('-10');
      expect(escapeCsvCell('-10')).toBe('-10');
    });

    it('escapes strings with commas by wrapping in double quotes', () => {
      expect(escapeCsvCell('Bench, Incline')).toBe('"Bench, Incline"');
    });

    it('escapes strings with double quotes by doubling them and wrapping in quotes', () => {
      expect(escapeCsvCell('Bench "Special" Press')).toBe('"Bench ""Special"" Press"');
    });

    it('escapes strings with newlines or carriage returns', () => {
      expect(escapeCsvCell("Line 1\nLine 2")).toBe("\"Line 1\nLine 2\"");
      expect(escapeCsvCell("Line 1\r\nLine 2")).toBe("\"Line 1\r\nLine 2\"");
    });

    it('neutralizes CSV formula injection starting with =, +, -, @, \\t, \\r', () => {
      expect(escapeCsvCell('=SUM(A1:B1)')).toBe("'=SUM(A1:B1)");
      expect(escapeCsvCell('+cmd|/C calc')).toBe("'+cmd|/C calc");
      expect(escapeCsvCell('-2+3*cmd')).toBe("'-2+3*cmd");
      expect(escapeCsvCell('@SUM(A1:B1)')).toBe("'@SUM(A1:B1)");
      expect(escapeCsvCell('\tcmd')).toBe("'\tcmd");
      expect(escapeCsvCell('\rcmd')).toBe("\"'\rcmd\"");
    });

    it('handles formula injection with quotes and commas simultaneously', () => {
      expect(escapeCsvCell('=HYPERLINK("http://evil.com", "Click")')).toBe(
        '"\'=HYPERLINK(""http://evil.com"", ""Click"")"'
      );
    });
  });

  describe('formatItemsSummary', () => {
    it('returns empty string for null, undefined, or empty items array', () => {
      expect(formatItemsSummary(null)).toBe('');
      expect(formatItemsSummary(undefined)).toBe('');
      expect(formatItemsSummary([])).toBe('');
    });

    it('formats single item correctly', () => {
      const items: NutritionItem[] = [
        {
          id: 'item-1',
          name: 'Chicken Breast',
          quantity: 200,
          unit: 'g',
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
          fiber: 0,
        },
      ];
      expect(formatItemsSummary(items)).toBe('Chicken Breast (200g: 330kcal, 62P/0C/7F)');
    });

    it('formats multiple items separated by semicolon space', () => {
      const items: NutritionItem[] = [
        {
          id: 'item-1',
          name: 'Chicken Breast',
          quantity: 200,
          unit: 'g',
          calories: 330,
          protein: 62,
          carbs: 0,
          fat: 7,
          fiber: 0,
        },
        {
          id: 'item-2',
          name: 'White Rice',
          quantity: 150,
          unit: 'g',
          calories: 195,
          protein: 4,
          carbs: 42,
          fat: 0.4,
          fiber: 1,
        },
      ];
      expect(formatItemsSummary(items)).toBe(
        'Chicken Breast (200g: 330kcal, 62P/0C/7F); White Rice (150g: 195kcal, 4P/42C/0.4F)'
      );
    });
  });

  describe('serializeToExportJson', () => {
    const mockBundle: ExportBundle = {
      schema_version: '1.0',
      exported_at: '2026-09-23T12:00:00.000Z',
      target_user: {
        id: 'usr-1',
        username: 'alex_runner',
        email: 'alex@example.com',
        exported_by_role: 'athlete',
      },
      filters: {
        preset: '30d',
        start_date: '2026-08-24',
        end_date: '2026-09-23',
        domains: ['workouts', 'nutrition_logs'],
      },
      data: {
        workouts: [
          {
            id: 'w-1',
            user_id: 'usr-1',
            name: 'Leg Day',
            date: '2026-09-20',
            sets: [],
          },
        ],
        nutrition_logs: [
          {
            id: 'n-1',
            user_id: 'usr-1',
            food_name: 'Protein Shake',
            calories: 250,
            protein: 30,
            carbs: 10,
            fat: 3,
            fiber: 2,
            logged_at: '2026-09-20T10:00:00Z',
          },
        ],
      },
    };

    it('serializes bundle to valid formatted JSON file', () => {
      const file = serializeToExportJson(mockBundle);
      expect(file.filename).toBe('yourbody-export-alex_runner-2026-09-23.json');
      expect(file.mimeType).toBe('application/json;charset=utf-8');

      const parsed = JSON.parse(file.content);
      expect(parsed.schema_version).toBe('1.0');
      expect(parsed.target_user.username).toBe('alex_runner');
      expect(parsed.filters.domains).toEqual(['workouts', 'nutrition_logs']);
      expect(parsed.data.workouts).toHaveLength(1);
      expect(parsed.data.nutrition_logs).toHaveLength(1);
      expect(parsed.data.custom_dishes).toBeUndefined();
    });

    it('includes weight_unit in profile section and keeps sets weight as canonical lb number', () => {
      const bundleWithProfile: ExportBundle = {
        ...mockBundle,
        filters: { ...mockBundle.filters, domains: ['workouts', 'profile'] },
        data: {
          ...mockBundle.data,
          profile: {
            id: 'usr-1',
            username: 'alex_runner',
            weight_unit: 'kg',
          },
          workouts: [
            {
              id: 'w-1',
              user_id: 'usr-1',
              name: 'Leg Day',
              date: '2026-09-20',
              sets: [
                {
                  id: 's-1',
                  workout_id: 'w-1',
                  exercise_id: 'ex-1',
                  set_index: 0,
                  set_type: 'working',
                  weight: 225,
                  reps: 5,
                },
              ],
            },
          ],
        },
      };

      const file = serializeToExportJson(bundleWithProfile);
      const parsed = JSON.parse(file.content);
      expect(parsed.data.profile.weight_unit).toBe('kg');
      expect(parsed.data.workouts[0].sets[0].weight).toBe(225);
      expect(typeof parsed.data.workouts[0].sets[0].weight).toBe('number');
    });
  });

  describe('serializeToExportCsvFiles', () => {
    const mockBundle: ExportBundle = {
      schema_version: '1.0',
      exported_at: '2026-09-23T12:00:00.000Z',
      target_user: {
        id: 'usr-1',
        username: 'alex_runner',
        email: 'alex@example.com',
        exported_by_role: 'athlete',
      },
      filters: {
        preset: '30d',
        start_date: '2026-08-24',
        end_date: '2026-09-23',
        domains: ['workouts', 'nutrition_logs', 'custom_dishes', 'routines', 'profile'],
      },
      data: {
        profile: {
          id: 'usr-1',
          username: 'alex_runner',
          email: 'alex@example.com',
          role: 'athlete',
          target_calories: 2400,
          target_protein: 180,
          target_carbs: 250,
          target_fat: 70,
          target_fiber: 35,
          auto_rest_timer: true,
          weight_unit: 'lb',
        },
        workouts: [
          {
            id: 'w-1',
            user_id: 'usr-1',
            name: 'Push Day',
            date: '2026-09-21',
            sets: [
              {
                id: 'set-1',
                workout_id: 'w-1',
                exercise_id: 'ex-1',
                exercise: { name: 'Bench Press', body_parts: ['Chest'] },
                set_index: 0,
                set_type: 'working',
                weight: 100,
                reps: 8,
                rpe: 8.5,
                created_at: '2026-09-21T10:05:00Z',
              },
            ],
          },
          {
            id: 'w-2',
            user_id: 'usr-1',
            name: 'Rest Day Walk',
            date: '2026-09-22',
            sets: [], // 0-set workout
          },
        ],
        nutrition_logs: [
          {
            id: 'nl-1',
            user_id: 'usr-1',
            logged_at: '2026-09-21T12:30:00Z',
            meal_type: 'lunch',
            food_name: 'Chicken Rice Bowl',
            calories: 650,
            protein: 52,
            carbs: 70,
            fat: 16,
            fiber: 6,
            serving_size: 1,
            serving_unit: 'bowl',
            has_components: true,
            notes: 'Post-workout fuel',
            items: [
              {
                id: 'it-1',
                name: 'Grilled Chicken Breast',
                quantity: 200,
                unit: 'g',
                calories: 330,
                protein: 62,
                carbs: 0,
                fat: 7,
                fiber: 0,
              },
            ],
          },
        ],
        custom_dishes: [
          {
            id: 'cd-1',
            user_id: 'usr-1',
            name: 'Morning Oats',
            kind: 'recipe',
            use_count: 12,
            calories: 450,
            protein: 25,
            carbs: 60,
            fat: 10,
            fiber: 8,
            notes: 'With almond milk',
            created_at: '2026-08-01T08:00:00Z',
            items: [
              {
                id: 'it-2',
                name: 'Rolled Oats',
                quantity: 80,
                unit: 'g',
                calories: 300,
                protein: 10,
                carbs: 54,
                fat: 5,
                fiber: 8,
              },
            ],
          },
        ],
        routines: [
          {
            id: 'rt-1',
            user_id: 'usr-1',
            name: '3-Day Split',
            is_master: false,
            assigned_to: null,
            days_of_week: ['Mon', 'Wed', 'Fri'],
            exercises: [
              {
                id: 'te-1',
                template_id: 'rt-1',
                exercise_id: 'ex-1',
                order_index: 0,
                target_sets: 4,
                target_reps: 8,
                exercise: { name: 'Bench Press', body_parts: ['Chest'] } as any,
              },
            ],
          },
        ],
      },
    };

    it('generates 1 csv file per included domain with exact headers', () => {
      const files = serializeToExportCsvFiles(mockBundle, '2026-09-23');
      expect(files).toHaveLength(5);

      const workoutsFile = files.find((f) => f.filename === 'yourbody-workouts-2026-09-23.csv')!;
      expect(workoutsFile).toBeDefined();
      expect(workoutsFile.content).toContain(
        'workout_id,workout_date,workout_name,set_index,set_type,exercise_name,body_part,weight,reps,rpe,set_created_at'
      );
      // w-1 has 1 set row
      expect(workoutsFile.content).toContain('w-1,2026-09-21,Push Day,0,working,Bench Press,Chest,100,8,8.5,2026-09-21T10:05:00Z');
      // w-2 has 0 sets, emits 1 summary row
      expect(workoutsFile.content).toContain('w-2,2026-09-22,Rest Day Walk,,,,,,,,');

      const nutritionFile = files.find((f) => f.filename === 'yourbody-nutrition-2026-09-23.csv')!;
      expect(nutritionFile).toBeDefined();
      expect(nutritionFile.content).toContain(
        'log_id,logged_at,meal_type,food_name,calories,protein_g,carbs_g,fat_g,fiber_g,serving_size,serving_unit,has_components,components_breakdown,notes'
      );
      expect(nutritionFile.content).toContain('nl-1,2026-09-21T12:30:00Z,lunch,Chicken Rice Bowl,650,52,70,16,6,1,bowl,true');

      const dishesFile = files.find((f) => f.filename === 'yourbody-custom-dishes-2026-09-23.csv')!;
      expect(dishesFile).toBeDefined();
      expect(dishesFile.content).toContain(
        'dish_id,name,kind,use_count,calories,protein_g,carbs_g,fat_g,fiber_g,components_breakdown,notes,created_at'
      );
      expect(dishesFile.content).toContain('cd-1,Morning Oats,recipe,12,450,25,60,10,8');

      const routinesFile = files.find((f) => f.filename === 'yourbody-routines-2026-09-23.csv')!;
      expect(routinesFile).toBeDefined();
      expect(routinesFile.content).toContain(
        'template_id,routine_name,days_of_week,is_master,assigned_to,order_index,exercise_name,body_part,target_sets,target_reps'
      );
      expect(routinesFile.content).toContain('rt-1,3-Day Split,Mon;Wed;Fri,false,,0,Bench Press,Chest,4,8');

      const profileFile = files.find((f) => f.filename === 'yourbody-profile-2026-09-23.csv')!;
      expect(profileFile).toBeDefined();
      expect(profileFile.content).toContain(
        'user_id,username,email,role,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fiber_g,auto_rest_timer,weight_unit'
      );
      expect(profileFile.content).toContain('usr-1,alex_runner,alex@example.com,athlete,2400,180,250,70,35,true,lb');
    });

    it('only generates csv files for requested domains in filters.domains', () => {
      const partialBundle: ExportBundle = {
        ...mockBundle,
        filters: {
          ...mockBundle.filters,
          domains: ['workouts'],
        },
      };
      const files = serializeToExportCsvFiles(partialBundle, '2026-09-23');
      expect(files).toHaveLength(1);
      expect(files[0].filename).toBe('yourbody-workouts-2026-09-23.csv');
    });

    it('exports profile CSV with weight_unit and preserves canonical lb weight column in workouts CSV', () => {
      const bundle: ExportBundle = {
        ...mockBundle,
        filters: { preset: 'all', start_date: null, end_date: null, domains: ['workouts', 'profile'] },
        data: {
          profile: {
            id: 'usr-1',
            username: 'alex_runner',
            email: 'alex@example.com',
            role: 'athlete',
            target_calories: 2400,
            target_protein: 180,
            target_carbs: 250,
            target_fat: 70,
            target_fiber: 35,
            auto_rest_timer: true,
            weight_unit: 'kg',
          },
          workouts: [
            {
              id: 'w-1',
              user_id: 'usr-1',
              name: 'Push Day',
              date: '2026-09-21',
              sets: [
                {
                  id: 'set-1',
                  workout_id: 'w-1',
                  exercise_id: 'ex-1',
                  exercise: { name: 'Bench Press', body_parts: ['Chest'] },
                  set_index: 0,
                  set_type: 'working',
                  weight: 225,
                  reps: 5,
                  rpe: 8.5,
                  created_at: '2026-09-21T10:05:00Z',
                },
              ],
            },
          ],
        },
      };

      const files = serializeToExportCsvFiles(bundle, '2026-09-28');
      const profileCsv = files.find((f) => f.filename === 'yourbody-profile-2026-09-28.csv')!;
      expect(profileCsv).toBeDefined();
      expect(profileCsv.content).toContain(
        'user_id,username,email,role,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fiber_g,auto_rest_timer,weight_unit'
      );
      expect(profileCsv.content).toContain('usr-1,alex_runner,alex@example.com,athlete,2400,180,250,70,35,true,kg');

      const workoutsCsv = files.find((f) => f.filename === 'yourbody-workouts-2026-09-28.csv')!;
      expect(workoutsCsv).toBeDefined();
      expect(workoutsCsv.content).toContain(
        'workout_id,workout_date,workout_name,set_index,set_type,exercise_name,body_part,weight,reps,rpe,set_created_at'
      );
      expect(workoutsCsv.content).toContain('w-1,2026-09-21,Push Day,0,working,Bench Press,Chest,225,5,8.5,2026-09-21T10:05:00Z');
    });
  });

  describe('fetchExportBundle (Paginated fetchers & Guardrails)', () => {
    const baseOptions: DataExportOptions = {
      targetUserId: 'usr-1',
      targetUsername: 'alex_runner',
      targetEmail: 'alex@example.com',
      exportedByRole: 'athlete',
      isSelfExport: true,
      domains: ['workouts', 'nutrition_logs', 'custom_dishes', 'routines', 'profile'],
      format: 'json',
      preset: '30d',
      now: new Date('2026-09-23T12:00:00Z'),
    };

    it('paginates over multiple pages until rows < EXPORT_PAGE_SIZE', async () => {
      // Setup mock to return 250 rows on page 0 and 10 rows on page 1
      const page1 = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({
        id: `w-${i}`,
        user_id: 'usr-1',
        name: `Workout ${i}`,
        date: '2026-09-10',
        sets: [],
      }));
      const page2 = Array.from({ length: 10 }, (_, i) => ({
        id: `w-${EXPORT_PAGE_SIZE + i}`,
        user_id: 'usr-1',
        name: `Workout ${EXPORT_PAGE_SIZE + i}`,
        date: '2026-09-09',
        sets: [],
      }));

      const workoutBuilders: SupabaseQueryBuilderMock[] = [];
      const allWorkouts = [...page1, ...page2];
      const fromSpy = vi.spyOn(mockSupabase, 'from').mockImplementation((table: string) => {
        if (table === 'workouts') {
          const b = new SupabaseQueryBuilderMock('workouts', {
            data: allWorkouts,
          });
          workoutBuilders.push(b);
          return b;
        }
        if (table === 'users') {
          return new SupabaseQueryBuilderMock('users', {
            data: { id: 'usr-1', username: 'alex_runner', role: 'athlete' },
          });
        }
        return new SupabaseQueryBuilderMock(table, { data: [] });
      });

      const progressLogs: string[] = [];
      try {
        const bundle = await fetchExportBundle(baseOptions, (msg) => progressLogs.push(msg));

        expect(bundle.data.workouts).toHaveLength(260);
        expect(progressLogs.some((msg) => msg.includes('workouts'))).toBe(true);

        expect(workoutBuilders.length).toBe(2);
        expect(workoutBuilders[0].rangeBounds).toEqual({ from: 0, to: 249, options: undefined });
        expect(workoutBuilders[1].rangeBounds).toEqual({ from: 250, to: 499, options: undefined });
      } finally {
        fromSpy.mockRestore();
      }
    });

    it('defense-in-depth: excludes custom_dishes when isSelfExport is false (Coach export)', async () => {
      mockSupabase.setTableData('workouts', []);
      mockSupabase.setTableData('nutrition_logs', []);
      mockSupabase.setTableData('custom_dishes', [
        { id: 'cd-1', name: 'Private Dish', user_id: 'athlete-1' },
      ]);
      mockSupabase.setTableData('routine_templates', []);
      mockSupabase.setTableData('users', { id: 'athlete-1', username: 'athlete_1', role: 'athlete' });

      const coachOptions: DataExportOptions = {
        ...baseOptions,
        targetUserId: 'athlete-1',
        targetUsername: 'athlete_1',
        exportedByRole: 'coach',
        isSelfExport: false,
        domains: ['workouts', 'custom_dishes', 'profile'],
      };

      const bundle = await fetchExportBundle(coachOptions);

      expect(bundle.filters.domains).not.toContain('custom_dishes');
      expect(bundle.data.custom_dishes).toBeUndefined();

      // Verify custom_dishes was never queried on Supabase
      const dishBuilders = mockSupabase.getBuilders('custom_dishes');
      expect(dishBuilders.length).toBe(0);
    });

    it('applies date bounds filtering to workouts and nutrition_logs', async () => {
      mockSupabase.setTableData('workouts', []);
      mockSupabase.setTableData('nutrition_logs', []);
      mockSupabase.setTableData('custom_dishes', []);
      mockSupabase.setTableData('routine_templates', []);
      mockSupabase.setTableData('users', null);

      await fetchExportBundle({
        ...baseOptions,
        preset: '7d',
        domains: ['workouts', 'nutrition_logs'],
      });

      const workoutBuilder = mockSupabase.getLastBuilder('workouts')!;
      expect(workoutBuilder.filters.some((f) => f.column === 'date' && f.method === 'gte')).toBe(true);
      expect(workoutBuilder.filters.some((f) => f.column === 'date' && f.method === 'lte')).toBe(true);

      const nutritionBuilder = mockSupabase.getLastBuilder('nutrition_logs')!;
      expect(nutritionBuilder.filters.some((f) => f.column === 'logged_at' && f.method === 'gte')).toBe(true);
      expect(nutritionBuilder.filters.some((f) => f.column === 'logged_at' && f.method === 'lte')).toBe(true);
    });

    it('throws error when Supabase query returns an error', async () => {
      mockSupabase.setTableData('workouts', null, new Error('Network error'));

      await expect(
        fetchExportBundle({
          ...baseOptions,
          domains: ['workouts'],
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('executeDataExport and downloadExportFiles', () => {
    it('executes JSON export and returns single json GeneratedExportFile', async () => {
      mockSupabase.setTableData('workouts', []);
      mockSupabase.setTableData('nutrition_logs', []);
      mockSupabase.setTableData('custom_dishes', []);
      mockSupabase.setTableData('routine_templates', []);
      mockSupabase.setTableData('users', { id: 'usr-1', username: 'alex_runner' });

      const files = await executeDataExport({
        targetUserId: 'usr-1',
        targetUsername: 'alex_runner',
        targetEmail: null,
        exportedByRole: 'athlete',
        isSelfExport: true,
        domains: ['workouts'],
        format: 'json',
        preset: '30d',
      });

      expect(files).toHaveLength(1);
      expect(files[0].filename).toMatch(/\.json$/);
      expect(files[0].mimeType).toBe('application/json;charset=utf-8');
    });

    it('executes CSV export and returns multiple csv files', async () => {
      mockSupabase.setTableData('workouts', []);
      mockSupabase.setTableData('nutrition_logs', []);
      mockSupabase.setTableData('custom_dishes', []);
      mockSupabase.setTableData('routine_templates', []);
      mockSupabase.setTableData('users', { id: 'usr-1', username: 'alex_runner' });

      const files = await executeDataExport({
        targetUserId: 'usr-1',
        targetUsername: 'alex_runner',
        targetEmail: null,
        exportedByRole: 'athlete',
        isSelfExport: true,
        domains: ['workouts', 'profile'],
        format: 'csv',
        preset: 'all',
      });

      expect(files).toHaveLength(2);
      expect(files[0].filename).toMatch(/\.csv$/);
      expect(files[1].filename).toMatch(/\.csv$/);
      expect(files[0].mimeType).toBe('text/csv;charset=utf-8');
    });

    it('triggers browser download for each file', () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      const createObjectURLSpy = vi.fn().mockReturnValue('blob:http://localhost/test-uuid');
      const revokeObjectURLSpy = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLSpy;
      globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

      const files: GeneratedExportFile[] = [
        { filename: 'test1.csv', mimeType: 'text/csv', content: 'a,b,c' },
        { filename: 'test2.csv', mimeType: 'text/csv', content: 'd,e,f' },
      ];

      downloadExportFiles(files);

      expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
      expect(clickSpy).toHaveBeenCalledTimes(2);
      expect(appendChildSpy).toHaveBeenCalledTimes(2);
      expect(removeChildSpy).toHaveBeenCalledTimes(2);

      clickSpy.mockRestore();
    });
  });

  describe('Static Projection Constants', () => {
    it('defines expected projection string constants', () => {
      expect(WORKOUT_EXPORT_PROJECTION).toContain('sets(');
      expect(NUTRITION_EXPORT_PROJECTION).toContain('items');
      expect(CUSTOM_DISH_EXPORT_PROJECTION).toContain('items');
      expect(ROUTINE_EXPORT_PROJECTION).toContain('template_exercises(');
    });
  });

  describe('Database Contract Fidelity', () => {
    it('services exact projection contracts for all export tables', async () => {
      await fetchExportBundle({
        targetUserId: 'user-1',
        targetUsername: 'tester',
        targetEmail: 'test@example.com',
        exportedByRole: 'athlete',
        isSelfExport: true,
        domains: ['workouts', 'nutrition_logs', 'custom_dishes', 'routines', 'profile'],
        format: 'json',
        preset: 'all',
      });

      const recorded = getRecordedSelects();
      expect(getRecordedTables()).toEqual(
        expect.arrayContaining(['workouts', 'nutrition_logs', 'custom_dishes', 'routine_templates', 'users'])
      );
      expect(recorded).toContainEqual({
        table: 'workouts',
        projection: WORKOUT_EXPORT_PROJECTION,
      });
      expect(recorded).toContainEqual({
        table: 'nutrition_logs',
        projection: NUTRITION_EXPORT_PROJECTION,
      });
      expect(recorded).toContainEqual({
        table: 'custom_dishes',
        projection: CUSTOM_DISH_EXPORT_PROJECTION,
      });
      expect(recorded).toContainEqual({
        table: 'routine_templates',
        projection: ROUTINE_EXPORT_PROJECTION,
      });
      expect(recorded).toContainEqual({
        table: 'users',
        projection: 'id, username, email, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, timezone, weight_unit',
      });
    });
  });
});
