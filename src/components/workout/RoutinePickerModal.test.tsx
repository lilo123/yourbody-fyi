import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoutinePickerModal } from './RoutinePickerModal';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RoutineTemplate, Exercise } from '../../types/database';
import type { DEFAULT_WORKOUT_TEMPLATES } from '../../utils/ghostSets';
import { expectNoA11yViolations } from '../../test/a11y';
import { supabase } from '../../lib/supabase';

import { createSupabaseBuilder, clearMockHistory, getRecordedTables, getRecordedSelects } from '../../test/supabaseBuilderMock';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
  },
}));

const mockDefaultTemplates: typeof DEFAULT_WORKOUT_TEMPLATES = [
  {
    name: 'Push Day',
    days: ['Mon', 'Thu'],
    exercises: ['Incline Bench Press', 'Dips'],
  },
  {
    name: 'Pull Day',
    days: ['Tue', 'Fri'],
    exercises: ['Pull-ups', 'Barbell Row'],
  },
] as any;

const mockCustomTemplates: RoutineTemplate[] = [
  {
    id: 'custom-1',
    user_id: 'user-123',
    name: 'Upper Body Custom',
    is_master: false,
    assigned_to: null,
    days_of_week: ['Mon', 'Wed'],
    created_at: '2026-01-01T00:00:00Z',
    exercises: [
      {
        id: 'te-1',
        template_id: 'custom-1',
        exercise_id: 'ex-1',
        order_index: 0,
        target_sets: 4,
        target_reps: 8,
        exercise_name: 'Incline Bench Press',
      },
    ],
  },
];

const mockExercises: Exercise[] = [
  { id: 'ex-1', name: 'Incline Bench Press', body_parts: ['Chest'] },
  { id: 'ex-2', name: 'Pull-ups', body_parts: ['Back'] },
];

describe('RoutinePickerModal', () => {
  let queryClient: QueryClient;
  const onClose = vi.fn();
  const onReloadScheduledRoutine = vi.fn();
  const onSelectRoutine = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderModal = (props: Partial<Parameters<typeof RoutinePickerModal>[0]> = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <RoutinePickerModal
          isOpen={true}
          onClose={onClose}
          onReloadScheduledRoutine={onReloadScheduledRoutine}
          onSelectRoutine={onSelectRoutine}
          activeRoutineName="Push Day"
          currentDayAbbr="Mon"
          customTemplates={mockCustomTemplates}
          defaultTemplates={mockDefaultTemplates}
          exercises={mockExercises}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it('does not render when isOpen is false', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RoutinePickerModal
          isOpen={false}
          onClose={onClose}
          onReloadScheduledRoutine={onReloadScheduledRoutine}
          onSelectRoutine={onSelectRoutine}
          activeRoutineName="Push Day"
          currentDayAbbr="Mon"
          customTemplates={mockCustomTemplates}
          defaultTemplates={mockDefaultTemplates}
          exercises={mockExercises}
        />
      </QueryClientProvider>
    );
    expect(screen.queryByTestId('routine-picker-modal')).toBeNull();
  });

  it('renders routine choices and allows selecting a routine', () => {
    renderModal();

    expect(screen.getByText('Select Routine')).toBeDefined();
    expect(screen.getByText('Free Workout')).toBeDefined();
    expect(screen.getByText('Rest Day')).toBeDefined();
    expect(screen.getByText('Upper Body Custom')).toBeDefined();

    fireEvent.click(screen.getByText('Free Workout'));
    expect(onSelectRoutine).toHaveBeenCalledWith('Free Workout');
  });

  it('allows clicking reload scheduled routine button', () => {
    renderModal();

    const reloadBtn = screen.getByTestId('reload-scheduled-routine-btn');
    fireEvent.click(reloadBtn);
    expect(onReloadScheduledRoutine).toHaveBeenCalled();
  });

  it('satisfies touch target and STD-TYP rules (no font-black, nothing < 12px, >= 44px hit)', () => {
    const { container } = renderModal();

    const reloadBtn = screen.getByTestId('reload-scheduled-routine-btn');
    expect(reloadBtn.className).toContain('min-h-[44px]');

    const freeWorkoutBtn = screen.getByRole('button', { name: /free workout/i });
    expect(freeWorkoutBtn.className).toContain('min-h-[44px]');

    const restDayBtn = screen.getByRole('button', { name: /rest day/i });
    expect(restDayBtn.className).toContain('min-h-[44px]');

    const customBtn = screen.getByRole('button', { name: /upper body custom/i });
    expect(customBtn.className).toContain('min-h-[44px]');

    // STD-TYP: no font-black and no sub-12px classes
    expect(container.innerHTML).not.toContain('font-black');
    expect(container.innerHTML).not.toContain('text-[10px]');
    expect(container.innerHTML).not.toContain('text-[11px]');
  });

  it('meets accessibility requirements: role="dialog", aria-modal, aria-labelledby, and focus trap/restoration', () => {
    const opener = document.createElement('button');
    opener.setAttribute('data-testid', 'test-opener');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'routine-picker-modal-title');

    // First focusable element inside modal (close button) should be focused
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    expect(document.activeElement).toBe(closeBtn);

    // Focus restoration to opener on unmount/close
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab navigation within modal controls', () => {
    renderModal();

    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab wraps to last focusable control in the dialog
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(closeBtn);

    // Tab wraps back to first control
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('closes on Escape key press', () => {
    renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop overlay click', () => {
    renderModal();

    const backdrop = screen.getByTestId('routine-picker-modal');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('queries routine templates with exact projection when targetUserId is provided', async () => {
    const targetUserId = '11111111-1111-4111-a111-111111111111';
    renderModal({ targetUserId });

    expect(getRecordedTables()).toContain('routine_templates');
    expect(getRecordedSelects()).toContainEqual({
      table: 'routine_templates',
      projection:
        'id, user_id, name, is_master, assigned_to, days_of_week, created_at, exercises:template_exercises(id, template_id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name))',
    });
  });

  it('passes axe accessibility audit with no violations', async () => {
    const { container } = renderModal();
    await expectNoA11yViolations(container);
  });

  it('queries get_routine_catalog RPC with limit 50 when targetUserId is provided and rpc is available', async () => {
    const targetUserId = '11111111-1111-4111-a111-111111111111';
    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'rpc-tpl-1',
          name: 'RPC Routine 1',
          is_master: false,
          user_id: targetUserId,
          assigned_to: null,
          days_of_week: ['Mon'],
          exercises: [{ id: 'te-1', exercise: { name: 'Incline Bench Press' } }],
          created_at: '2026-09-01T00:00:00Z',
          total_count: 1,
        },
      ],
      error: null,
    });
    (supabase as any).rpc = mockRpc;

    renderModal({ targetUserId });

    expect(await screen.findByText('RPC Routine 1')).toBeInTheDocument();
    expect(mockRpc).toHaveBeenCalledWith('get_routine_catalog', {
      p_user_id: targetUserId,
      p_limit: 50,
      p_cursor: null,
    });
  });

  it('renders "Load more routines" button and fetches next page with p_cursor when first page has 50 templates', async () => {
    const targetUserId = '11111111-1111-4111-a111-111111111111';
    const page1Templates = Array.from({ length: 50 }, (_, i) => ({
      id: `tpl-${i + 1}`,
      name: `Template ${i + 1}`,
      is_master: false,
      user_id: targetUserId,
      assigned_to: null,
      days_of_week: ['Mon'],
      exercises: [],
      created_at: new Date(Date.now() - i * 1000).toISOString(),
      total_count: 55,
    }));

    const page2Templates = [
      {
        id: 'tpl-51',
        name: 'Template 51 Beyond Cap',
        is_master: false,
        user_id: targetUserId,
        assigned_to: null,
        days_of_week: ['Tue'],
        exercises: [],
        created_at: '2026-08-01T00:00:00Z',
        total_count: 55,
      },
    ];

    const mockRpc = vi.fn().mockImplementation((fn: string, params: any) => {
      if (fn === 'get_routine_catalog') {
        if (!params.p_cursor) {
          return Promise.resolve({ data: page1Templates, error: null });
        }
        if (params.p_cursor === 'tpl-50') {
          return Promise.resolve({ data: page2Templates, error: null });
        }
      }
      return Promise.resolve({ data: [], error: null });
    });
    (supabase as any).rpc = mockRpc;

    renderModal({ targetUserId });

    // Page 1 is displayed
    expect(await screen.findByText('Template 1')).toBeInTheDocument();
    expect(screen.getByText('Template 50')).toBeInTheDocument();

    // Load more button is visible
    const loadMoreBtn = screen.getByTestId('load-more-routines-btn');
    expect(loadMoreBtn).toBeInTheDocument();
    expect(loadMoreBtn).toHaveTextContent('Load more routines');

    // Click Load more -> page 2 fetched
    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText('Template 51 Beyond Cap')).toBeInTheDocument();
    expect(mockRpc).toHaveBeenCalledWith('get_routine_catalog', {
      p_user_id: targetUserId,
      p_limit: 50,
      p_cursor: 'tpl-50',
    });

    // Selecting template #51 starts it
    fireEvent.click(screen.getByText('Template 51 Beyond Cap'));
    expect(onSelectRoutine).toHaveBeenCalledWith('Template 51 Beyond Cap', expect.objectContaining({ id: 'tpl-51' }));
  });
});
