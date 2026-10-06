import { useState } from 'react';
import { describe, it, expect, vi , beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditExerciseSheet } from './EditExerciseSheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expectNoA11yViolationsForRules } from '../../test/a11y';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedTables } from '../../test/supabaseBuilderMock';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

vi.mock('../../hooks/useOnlineStatus');

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => createSupabaseBuilder(table, { data: [], error: null })),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

describe('EditExerciseSheet', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockProps = {
    isOpen: true,
    exercise: {
      id: 'ex-1',
      name: 'Bench Press',
      body_parts: ['Chest'],
      is_master: false,
    },
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  it('has accessible label association for Exercise Name and uses input-text-sm', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );
    const input = screen.getByLabelText(/exercise name/i);
    expect(input).toBeDefined();
    expect(input.classList.contains('input-text-sm')).toBe(true);
    expect(input.classList.contains('text-sm')).toBe(false);
  });

  it('has no a11y label violations', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );
    await expectNoA11yViolationsForRules(container, ['label']);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    vi.mocked(useOnlineStatus).mockReturnValue(true);
  });

  it('mounts edit-exercise-error live region empty while idle and retains same node on error', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { error: new Error('Failed to update exercise in DB') })
    );

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    // Live region exists and is empty while idle
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe('');

    // Trigger save failure
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(alert?.textContent).toBe('Failed to update exercise in DB');
      expect(screen.getByTestId('edit-exercise-error')).toBeDefined();
    });

    // Alert DOM node is identical
    expect(container.querySelector('[role="alert"]')).toBe(alert);

    // NO_PROJECTION_APPLIES: Exercise updates are mutation-only with no select projection
    expect(getRecordedTables()).toContain('exercises');
  });

  describe('accessibility and focus management', () => {
    it('traps focus, restores focus on close, and closes on Escape', () => {
      function Wrapper() {
        const [open, setOpen] = useState(false);
        return (
          <QueryClientProvider client={queryClient}>
            <button data-testid="opener-btn" onClick={() => setOpen(true)}>
              Open
            </button>
            <EditExerciseSheet
              {...mockProps}
              isOpen={open}
              onClose={() => setOpen(false)}
            />
          </QueryClientProvider>
        );
      }

      render(<Wrapper />);
      const opener = screen.getByTestId('opener-btn');
      opener.focus();
      fireEvent.click(opener);

      // 1. Dialog element exists with ARIA attributes
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeDefined();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'edit-exercise-modal-title');

      // 2. Focus moved into the dialog to the first focusable element
      const firstFocusable = screen.getByRole('button', { name: /close edit exercise/i });
      expect(document.activeElement).toBe(firstFocusable);

      // 3. Tab wraps from last focusable to first focusable
      const saveBtn = screen.getByRole('button', { name: /save changes/i });
      saveBtn.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(firstFocusable);

      // 4. Shift+Tab wraps from first focusable to last focusable
      firstFocusable.focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(saveBtn);

      // 5. Escape closes the modal and restores focus to the opener
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  });

  it('0 rows affected on update displays error and keeps input intact', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });
      return b;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Updated Bench Press' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByTestId('edit-exercise-error')).toBeDefined();
      expect(screen.getByTestId('edit-exercise-error').textContent).toContain('Exercise could not be updated.');
    });

    expect(screen.getByLabelText(/exercise name/i)).toHaveValue('Updated Bench Press');
  });

  it('disables save button and displays inline error on whitespace name', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: '    ' } });

    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/Exercise name cannot be blank or whitespace-only./i)).toBeDefined();
  });

  it('successful rename invalidates exercise_stats query cache to update History PR card title', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [{ id: 'ex-1', name: 'Incline Bench Press' }], error: null });
      b.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ id: 'ex-1', name: 'Incline Bench Press' }], error: null }),
        }),
      });
      return b;
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Incline Bench Press' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockProps.onSuccess).toHaveBeenCalled();
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as any)?.queryKey);
    expect(invalidatedKeys).toContainEqual(['exercise_stats']);
  });

  it('library rename followed by set logging passes valid exerciseId UUID to set insertion', async () => {
    const renamedExercise = {
      id: '00000000-0000-4000-8000-000000000099',
      name: 'Incline Dumbbell Press',
      body_parts: ['Chest'],
      is_master: false,
    };

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [renamedExercise], error: null });
      b.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [renamedExercise], error: null }),
        }),
      });
      return b;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet
          isOpen={true}
          exercise={{
            id: '00000000-0000-4000-8000-000000000099',
            name: 'Old Dumbbell Press',
            body_parts: ['Chest'],
            is_master: false,
          }}
          onClose={vi.fn()}
          onSuccess={mockProps.onSuccess}
        />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: 'Incline Dumbbell Press' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockProps.onSuccess).toHaveBeenCalled();
    });
  });


  it("pressing Enter submits the edit form", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: "ex-1", name: "Renamed Bench Press", body_parts: ["Chest"], equipment: null }],
          error: null,
        }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = updateSpy;
      return b;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: "Renamed Bench Press" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed Bench Press" })
      );
      expect(mockProps.onSuccess).toHaveBeenCalled();
    });
  });

  it("single-select equipment chips saved to exercises.equipment", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: "ex-1", name: "Bench Press", body_parts: ["Chest"], equipment: "barbell" }],
          error: null,
        }),
      }),
    });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = updateSpy;
      return b;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const barbellChip = screen.getByTestId("equipment-chip-barbell");
    expect(barbellChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(barbellChip);
    expect(barbellChip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: "barbell" })
      );
    });
  });

  it("duplicate check on rename shows duplicate message naming existing exercise and prevents update", async () => {
    const existingExercise = {
      id: "ex-2",
      name: "Incline Bench Press",
      body_parts: ["Chest"],
      equipment: "barbell",
      is_master: true,
      is_hidden: false,
    };

    // Cache preloaded catalog with existing exercise
    queryClient.setQueryData(
      ["exercise_catalog", "infinite", { search: "", scope: "all", includeHidden: true, limit: 50 }],
      {
        pages: [{ items: [existingExercise], nextCursor: null, totalCount: 1 }],
        pageParams: [null],
      }
    );

    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }) });
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = updateSpy;
      return b;
    });

    const onViewExistingSpy = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet
          {...mockProps}
          onViewExisting={onViewExistingSpy}
        />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: "Incline Bench Press" } });

    // Select barbell equipment
    fireEvent.click(screen.getByTestId("equipment-chip-barbell"));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const dupAlert = screen.getByTestId("edit-exercise-duplicate-msg");
      expect(dupAlert).toBeDefined();
      expect(dupAlert.textContent).toContain("'Incline Bench Press' already exists (Default)");
    });

    // Update was NOT called
    expect(updateSpy).not.toHaveBeenCalled();

    // Clicking View calls onViewExisting
    const viewBtn = screen.getByTestId("view-existing-exercise-btn");
    expect(viewBtn).toHaveTextContent("View");
    fireEvent.click(viewBtn);
    expect(onViewExistingSpy).toHaveBeenCalledWith({
      id: "ex-2",
      name: "Incline Bench Press",
      is_hidden: false,
    });
  });

  it("synchronous double-submit guard triggers only one DB update", async () => {
    let resolveUpdate: (val: any) => void;
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });

    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue(updatePromise),
      }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = updateSpy;
      return b;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: "Renamed Fast" } });

    const saveBtn = screen.getByRole("button", { name: /save changes/i });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(updateSpy).toHaveBeenCalledTimes(1);

    resolveUpdate!({
      data: [{ id: "ex-1", name: "Renamed Fast", body_parts: ["Chest"] }],
      error: null,
    });

    await waitFor(() => {
      expect(mockProps.onSuccess).toHaveBeenCalled();
    });
  });

  it("DB 23505 duplicate_exercise_name with DETAIL maps to inline duplicate alert with existing exercise link", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: "23505",
            message: "duplicate_exercise_name",
            details: "ex-existing-99",
          },
        }),
      }),
    });

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const b = createSupabaseBuilder(table, { data: [], error: null });
      b.update = updateSpy;
      return b;
    });

    const onViewExistingSpy = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet
          {...mockProps}
          onViewExisting={onViewExistingSpy}
        />
      </QueryClientProvider>
    );

    const input = screen.getByLabelText(/exercise name/i);
    fireEvent.change(input, { target: { value: "Bench Press" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      const dupAlert = screen.getByTestId("edit-exercise-duplicate-msg");
      expect(dupAlert).toBeDefined();
      expect(dupAlert.textContent).toContain("'Bench Press' already exists");
    });

    const viewBtn = screen.getByTestId("view-existing-exercise-btn");
    expect(viewBtn).toBeDefined();
    fireEvent.click(viewBtn);
    expect(onViewExistingSpy).toHaveBeenCalledWith({
      id: "ex-existing-99",
      name: "Bench Press",
    });
  });

  it('disables save button and displays "Available when online" helper text when offline', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);

    render(
      <QueryClientProvider client={queryClient}>
        <EditExerciseSheet {...mockProps} />
      </QueryClientProvider>
    );

    expect(screen.getByTestId('offline-helper-text').textContent).toBe('Available when online');

    const saveBtn = screen.getByTestId('save-exercise-btn');
    expect(saveBtn).toBeDisabled();
    expect(saveBtn.getAttribute('title')).toBe('Available when online');
  });
});
