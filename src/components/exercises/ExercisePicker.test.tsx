import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExercisePicker } from './ExercisePicker';
import { supabase } from '../../lib/supabase';
import { expectNoA11yViolations } from '../../test/a11y';
import type { CatalogExercise } from '../../lib/exercises';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    /* sb */ ["from"]: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user' } } }),
    },
  },
}));

const mockExercises: CatalogExercise[] = [
  {
    id: 'e1',
    name: 'Zercher Squat',
    body_parts: ['Legs'],
    equipment: 'barbell',
    is_master: false,
    user_id: 'test-user',
    is_archived: false,
    is_hidden: false,
    total_count: 3,
  },
  {
    id: 'e2',
    name: 'Romanian Deadlift',
    body_parts: ['Legs', 'Back'],
    equipment: 'barbell',
    is_master: true,
    user_id: null,
    is_archived: false,
    is_hidden: false,
    total_count: 3,
  },
  {
    id: 'e3',
    name: 'Incline Bench Press',
    body_parts: ['Chest'],
    equipment: 'barbell',
    is_master: true,
    user_id: null,
    is_archived: false,
    is_hidden: false,
    total_count: 3,
  },
];

function renderPicker(props: Partial<React.ComponentProps<typeof ExercisePicker>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onAdd: vi.fn(),
    activeExerciseNames: ['Incline Bench Press'],
    targetUserId: 'test-user',
    userLogs: [
      { exercise_name: 'Romanian Deadlift', workout_date: '2026-09-25' },
      { exercise_name: 'Zercher Squat', workout_date: '2026-09-20' },
      { exercise_name: 'Romanian Deadlift', workout_date: '2026-09-18' },
    ],
  };

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ExercisePicker {...defaultProps} {...props} />
      </QueryClientProvider>
    ),
  };
}

describe('ExercisePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_exercise_catalog') {
        return Promise.resolve({ data: mockExercises, error: null } as any);
      }
      if (fn === 'get_exercise_stats') {
        return Promise.resolve({ data: [], error: null } as any);
      }
      return Promise.resolve({ data: null, error: null } as any);
    });
  });

  it('renders search input, filter chips, and sections when browsing', async () => {
    renderPicker();

    expect(screen.getByTestId('exercise-search-input')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-all-muscles')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-all-equipment')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    // Recent and Frequent sections from userLogs
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('Frequent')).toBeInTheDocument();
    expect(screen.getByText('All Exercises')).toBeInTheDocument();
  });

  it('marks exercises already in workout as "In workout" and disables them', async () => {
    renderPicker({ activeExerciseNames: ['Incline Bench Press'] });

    await waitFor(() => {
      expect(screen.getByText('Incline Bench Press')).toBeInTheDocument();
    });

    expect(screen.getByTestId('in-workout-tag-e3')).toBeInTheDocument();
    const rowBtn = screen.getByTestId('exercise-row-e3');
    expect(rowBtn).toBeDisabled();
  });

  it('supports multi-select with sticky "Add N" button', async () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderPicker({ onAdd, onClose, activeExerciseNames: [] });

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    const addBtn = screen.getByTestId('picker-confirm-add-btn');
    expect(addBtn).toBeDisabled();

    // Select Zercher Squat
    await user.click(screen.getAllByTestId('exercise-row-e1')[0]);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(addBtn).toHaveTextContent('Add Exercise');
    expect(addBtn).not.toBeDisabled();

    // Select Romanian Deadlift
    await user.click(screen.getAllByTestId('exercise-row-e2')[0]);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(addBtn).toHaveTextContent('Add 2 Exercises');

    // Submit selection
    await user.click(addBtn);
    expect(onAdd).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Zercher Squat' }),
      expect.objectContaining({ name: 'Romanian Deadlift' }),
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('filters exercises by prefix search "zer" and alias "rdl"', async () => {
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('exercise-search-input');

    // Type "zer" -> matches Zercher Squat
    await user.type(searchInput, 'zer');
    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
      expect(screen.queryByText('Incline Bench Press')).not.toBeInTheDocument();
    });

    // Clear search
    await user.click(screen.getByTestId('clear-search-btn'));
    expect(searchInput).toHaveValue('');

    // Type "rdl" -> matches Romanian Deadlift
    await user.type(searchInput, 'rdl');
    await waitFor(() => {
      expect(screen.getAllByText('Romanian Deadlift')[0]).toBeInTheDocument();
      expect(screen.queryByText('Incline Bench Press')).not.toBeInTheDocument();
    });
  });

  it('shows duplicate message when searching an existing exercise', async () => {
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('exercise-search-input');
    await user.type(searchInput, 'zercher squat');

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-duplicate-msg')).toBeInTheDocument();
      expect(screen.getByTestId('create-exercise-duplicate-msg')).toHaveTextContent(
        'already exists'
      );
    });

    expect(screen.queryByTestId('create-exercise-btn')).not.toBeInTheDocument();
  });

  it('allows inline creation of a non-duplicate custom exercise', async () => {
    const user = userEvent.setup();

    const mockCreated = {
      id: 'custom-1',
      name: 'Spider Curl',
      body_parts: ['Biceps'],
      equipment: 'dumbbell',
      is_master: false,
      user_id: 'test-user',
      is_archived: false,
      is_hidden: false,
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockCreated, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
    vi.mocked(supabase['from']).mockReturnValue({ insert: mockInsert } as any);

    renderPicker();

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('exercise-search-input');
    await user.type(searchInput, 'Spider Curl');

    await waitFor(() => {
      expect(screen.getByTestId('create-exercise-btn')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('create-exercise-btn'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Spider Curl',
          is_master: false,
        })
      );
    });
  });

  it('passes axe accessibility audits with no violations (STD-A11Y-4)', async () => {
    const { container } = renderPicker();

    await waitFor(() => {
      expect(screen.getAllByText('Zercher Squat')[0]).toBeInTheDocument();
    });

    await expectNoA11yViolations(container);
  });

  it('falls back to cached catalog, renders offline banner, and disables create when offline (f)', async () => {
    const user = userEvent.setup();
    const origOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });
    window.dispatchEvent(new Event('offline'));

    (supabase.rpc as any).mockImplementation((fn: string) => {
      if (fn === 'get_exercise_catalog') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ data: [], error: null });
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    queryClient.setQueryData(['exercise_catalog', 'offline_all', 'test-user'], [
      {
        id: 'e-cached-1',
        name: 'Saved Barbell Squat',
        body_parts: ['Legs'],
        equipment: 'barbell',
        is_master: true,
        user_id: null,
        is_archived: false,
        is_hidden: false,
        total_count: 1,
      },
      {
        id: 'e-cached-2',
        name: 'Saved Bench Press',
        body_parts: ['Chest'],
        equipment: 'barbell',
        is_master: true,
        user_id: null,
        is_archived: false,
        is_hidden: false,
        total_count: 1,
      },
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <ExercisePicker
          isOpen={true}
          onClose={vi.fn()}
          onAdd={vi.fn()}
          targetUserId="test-user"
        />
      </QueryClientProvider>
    );

    // 1. Shows offline banner
    const offlineBanner = await screen.findByTestId('offline-catalog-banner');
    expect(offlineBanner).toBeInTheDocument();
    expect(offlineBanner).toHaveTextContent('Offline — showing saved catalog');

    // 2. Shows cached exercises
    expect(screen.getByText('Saved Barbell Squat')).toBeInTheDocument();
    expect(screen.getByText('Saved Bench Press')).toBeInTheDocument();

    // 3. Filters cached exercises
    const searchInput = screen.getByTestId('exercise-search-input');
    await user.type(searchInput, 'bench');
    expect(screen.getByText('Saved Bench Press')).toBeInTheDocument();
    expect(screen.queryByText('Saved Barbell Squat')).not.toBeInTheDocument();

    // 4. Searching for custom exercise shows "Available when online" and button is disabled
    await user.clear(searchInput);
    await user.type(searchInput, 'New Custom Lift');
    const createBtn = await screen.findByTestId('create-exercise-btn');
    expect(createBtn).toBeDisabled();
    expect(screen.getByText('Available when online')).toBeInTheDocument();

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: origOnline,
    });
    window.dispatchEvent(new Event('online'));
  });
});
