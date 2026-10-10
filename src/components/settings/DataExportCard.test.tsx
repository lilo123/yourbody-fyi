import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataExportCard } from './DataExportCard';
import { CoachContext, type CoachContextType } from '../../context/CoachContextTypes';
import { expectNoA11yViolations } from '../../test/a11y';
import type { UserProfile } from '../../types/database';
import * as dataExportUtils from '../../utils/dataExport';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedSelects } from '../../test/supabaseBuilderMock';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../../utils/dataExport', async () => {
  const actual = await vi.importActual<typeof import('../../utils/dataExport')>('../../utils/dataExport');
  return {
    ...actual,
    executeDataExport: vi.fn().mockResolvedValue([
      { filename: 'yourbody-export.json', mimeType: 'application/json', content: '{}' },
    ]),
    downloadExportFiles: vi.fn(),
  };
});

describe('DataExportCard', () => {
  let queryClient: QueryClient;

  const mockProfile: UserProfile = {
    id: 'user-coach-1',
    email: 'coach@test.com',
    username: 'Coach Test',
    role: 'coach',
    is_coach_mode: true,
    coach_code: 'TEST-1234',
    coach_tier: 'pro',
    max_athletes: 10,
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
    timezone: 'America/New_York',
    created_at: new Date().toISOString(),
  };

  const mockCoachContextValue: CoachContextType = {
    selectedAthleteId: 'athlete-1',
    selectedAthlete: { id: 'athlete-1', name: 'Alex Rivera', email: 'alex@test.com' },
    athletes: [
      { id: 'athlete-1', name: 'Alex Rivera', email: 'alex@test.com' },
      { id: 'athlete-2', name: 'Jordan Lee', email: 'jordan@test.com' },
    ],
    isCoach: true,
    switchAthlete: vi.fn(),
    refreshAthletes: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'coach_athlete_links') {
        return createSupabaseBuilder('coach_athlete_links', {
          data: [
            {
              athlete_id: 'athlete-lazy-1',
              status: 'active',
              linked_at: '2026-09-01T00:00:00Z',
              athlete: { id: 'athlete-lazy-1', username: 'Sam Taylor', email: 'sam@test.com' },
            },
          ],
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });
  });

  const renderCard = (props: {
    profile?: UserProfile | null;
    hasCoachCapability?: boolean;
    coachCtx?: CoachContextType;
  } = {}) => {
    const {
      profile = mockProfile,
      hasCoachCapability = false,
      coachCtx,
    } = props;

    return render(
      <QueryClientProvider client={queryClient}>
        {coachCtx ? (
          <CoachContext.Provider value={coachCtx}>
            <DataExportCard profile={profile} hasCoachCapability={hasCoachCapability} />
          </CoachContext.Provider>
        ) : (
          <DataExportCard profile={profile} hasCoachCapability={hasCoachCapability} />
        )}
      </QueryClientProvider>
    );
  };

  it('renders in resting collapsed state by default with ZERO supabase queries', () => {
    renderCard();

    expect(screen.getByText('Data Extract')).toBeDefined();
    expect(
      screen.getByText('Download your workouts, nutrition logs, routines, or full backup.')
    ).toBeDefined();

    const toggleBtn = screen.getByTestId('toggle-data-export-btn');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(toggleBtn.textContent).toContain('Configure Export');

    // Controls must NOT be visible when collapsed
    expect(screen.queryByTestId('download-export-btn')).toBeNull();
    expect(screen.queryByTestId('export-format-json')).toBeNull();

    // Zero Supabase queries performed in resting collapsed state
    expect(getRecordedSelects()).toHaveLength(0);
  });

  it('passes axe accessibility audits in resting collapsed state', async () => {
    const { container } = renderCard();
    await expectNoA11yViolations(container);
  });

  it('expands when clicking Configure Export and reveals form controls', async () => {
    const { container } = renderCard();

    const toggleBtn = screen.getByTestId('toggle-data-export-btn');
    fireEvent.click(toggleBtn);

    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('download-export-btn')).toBeDefined();
    expect(screen.getByTestId('export-format-json')).toBeDefined();
    expect(screen.getByTestId('export-format-csv')).toBeDefined();

    // Verify default domain buttons
    expect(screen.getByTestId('export-domain-workouts')).toBeDefined();
    expect(screen.getByTestId('export-domain-nutrition_logs')).toBeDefined();
    expect(screen.getByTestId('export-domain-custom_dishes')).toBeDefined();
    expect(screen.getByTestId('export-domain-routines')).toBeDefined();
    expect(screen.getByTestId('export-domain-profile')).toBeDefined();

    // Default presets
    expect(screen.getByTestId('export-preset-30d').getAttribute('aria-pressed')).toBe('true');

    await expectNoA11yViolations(container);
  });

  it('toggles domain selections and responds to Select All button', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const workoutsBtn = screen.getByTestId('export-domain-workouts');
    const nutritionBtn = screen.getByTestId('export-domain-nutrition_logs');
    const dishesBtn = screen.getByTestId('export-domain-custom_dishes');
    const selectAllBtn = screen.getByTestId('export-select-all-btn');

    // Default: workouts and nutrition are checked
    expect(workoutsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(nutritionBtn.getAttribute('aria-pressed')).toBe('true');
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('false');

    // Toggle workouts off
    fireEvent.click(workoutsBtn);
    expect(workoutsBtn.getAttribute('aria-pressed')).toBe('false');

    // Toggle dishes on
    fireEvent.click(dishesBtn);
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('true');

    // Click Select All
    fireEvent.click(selectAllBtn);
    expect(workoutsBtn.getAttribute('aria-pressed')).toBe('true');
    expect(nutritionBtn.getAttribute('aria-pressed')).toBe('true');
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('export-domain-routines').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('export-domain-profile').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables download button when zero domains are selected', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const downloadBtn = screen.getByTestId('download-export-btn') as HTMLButtonElement;
    expect(downloadBtn.disabled).toBe(false);

    // Deselect the two default domains
    fireEvent.click(screen.getByTestId('export-domain-workouts'));
    fireEvent.click(screen.getByTestId('export-domain-nutrition_logs'));

    expect(downloadBtn.disabled).toBe(true);
  });

  it('toggles between JSON and CSV format buttons', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const jsonBtn = screen.getByTestId('export-format-json');
    const csvBtn = screen.getByTestId('export-format-csv');

    expect(jsonBtn.getAttribute('aria-pressed')).toBe('true');
    expect(csvBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(csvBtn);
    expect(jsonBtn.getAttribute('aria-pressed')).toBe('false');
    expect(csvBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders custom date inputs when custom preset is selected', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    expect(screen.queryByTestId('export-custom-start')).toBeNull();
    expect(screen.queryByTestId('export-custom-end')).toBeNull();

    fireEvent.click(screen.getByTestId('export-preset-custom'));

    const startInput = screen.getByTestId('export-custom-start');
    const endInput = screen.getByTestId('export-custom-end');
    expect(startInput).toBeDefined();
    expect(endInput).toBeDefined();

    fireEvent.change(startInput, { target: { value: '2026-01-01' } });
    fireEvent.change(endInput, { target: { value: '2026-03-31' } });

    expect((startInput as HTMLInputElement).value).toBe('2026-01-01');
    expect((endInput as HTMLInputElement).value).toBe('2026-03-31');
  });

  it('supports Coach Mode: displays Target Account select and auto-disables Custom Dishes for athletes', async () => {
    renderCard({
      hasCoachCapability: true,
      coachCtx: mockCoachContextValue,
    });

    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const targetSelect = screen.getByTestId('export-target-select') as HTMLSelectElement;
    expect(targetSelect).toBeDefined();
    expect(screen.getByLabelText(/Target Account/i)).toBe(targetSelect);

    // Check options
    expect(targetSelect.options).toHaveLength(3); // self + 2 athletes
    expect(targetSelect.options[0].text).toContain('My Personal Data');
    expect(targetSelect.options[1].text).toContain('Alex Rivera');
    expect(targetSelect.options[2].text).toContain('Jordan Lee');

    // First select Custom Dishes to true
    const dishesBtn = screen.getByTestId('export-domain-custom_dishes') as HTMLButtonElement;
    fireEvent.click(dishesBtn);
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('true');
    expect(dishesBtn.disabled).toBe(false);

    // Switch target to Athlete 1
    fireEvent.change(targetSelect, { target: { value: 'athlete-1' } });

    // Custom Dishes should now be unchecked and disabled with owner-only notice
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('false');
    expect(dishesBtn.disabled).toBe(true);
    expect(screen.getByText(/Owner-only/i)).toBeDefined();

    // Select All when athlete is selected should NOT select Custom Dishes
    fireEvent.click(screen.getByTestId('export-select-all-btn'));
    expect(dishesBtn.getAttribute('aria-pressed')).toBe('false');

    // Switching back to self re-enables Custom Dishes
    fireEvent.change(targetSelect, { target: { value: 'self' } });
    expect(dishesBtn.disabled).toBe(false);
  });

  it('lazily queries active linked athletes when coach context is empty in coach mode', async () => {
    renderCard({
      hasCoachCapability: true,
      // No CoachContext.Provider, so coachCtx is undefined
    });

    // Before expanding, 0 queries
    expect(getRecordedSelects()).toHaveLength(0);

    // Expand
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    // Wait for the lazy query to populate target select
    const targetSelect = await screen.findByTestId('export-target-select');
    expect(targetSelect).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/Sam Taylor/i)).toBeDefined();
    });

    expect(getRecordedSelects()).toContainEqual({
      table: 'coach_athlete_links',
      projection: 'athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)',
    });
  });

  it('triggers executeDataExport and downloadExportFiles on clicking Download Export', async () => {
    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const downloadBtn = screen.getByTestId('download-export-btn');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(dataExportUtils.executeDataExport).toHaveBeenCalledWith(
        expect.objectContaining({
          targetUserId: 'user-coach-1',
          format: 'json',
          preset: '30d',
          domains: expect.arrayContaining(['workouts', 'nutrition_logs']),
          isSelfExport: true,
        }),
        expect.any(Function)
      );
      expect(dataExportUtils.downloadExportFiles).toHaveBeenCalled();
    });

    const statusText = screen.getByTestId('export-status-text');
    expect(statusText.textContent).toContain('Export complete');
  });

  it('displays error status when export fails', async () => {
    vi.mocked(dataExportUtils.executeDataExport).mockRejectedValueOnce(
      new Error('Supabase network timeout')
    );

    renderCard();
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const downloadBtn = screen.getByTestId('download-export-btn');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      const statusText = screen.getByTestId('export-status-text');
      expect(statusText.textContent).toContain('Supabase network timeout');
    });
  });

  it('displays error message if self-export is attempted without loaded profile', async () => {
    renderCard({ profile: null });
    fireEvent.click(screen.getByTestId('toggle-data-export-btn'));

    const downloadBtn = screen.getByTestId('download-export-btn');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      const statusText = screen.getByTestId('export-status-text');
      expect(statusText.textContent).toContain('user profile is not loaded');
    });
    expect(dataExportUtils.executeDataExport).not.toHaveBeenCalled();
  });
});
