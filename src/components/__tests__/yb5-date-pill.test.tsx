import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { build, type Rollup } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { NutritionDashboardRings, type NutritionDashboardRingsProps } from '../nutrition/NutritionDashboardRings';
import { WorkoutHeader } from '../workout/WorkoutHeader';
import { StagedMealCard } from '../nutrition/StagedMealCard';
import type { StagedMeal } from '../nutrition/nutritionEngineHelpers';
import { DataExportCard } from '../settings/DataExportCard';
import type { UserProfile } from '../../types/database';


vi.mock('../../utils/dataExport', async () => {
  const actual = await vi.importActual<typeof import('../../utils/dataExport')>('../../utils/dataExport');
  return {
    ...actual,
    executeDataExport: vi.fn().mockResolvedValue([]),
    downloadExportFiles: vi.fn(),
  };
});

describe('YB5 iOS date-pill styling contracts', () => {
  describe('(a) DOM class presence and absence contracts', () => {
    it('applies date-pill class to NutritionDashboardRings date input', () => {
      const nutritionProps: NutritionDashboardRingsProps = {
        selectedDate: '2026-10-04',
        onDateChange: vi.fn(),
        dailyTotals: { calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 },
        targets: { calories: 2000, protein: 150, carbs: 200, fat: 70, fiber: 30 },
        remainingFuel: {
          calories: { badgeLabel: '0 kcal', isOver: false },
          protein: { badgeLabel: '0g P', isOver: false },
          carbs: { badgeLabel: '0g C', isOver: false },
          fat: { badgeLabel: '0g F', isOver: false },
          fiber: { badgeLabel: '0g Fib', isOver: false },
        },
        onSelectBreakdownNutrient: vi.fn(),
      };

      render(<NutritionDashboardRings {...nutritionProps} />);
      const dateInput = screen.getByTestId('nutrition-date-input');
      expect(dateInput.classList.contains('date-pill')).toBe(true);
    });

    it('applies date-pill class to WorkoutHeader date input', () => {
      const workoutProps = {
        mutationError: null,
        onClearMutationError: vi.fn(),
        activeRoutineName: 'Chest Day',
        onOpenRoutineModal: vi.fn(),
        workoutDate: '2026-10-04',
        onDateChange: vi.fn(),
        onClearWorkout: vi.fn(),
      };

      render(<WorkoutHeader {...workoutProps} />);
      const dateInput = screen.getByTestId('workout-date-input');
      expect(dateInput.classList.contains('date-pill')).toBe(true);
    });

    it('applies date-pill class to StagedMealCard edit date input', () => {
      const meal: StagedMeal = {
        name: 'Post-Workout Shake',
        mealType: 'Snack',
        explanation: 'Single item shake',
        servingSize: 1,
        servingUnit: 'serving',
        calories: 300,
        protein: 30,
        carbs: 20,
        fat: 5,
        fiber: 2,
        items: [],
      };

      const stagedMealProps = {
        mode: 'edit' as const,
        stagedMeal: meal,
        date: '2026-10-04',
        isDirty: false,
        isPending: false,
        onDateChange: vi.fn(),
        onCancel: vi.fn(),
        onLogStagedMeal: vi.fn(),
        onUpdateStagedMeal: vi.fn(),
        onApplyStagedItemChange: vi.fn(),
        onDeleteItem: vi.fn(),
        onSaveItemAsCustomDish: vi.fn(),
        onSaveStagedAsCustomDish: vi.fn(),
        onDiscardStagedMeal: vi.fn(),
      };

      render(<StagedMealCard {...stagedMealProps} />);
      const dateInput = screen.getByTestId('edit-meal-date-input');
      expect(dateInput.classList.contains('date-pill')).toBe(true);
    });

    it('does NOT apply date-pill class to DataExportCard date inputs', () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const profile: UserProfile = {
        id: 'test-user',
        email: 'athlete@example.com',
        username: 'Athlete',
        role: 'athlete',
        is_coach_mode: false,
        coach_code: null,
        coach_tier: undefined,
        max_athletes: undefined,
        target_calories: 2000,
        target_protein: 150,
        target_carbs: 200,
        target_fat: 70,
        target_fiber: 30,
        timezone: 'America/New_York',
        created_at: '2026-01-01T00:00:00Z',
      };

      render(
        <QueryClientProvider client={queryClient}>
          <DataExportCard profile={profile} hasCoachCapability={false} />
        </QueryClientProvider>
      );

      // Expand export panel and select custom range preset
      fireEvent.click(screen.getByTestId('toggle-data-export-btn'));
      fireEvent.click(screen.getByTestId('export-preset-custom'));

      const startInput = screen.getByTestId('export-custom-start');
      const endInput = screen.getByTestId('export-custom-end');

      expect(startInput.classList.contains('date-pill')).toBe(false);
      expect(endInput.classList.contains('date-pill')).toBe(false);
    });
  });

async function buildIndexCss(): Promise<string> {
  const result = await build({
    configFile: false,
    plugins: [
      tailwindcss(),
      {
        name: 'test-entry-css',
        resolveId(id: string) {
          if (id === 'virtual:entry.css') return id;
        },
        load(id: string) {
          if (id === 'virtual:entry.css') {
            return '@import "./src/index.css";';
          }
        },
      },
    ],
    build: {
      write: false,
      rollupOptions: {
        input: 'virtual:entry.css',
      },
    },
    logLevel: 'silent',
  });

  const output = Array.isArray(result) ? result[0].output : (result as Rollup.RollupOutput).output;
  for (const item of output) {
    if (item.fileName.endsWith('.css') && 'source' in item) {
      return typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf-8');
    }
  }
  throw new Error('No CSS output produced by Vite build of src/index.css');
}

  describe('(b) Built CSS presence contract (hermetic in-memory Vite build)', () => {
    it('produces CSS from src/index.css containing .date-pill and .date-pill::-webkit-date-and-time-value rules with text-align:center and ::-webkit-datetime-edit centring', async () => {
      const cssContent = await buildIndexCss();

      // 1. .date-pill rule with text-align:center
      expect(cssContent).toMatch(/\.date-pill\s*\{[^}]*text-align:\s*center/);

      // 2. .date-pill::-webkit-date-and-time-value rule with text-align:center
      expect(cssContent).toMatch(/\.date-pill::-webkit-date-and-time-value\s*\{[^}]*text-align:\s*center/);

      // 3. the fit-content value box itself is centred in the input (WebKit/iOS)
      expect(cssContent).toMatch(/\.date-pill::-webkit-date-and-time-value\s*\{[^}]*margin-inline:\s*auto/);

      // 4. Chromium centring for ::-webkit-datetime-edit
      expect(cssContent).toMatch(/\.date-pill::-webkit-datetime-edit\s*\{[^}]*justify-content:\s*center/);
    }, 20000);
  });
});
