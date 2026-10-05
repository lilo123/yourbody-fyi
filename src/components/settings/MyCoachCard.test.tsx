import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyCoachCard } from './MyCoachCard';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { expectNoA11yViolations } from '../../test/a11y';
import type { UserProfile } from '../../types/database';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables, getRecordedSelects } from '../../test/supabaseBuilderMock';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

vi.mock('../../hooks/useOnlineStatus');

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: null, error: null })),
    rpc: vi.fn().mockImplementation((fn: string, args: any) => {
      if (fn === 'link_to_coach') {
        if (args?.input_code === 'INVALID') {
          return Promise.resolve({ data: { success: false, error: 'Invalid coach code.' }, error: null });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    }),
  },
}));

describe('MyCoachCard accessibility and live regions', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
  });

  const mockProfile: UserProfile = {
    id: 'athlete-123',
    email: 'athlete@test.com',
    username: 'Athlete Test',
    role: 'athlete',
    is_coach_mode: false,
    coach_code: null,
    coach_tier: undefined,
    max_athletes: undefined,
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
    created_at: new Date().toISOString(),
  };

  const renderCard = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MyCoachCard profile={mockProfile} />
          <ToastHost />
        </ToastProvider>
      </QueryClientProvider>
    );

  it('passes axe accessibility audits with no violations', async () => {
    const { container } = renderCard();
    await expectNoA11yViolations(container);
  });

  it('mounts live regions while idle and mutates in place on coach linking status (WCAG SC 4.1.3)', async () => {
    const { container } = renderCard();

    const polite = container.querySelector('[role="status"]');
    const assertive = container.querySelector('[role="alert"]');

    // Both live regions must exist while idle and be empty
    expect(polite).not.toBeNull();
    expect(assertive).not.toBeNull();
    expect(polite!.textContent).toBe('');
    expect(assertive!.textContent).toBe('');
    expect(screen.queryByTestId('link-coach-status')).toBeNull();

    // Trigger error by submitting INVALID code
    const input = screen.getByTestId('link-coach-code-input');
    const form = input.closest('form')!;

    fireEvent.change(input, { target: { value: 'INVALID' } });
    fireEvent.submit(form);

    expect(await screen.findByTestId('link-coach-status')).toBeDefined();

    // Node identity preserved across transition (no unmount/remount)
    expect(container.querySelector('[role="status"]')).toBe(polite);
    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    expect(assertive!.textContent).toContain('Invalid coach code.');
    expect(polite!.textContent).toBe('');

    // Trigger success by submitting VALID code
    fireEvent.change(input, { target: { value: 'COACH1' } });
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByTestId('link-coach-status')).toHaveTextContent('Successfully linked to coach!');
    });

    expect(container.querySelector('[role="alert"]')).toBe(assertive);
    const politeSuccess = screen.getAllByRole('status').find((r) => r.textContent?.includes('Successfully linked to coach!'));
    expect(politeSuccess).toBeDefined();
    expect(assertive!.textContent).toBe('');
  });

  it('queries active coach link with exact projection', async () => {
    renderCard();
    expect(getRecordedTables()).toContain('coach_athlete_links');
    expect(getRecordedSelects()).toContainEqual({
      table: 'coach_athlete_links',
      projection: 'id, coach_id, linked_at, coach:users!coach_id(username, email, coach_code)',
    });
  });

  it('disconnect ConfirmDialog Cancel = zero writes, Confirm = one write', async () => {
    const linkedCoachData = {
      id: 'link-1',
      coach_id: 'coach-99',
      linked_at: '2026-09-15T10:00:00Z',
      coach: {
        username: 'Coach Mike',
        email: 'coach@example.com',
        coach_code: 'MIKE-FIT',
      },
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'coach_athlete_links') {
        return createSupabaseBuilder('coach_athlete_links', { data: linkedCoachData, error: null });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyCoachCard profile={mockProfile} />
      </QueryClientProvider>
    );

    expect(await screen.findByText('Coach Mike')).toBeDefined();
    expect(screen.getByText(/MIKE-FIT/)).toBeDefined();

    // Click disconnect button to open ConfirmDialog
    const disconnectBtn = screen.getByTestId('disconnect-coach-btn');
    fireEvent.click(disconnectBtn);

    // Confirm dialog is open and names the coach
    const dialog = await screen.findByTestId('disconnect-coach-confirm-dialog');
    expect(dialog).toBeDefined();
    expect(dialog.textContent).toContain('Coach Mike');

    // Clicking Cancel = zero writes (no rpc call)
    const cancelBtn = screen.getByTestId('disconnect-coach-confirm-dialog-cancel');
    fireEvent.click(cancelBtn);
    expect(supabase.rpc).not.toHaveBeenCalledWith('disconnect_coach');

    // Click disconnect again, then Confirm = one write
    fireEvent.click(disconnectBtn);
    const confirmBtn = await screen.findByTestId('disconnect-coach-confirm-dialog-confirm');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('disconnect_coach');
    });
    expect((supabase.rpc as any).mock.calls.filter((c: any[]) => c[0] === 'disconnect_coach')).toHaveLength(1);
  });

  it('surfaces query error with StatusBanner and Retry refetches', async () => {
    let shouldFail = true;
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'coach_athlete_links') {
        if (shouldFail) {
          return createSupabaseBuilder('coach_athlete_links', {
            data: null,
            error: new Error('Network timeout connecting to coach service'),
          });
        }
        return createSupabaseBuilder('coach_athlete_links', {
          data: {
            id: 'link-1',
            coach_id: 'coach-99',
            linked_at: '2026-09-15T10:00:00Z',
            coach: { username: 'Coach Mike', email: 'coach@example.com', coach_code: 'MIKE-FIT' },
          },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyCoachCard profile={mockProfile} />
      </QueryClientProvider>
    );

    const errorBanner = await screen.findByTestId('coach-link-query-error');
    expect(errorBanner.textContent).toContain('Network timeout connecting to coach service');

    const retryBtn = screen.getByTestId('coach-link-retry-btn');
    expect(retryBtn).toBeDefined();

    // Now resolve query on retry
    shouldFail = false;
    fireEvent.click(retryBtn);

    expect(await screen.findByText('Coach Mike')).toBeDefined();
    expect(screen.queryByTestId('coach-link-query-error')).toBeNull();
  });

  it('renders skeleton loading card while coaching status is pending', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyCoachCard profile={null} />
      </QueryClientProvider>
    );

    const skeleton = screen.getByTestId('coach-link-loading');
    expect(skeleton).toBeDefined();
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
  });

  it('disables coach code input and button and shows "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    renderCard();

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const input = screen.getByTestId('link-coach-code-input');
    const linkBtn = screen.getByTestId('link-coach-btn');

    expect(input).toBeDisabled();
    expect(input.getAttribute('title')).toBe('Available when online');
    expect(linkBtn).toBeDisabled();
    expect(linkBtn.getAttribute('title')).toBe('Available when online');
  });

  it('disables disconnect button and shows helper text when offline and coach is linked', async () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    const linkedCoachData = {
      id: 'link-1',
      coach_id: 'coach-99',
      linked_at: '2026-09-15T10:00:00Z',
      coach: {
        username: 'Coach Mike',
        email: 'coach@example.com',
        coach_code: 'MIKE-FIT',
      },
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'coach_athlete_links') {
        return createSupabaseBuilder('coach_athlete_links', { data: linkedCoachData, error: null });
      }
      return createSupabaseBuilder(table, { data: null, error: null });
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MyCoachCard profile={mockProfile} />
      </QueryClientProvider>
    );

    expect(await screen.findByText('Coach Mike')).toBeDefined();
    const disconnectBtn = screen.getByTestId('disconnect-coach-btn');
    expect(disconnectBtn).toBeDisabled();
    expect(disconnectBtn.getAttribute('title')).toBe('Available when online');
    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');
  });
});
