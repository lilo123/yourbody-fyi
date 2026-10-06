import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateExerciseSheet } from './CreateExerciseSheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expectNoA11yViolationsForRules } from '../../test/a11y';
import * as exercisesLib from '../../lib/exercises';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

vi.mock('../../hooks/useOnlineStatus');

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

describe('CreateExerciseSheet', () => {
  let queryClient: QueryClient;
  const mockProps = {
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    onError: vi.fn(),
    onViewExisting: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('renders a Sheet with title "New exercise" and accessible form controls', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(screen.getByRole('heading', { name: 'New exercise' })).toBeDefined();

    const input = screen.getByLabelText(/exercise name/i);
    expect(input).toBeDefined();
    expect(input.classList.contains('input-text-sm')).toBe(true);
  });

  it('has no a11y label violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );
    await expectNoA11yViolationsForRules(container, ['label']);
  });

  it('pressing Enter submits the form and calls onCreated with created exercise', async () => {
    const mockCreated = {
      id: 'ex-new',
      name: 'Romanian Deadlift',
      body_parts: ['Legs'],
      equipment: 'barbell',
      is_master: false,
      user_id: 'user-1',
      is_archived: false,
      is_hidden: false,
    };

    const insertSpy = vi.spyOn(exercisesLib, 'insertCustomExercise').mockResolvedValue(mockCreated as any);

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Romanian Deadlift' } });

    // Submit via form submit (Enter key triggers form submit)
    const form = input.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Romanian Deadlift' }),
        expect.anything(),
        expect.anything()
      );
      expect(mockProps.onCreated).toHaveBeenCalledWith(mockCreated);
      expect(mockProps.onClose).toHaveBeenCalled();
    });
  });

  it('duplicate message + no insert: shows duplicate alert naming existing exercise with View CTA and prevents insert', async () => {
    const existingExercise = {
      id: 'ex-bench-default',
      name: 'Bench Press',
      body_parts: ['Chest'],
      equipment: 'barbell',
      is_master: true,
      user_id: null,
      is_archived: false,
      is_hidden: false,
    };

    // Preload query cache with existing exercise
    queryClient.setQueryData(
      ['exercise_catalog', 'infinite', { search: '', scope: 'all', includeHidden: true, limit: 50 }],
      {
        pages: [{ items: [existingExercise], nextCursor: null, totalCount: 1 }],
        pageParams: [null],
      }
    );

    vi.spyOn(exercisesLib, 'insertCustomExercise').mockRejectedValue(
      new exercisesLib.DuplicateExerciseError(
        'An exercise named "Bench Press" (barbell) already exists in your catalog.',
        'Bench Press',
        'barbell'
      )
    );

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Bench Press' } });

    // Click Barbell chip
    const barbellChip = screen.getByTestId('equipment-chip-barbell');
    fireEvent.click(barbellChip);

    // Click Save
    const saveBtn = screen.getByTestId('save-exercise-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const dupAlert = screen.getByTestId('create-exercise-duplicate-msg');
      expect(dupAlert).toBeDefined();
      expect(dupAlert.getAttribute('role')).toBe('alert');
      expect(dupAlert.textContent).toContain("'Bench Press' already exists (Default)");
    });

    // Verify View button is shown and calls onViewExisting
    const viewBtn = screen.getByTestId('view-existing-exercise-btn');
    expect(viewBtn).toHaveTextContent('View');
    fireEvent.click(viewBtn);

    expect(mockProps.onViewExisting).toHaveBeenCalledWith({
      id: 'ex-bench-default',
      name: 'Bench Press',
      is_hidden: false,
    });

    // onCreated was not called because no insert happened
    expect(mockProps.onCreated).not.toHaveBeenCalled();
  });

  it('duplicate hidden default shows "Unhide" CTA calling onViewExisting', async () => {
    const existingHidden = {
      id: 'ex-squat-hidden',
      name: 'Back Squat',
      body_parts: ['Legs'],
      equipment: 'barbell',
      is_master: true,
      user_id: null,
      is_archived: false,
      is_hidden: true,
    };

    queryClient.setQueryData(
      ['exercise_catalog', 'infinite', { search: '', scope: 'all', includeHidden: true, limit: 50 }],
      {
        pages: [{ items: [existingHidden], nextCursor: null, totalCount: 1 }],
        pageParams: [null],
      }
    );

    vi.spyOn(exercisesLib, 'insertCustomExercise').mockRejectedValue(
      new exercisesLib.DuplicateExerciseError(
        'An exercise named "Back Squat" (barbell) already exists in your catalog.',
        'Back Squat',
        'barbell'
      )
    );

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Back Squat' } });
    fireEvent.click(screen.getByTestId('equipment-chip-barbell'));
    fireEvent.click(screen.getByTestId('save-exercise-btn'));

    await waitFor(() => {
      const dupAlert = screen.getByTestId('create-exercise-duplicate-msg');
      expect(dupAlert).toBeDefined();
    });

    const unhideBtn = screen.getByTestId('unhide-existing-exercise-btn');
    expect(unhideBtn).toHaveTextContent('Unhide');
    fireEvent.click(unhideBtn);

    expect(mockProps.onViewExisting).toHaveBeenCalledWith({
      id: 'ex-squat-hidden',
      name: 'Back Squat',
      is_hidden: true,
    });
  });

  it('single-select equipment chips saved to exercises.equipment via insertCustomExercise', async () => {
    const insertSpy = vi.spyOn(exercisesLib, 'insertCustomExercise').mockResolvedValue({
      id: 'new-id',
      name: 'Overhead Press',
      equipment: 'dumbbell',
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Overhead Press' } });

    // Select dumbbell chip
    const dbChip = screen.getByTestId('equipment-chip-dumbbell');
    expect(dbChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(dbChip);
    expect(dbChip).toHaveAttribute('aria-pressed', 'true');

    // Clicking barbell switches equipment (single-select)
    const bbChip = screen.getByTestId('equipment-chip-barbell');
    fireEvent.click(bbChip);
    expect(bbChip).toHaveAttribute('aria-pressed', 'true');
    expect(dbChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('save-exercise-btn'));

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Overhead Press',
          equipment: 'barbell',
        }),
        expect.anything(),
        expect.anything()
      );
    });
  });

  it('dismiss blocked while saving (dismissible={!isSubmitting})', async () => {
    let resolveInsert: (val: any) => void;
    const insertPromise = new Promise((resolve) => {
      resolveInsert = resolve;
    });

    vi.spyOn(exercisesLib, 'insertCustomExercise').mockReturnValue(insertPromise as any);

    function TestWrapper() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <QueryClientProvider client={queryClient}>
          <CreateExerciseSheet
            open={isOpen}
            onClose={() => setIsOpen(false)}
          />
        </QueryClientProvider>
      );
    }

    render(<TestWrapper />);

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'In-Flight Exercise' } });

    // Submit
    fireEvent.click(screen.getByTestId('save-exercise-btn'));

    // While saving, save button is disabled
    expect(screen.getByTestId('save-exercise-btn')).toBeDisabled();

    // Attempting to close via Escape while saving should NOT close the dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeDefined();

    // Cancel button is also disabled while saving
    expect(screen.getByTestId('cancel-create-exercise-btn')).toBeDisabled();

    // Resolve insert
    resolveInsert!({ id: 'done', name: 'In-Flight Exercise' });

    await waitFor(() => {
      // Once done, dialog closes
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('double-submit = one insert: rapid submits trigger exactly one insert call', async () => {
    let resolveInsert: (val: any) => void;
    const insertPromise = new Promise((resolve) => {
      resolveInsert = resolve;
    });

    const insertSpy = vi.spyOn(exercisesLib, 'insertCustomExercise').mockReturnValue(insertPromise as any);

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Fast Clicks' } });

    const saveBtn = screen.getByTestId('save-exercise-btn');
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });

    resolveInsert!({ id: 'created-id', name: 'Fast Clicks' });

    await waitFor(() => {
      expect(mockProps.onCreated).toHaveBeenCalledTimes(1);
    });
  });

  it('whitespace-only name disables save button and shows inline whitespace error', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: '     ' } });

    const saveBtn = screen.getByTestId('save-exercise-btn');
    expect(saveBtn).toBeDisabled();

    const whitespaceError = screen.getByTestId('exercise-name-whitespace-error');
    expect(whitespaceError).toBeDefined();
    expect(whitespaceError.textContent).toBe('Exercise name cannot be blank or whitespace-only.');
  });

  it('disables save button and displays "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    render(
      <QueryClientProvider client={queryClient}>
        <CreateExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Deadlift' } });

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const saveBtn = screen.getByTestId('save-exercise-btn');
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.getAttribute('title')).toBe('Available when online');

    fireEvent.submit(saveBtn.closest('form')!);
    expect(mockProps.onError).toHaveBeenCalledWith('Available when online');
  });
});
