import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditSetSheet } from "./EditSetSheet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Exercise, WorkoutSet } from "../../types/database";
import { expectNoA11yViolations } from "../../test/a11y";
import { AuthContext, type AuthContextType } from "../../context/AuthContextTypes";

const createAuthContextValue = (weightUnit: 'lb' | 'kg' = 'lb'): AuthContextType => ({
  user: { id: 'user-789' } as any,
  profile: { id: 'user-789', weight_unit: weightUnit } as any,
  role: 'athlete',
  viewMode: 'athlete',
  isCoachMode: false,
  loading: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateProfile: vi.fn(),
  switchRole: vi.fn(),
  refreshProfile: vi.fn(),
  resendConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
});

const mockUpdateEq = vi.fn();
const mockUpdate = vi.fn();
const mockExpected = vi.fn();
const mockDbFrom = vi.fn();
const mockFetchSetById = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    ["from"](...args: any[]) {
      return mockDbFrom(...args);
    },
  },
}));

vi.mock("../../lib/fetchSet", () => ({
  fetchSetById: (...args: any[]) => mockFetchSetById(...args),
}));

vi.mock("../../lib/sets", async () => {
  const actual = await vi.importActual<any>("../../lib/sets");
  return {
    ...actual,
    updateSet: vi.fn().mockImplementation((_client, id, updates, expected) => {
      mockUpdate({
        weight: updates.weight,
        reps: updates.reps,
        set_type: updates.setType,
        rpe: updates.rpe,
        exercise_id: updates.exerciseId,
        setIndex: updates.setIndex,
        createdAt: updates.createdAt,
      });
      mockExpected(expected);
      const eqRes = mockUpdateEq("id", id);
      if (eqRes) {
        return Promise.resolve(eqRes).then((res: any) => {
          if (res?.error) throw new Error(res.error.message || "Update failed");
          return {
            id,
            workout_id: updates.workoutId || "workout-456",
            exercise_id: updates.exerciseId || "ex-1",
            weight: updates.weight ?? 185,
            reps: updates.reps ?? 8,
            rpe: updates.rpe ?? null,
            set_type: updates.setType || "working",
            set_index: updates.setIndex ?? 1,
            created_at: new Date().toISOString(),
          };
        });
      }
      return Promise.resolve({
        id,
        workout_id: updates.workoutId || "workout-456",
        exercise_id: updates.exerciseId || "ex-1",
        weight: updates.weight ?? 185,
        reps: updates.reps ?? 8,
        rpe: updates.rpe ?? null,
        set_type: updates.setType || "working",
        set_index: updates.setIndex ?? 1,
        created_at: new Date().toISOString(),
      });
    }),
  };
});

const mockExercises: Exercise[] = [
  { id: "ex-1", name: "Incline Bench Press", body_parts: ["Chest"] },
  { id: "ex-2", name: "Pull-ups", body_parts: ["Back"] },
  { id: "ex-3", name: "Dips", body_parts: ["Chest", "Triceps"] },
];

const mockSet: WorkoutSet & { workout_date?: string; workout_name?: string } = {
  id: "set-123",
  workout_id: "workout-456",
  exercise_id: "ex-1",
  exercise_name: "Incline Bench Press",
  set_index: 1,
  set_type: "working",
  weight: 185,
  reps: 8,
  rpe: 8.5,
  workout_date: "2026-09-08",
  workout_name: "Push Day",
};

describe("EditSetSheet", () => {
  let queryClient: QueryClient;
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onDeleteRequested = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockFetchSetById.mockImplementation((_client: any, setId: string) =>
      Promise.resolve({
        id: setId,
        workout_id: "workout-456",
        exercise_id: "ex-1",
        weight: 185,
        reps: 8,
        rpe: 8.5,
        set_type: "working",
      })
    );

    const updateResult = {
      data: [{ id: "set-123", exercise_id: "ex-1", weight: 185, reps: 8, rpe: 8.5, set_type: "working" }],
      error: null,
    };
    const updateBuilder = Object.assign(Promise.resolve(updateResult), {
      select: vi.fn().mockResolvedValue(updateResult),
    });
    mockUpdateEq.mockReturnValue(updateBuilder);
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });

    mockDbFrom.mockImplementation((table: string) => {
      if (table === "sets") {
        return {
          ["select"]: () => {
            const builder: any = {
              eq: () => builder,
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "set-123",
                    exercise_id: "ex-1",
                    weight: 185,
                    reps: 8,
                    rpe: 8.5,
                    set_type: "working",
                  },
                  error: null,
                }),
            };
            return builder;
          },
          update: (...args: any[]) => {
            mockUpdate(...args);
            return {
              eq: (...eqArgs: [string, any]) => {
                const res = mockUpdateEq(...eqArgs);
                return {
                  ...res,
                  select: (...sArgs: any[]) => {
                    if (res && typeof res.select === "function" && res !== updateBuilder) {
                      return res.select(...sArgs);
                    }
                    const row = {
                      id: "set-123",
                      exercise_id: args[0]?.exercise_id ?? "ex-1",
                      weight: args[0]?.weight ?? 185,
                      reps: args[0]?.reps ?? 8,
                      rpe: args[0]?.rpe ?? null,
                      set_type: args[0]?.set_type ?? "working",
                    };
                    const r = { data: [row], error: null };
                    return Object.assign(Promise.resolve(r), { data: [row], error: null });
                  },
                };
              },
            };
          },
          delete: vi.fn(),
        };
      }
      return {};
    });

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderSheet = (
    props: Partial<Parameters<typeof EditSetSheet>[0]> = {},
    weightUnit: 'lb' | 'kg' = 'lb'
  ) => {
    return render(
      <AuthContext.Provider value={createAuthContextValue(weightUnit)}>
        <QueryClientProvider client={queryClient}>
          <EditSetSheet
            isOpen={true}
            set={mockSet}
            exercises={mockExercises}
            onClose={onClose}
            onSaved={onSaved}
            onDeleteRequested={onDeleteRequested}
            targetUserId="user-789"
            {...props}
          />
        </QueryClientProvider>
      </AuthContext.Provider>
    );
  };

  it("does not render when isOpen is false or set is null", () => {
    const { rerender } = render(
      <AuthContext.Provider value={createAuthContextValue('lb')}>
        <QueryClientProvider client={queryClient}>
          <EditSetSheet
            isOpen={false}
            set={mockSet}
            exercises={mockExercises}
            onClose={onClose}
            onSaved={onSaved}
            onDeleteRequested={onDeleteRequested}
          />
        </QueryClientProvider>
      </AuthContext.Provider>
    );
    expect(screen.queryByTestId("edit-set-sheet")).toBeNull();

    rerender(
      <AuthContext.Provider value={createAuthContextValue('lb')}>
        <QueryClientProvider client={queryClient}>
          <EditSetSheet
            isOpen={true}
            set={null}
            exercises={mockExercises}
            onClose={onClose}
            onSaved={onSaved}
            onDeleteRequested={onDeleteRequested}
          />
        </QueryClientProvider>
      </AuthContext.Provider>
    );
    expect(screen.queryByTestId("edit-set-sheet")).toBeNull();
  });

  it("renders prefilled form with set data, HTML min attributes, and handles Escape key", () => {
    renderSheet();

    expect(screen.getByTestId("edit-set-sheet")).toBeDefined();
    expect(screen.getByText("Edit Workout Set")).toBeDefined();

    const exSelect = screen.getByTestId("edit-set-exercise-select") as HTMLSelectElement;
    expect(exSelect.value).toBe("ex-1");

    const typeSelect = screen.getByTestId("edit-set-type-select") as HTMLSelectElement;
    expect(typeSelect.value).toBe("working");

    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(weightInput.value).toBe("185");
    expect(weightInput).toHaveAttribute("min", "0");

    const repsInput = screen.getByTestId("edit-set-reps-input") as HTMLInputElement;
    expect(repsInput.value).toBe("8");
    expect(repsInput).toHaveAttribute("min", "1");

    const rpeInput = screen.getByTestId("edit-set-rpe-input") as HTMLInputElement;
    expect(rpeInput.value).toBe("8.5");

    // Press Escape to close
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDeleteRequested).not.toHaveBeenCalled();
  });

  it("meets modal accessibility requirements: focus trap, focus restoration, and ARIA attributes", () => {
    const opener = document.createElement("button");
    opener.setAttribute("data-testid", "test-opener");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = renderSheet();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Close button inside Sheet header
    const closeBtn = screen.getByRole("button", { name: "Close Edit Workout Set" });
    expect(document.activeElement).toBe(closeBtn);

    // Focus restoration to opener on unmount/close
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("traps Tab key navigation within modal controls", () => {
    renderSheet();

    // Make dirty so save button is enabled and focusable
    const weightInput = screen.getByTestId("edit-set-weight-input");
    fireEvent.change(weightInput, { target: { value: "190" } });

    const closeBtn = screen.getByRole("button", { name: "Close Edit Workout Set" });
    const saveBtn = screen.getByTestId("save-set-btn");

    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab on first control wraps to last focusable control
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(saveBtn);

    // Tab on last control wraps to first focusable control
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("dismisses modal on backdrop click", () => {
    renderSheet();

    const dialog = screen.getByTestId("edit-set-sheet");
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("disables Save button until form is dirty (STD-INT-2)", async () => {
    renderSheet();

    const saveBtn = screen.getByTestId("save-set-btn");
    expect(saveBtn).toBeDisabled();

    const weightInput = screen.getByTestId("edit-set-weight-input");
    fireEvent.change(weightInput, { target: { value: "190" } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.change(weightInput, { target: { value: "185" } });
    expect(saveBtn).toBeDisabled();
  });

  it("pre-fills 0 in weight input for bodyweight sets and allows saving 0 lbs when dirty", async () => {
    const bwSet = { ...mockSet, weight: 0, reps: 15, rpe: null };
    renderSheet({ set: bwSet });

    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(weightInput.value).toBe("0");

    // Initially disabled because not dirty
    expect(screen.getByTestId("save-set-btn")).toBeDisabled();

    // Change reps to make dirty
    const repsInput = screen.getByTestId("edit-set-reps-input");
    fireEvent.change(repsInput, { target: { value: "16" } });
    expect(screen.getByTestId("save-set-btn")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 0,
          reps: 16,
          rpe: null,
          exercise_id: "ex-1",
        })
      );
      expect(mockUpdateEq).toHaveBeenCalledWith("id", "set-123");
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("rejects submitting with empty weight input rather than silently converting to 0 lbs", async () => {
    renderSheet();

    const weightInput = screen.getByTestId("edit-set-weight-input");
    await userEvent.clear(weightInput);
    expect(weightInput).toHaveValue("");

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Please enter a weight (0 for bodyweight).");
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects empty reps input and non-integer reps", async () => {
    renderSheet();

    const repsInput = screen.getByTestId("edit-set-reps-input");
    await userEvent.clear(repsInput);

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Please enter reps.");
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid RPE values out of 1-10 range", async () => {
    renderSheet();

    const rpeInput = screen.getByTestId("edit-set-rpe-input");
    await userEvent.clear(rpeInput);
    await userEvent.type(rpeInput, "11");

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("RPE must be between 1 and 10.");
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("supports decimal weight input precision (e.g. 22.5 lbs)", async () => {
    renderSheet();

    const weightInput = screen.getByTestId("edit-set-weight-input");
    await userEvent.clear(weightInput);
    await userEvent.type(weightInput, "22.5");

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 22.5,
        })
      );
    });
  });

  it("renders fallback option when exercise_id is not in the exercises library", () => {
    const unlistedSet = {
      ...mockSet,
      id: "unlisted-1",
      exercise_id: "ex-unknown-uuid",
      exercise_name: "Custom Kettlebell Snatch",
    };
    renderSheet({ set: unlistedSet });

    const select = screen.getByTestId("edit-set-exercise-select") as HTMLSelectElement;
    expect(select.value).toBe("ex-unknown-uuid");
    expect(screen.getByText("Custom Kettlebell Snatch")).toBeDefined();
  });

  it("calls onDeleteRequested without window.confirm or delete mutation when delete button clicked", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderSheet();

    const deleteBtn = screen.getByTestId("delete-set-btn");
    fireEvent.click(deleteBtn);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onDeleteRequested).toHaveBeenCalledTimes(1);
    expect(onDeleteRequested).toHaveBeenCalledWith(mockSet);
    expect(mockDbFrom).not.toHaveBeenCalled();
  });

  it("Escape or Cancel calls onClose only without requesting delete or save", () => {
    renderSheet();

    // Cancel / Close via X button in sheet header
    const closeBtn = screen.getByRole("button", { name: "Close Edit Workout Set" });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDeleteRequested).not.toHaveBeenCalled();
  });

  it("save calls onSaved(updated) with the row returned by the UPDATE", async () => {
    renderSheet();

    const weightInput = screen.getByTestId("edit-set-weight-input");
    fireEvent.change(weightInput, { target: { value: "195" } });

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "set-123",
          weight: 195,
        })
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("editing set 3 preserves set_index and created_at on save and does not write created_at to updateSet", async () => {
    const originalCreatedAt = "2026-09-01T10:00:00Z";
    const set3: WorkoutSet & { workout_date?: string; workout_name?: string } = {
      ...mockSet,
      id: "set-3",
      set_index: 3,
      created_at: originalCreatedAt,
    };

    renderSheet({ set: set3 });

    const weightInput = screen.getByTestId("edit-set-weight-input");
    fireEvent.change(weightInput, { target: { value: "205" } });

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "set-3",
        set_index: 3,
        created_at: originalCreatedAt,
        weight: 205,
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setIndex: 3,
        weight: 205,
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        createdAt: expect.anything(),
      })
    );
  });

  it("displays mutation error message if update fails", async () => {
    const errResult = { data: null, error: { message: "Database connection error" } };
    const errBuilder = Object.assign(Promise.resolve(errResult), {
      select: vi.fn().mockResolvedValue(errResult),
    });
    mockUpdateEq.mockReturnValueOnce(errBuilder);

    renderSheet();
    const weightInput = screen.getByTestId("edit-set-weight-input");
    fireEvent.change(weightInput, { target: { value: "190" } });

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Database connection error");
    });
  });

  it("resets internal form state when a different set is passed to the modal", () => {
    const { rerender } = renderSheet();

    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(weightInput.value).toBe("185");

    const set2 = {
      ...mockSet,
      id: "set-999",
      weight: 275,
      reps: 5,
    };

    rerender(
      <AuthContext.Provider value={createAuthContextValue('lb')}>
        <QueryClientProvider client={queryClient}>
          <EditSetSheet
            isOpen={true}
            set={set2}
            exercises={mockExercises}
            onClose={onClose}
            onSaved={onSaved}
            onDeleteRequested={onDeleteRequested}
            targetUserId="user-789"
          />
        </QueryClientProvider>
      </AuthContext.Provider>
    );

    const updatedWeightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(updatedWeightInput.value).toBe("275");
  });

  it("mounts live regions empty while idle and retains same DOM node on error mutation", async () => {
    const { container } = renderSheet();

    const assertiveBefore = container.querySelector(`[role="alert"]`);
    const politeBefore = container.querySelector(`[role="status"]`);

    expect(assertiveBefore).not.toBeNull();
    expect(politeBefore).not.toBeNull();
    expect(assertiveBefore!.textContent).toBe("");
    expect(politeBefore!.textContent).toBe("");

    // Trigger validation error
    const weightInput = screen.getByTestId("edit-set-weight-input");
    await userEvent.clear(weightInput);
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(assertiveBefore!.textContent).toBe("Please enter a weight (0 for bodyweight).");
    });

    const assertiveAfter = container.querySelector(`[role="alert"]`);
    expect(assertiveAfter).toBe(assertiveBefore);
    expect(assertiveAfter!.textContent).toBe("Please enter a weight (0 for bodyweight).");
  });

  it("passes axe accessibility checks without violations (STD-A11Y-4)", async () => {
    const { container } = renderSheet();
    await expectNoA11yViolations(container);
  });

  it("renders weight in kg and preserves original lb if weight is untouched", async () => {
    const set225 = { ...mockSet, weight: 225 };
    renderSheet({ set: set225 }, "kg");

    expect(screen.getByText("Weight (kg)")).toBeInTheDocument();
    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(weightInput.value).toBe("102.1");

    // If user changes reps without changing weight, original 225 lb is preserved
    const repsInput = screen.getByTestId("edit-set-reps-input");
    fireEvent.change(repsInput, { target: { value: "10" } });

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 225,
          reps: 10,
        })
      );
    });
  });

  it("converts kg weight input to lb on save", async () => {
    const set225 = { ...mockSet, weight: 225 };
    renderSheet({ set: set225 }, "kg");

    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    // User enters 100 kg, resolves to 100 * 2.20462262185 = ~220.462 lb
    fireEvent.change(weightInput, { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: expect.closeTo(220.462, 2),
        })
      );
    });
  });

  it("maps changed elsewhere error to friendly banner and displays accessible Reload button", async () => {
    const errResult = { data: null, error: { message: "changed elsewhere" } };
    const errBuilder = Object.assign(Promise.resolve(errResult), {
      select: vi.fn().mockResolvedValue(errResult),
    });
    mockUpdateEq.mockReturnValueOnce(errBuilder);

    renderSheet();
    const repsInput = screen.getByTestId("edit-set-reps-input");
    fireEvent.change(repsInput, { target: { value: "14" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This set was changed on another device.");
    });

    const reloadBtn = screen.getByTestId("reload-set-btn");
    expect(reloadBtn).toBeInTheDocument();
    expect(reloadBtn).toHaveTextContent("Reload");
    expect(reloadBtn).toHaveClass("min-h-[44px]");
  });

  it("maps deleted elsewhere error to friendly banner", async () => {
    const errResult = { data: null, error: { message: "deleted elsewhere" } };
    const errBuilder = Object.assign(Promise.resolve(errResult), {
      select: vi.fn().mockResolvedValue(errResult),
    });
    mockUpdateEq.mockReturnValueOnce(errBuilder);

    renderSheet();
    const repsInput = screen.getByTestId("edit-set-reps-input");
    fireEvent.change(repsInput, { target: { value: "14" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This set was deleted on another device.");
    });
    expect(screen.getByTestId("reload-set-btn")).toBeInTheDocument();
  });

  it("Reload flow: refetches latest server values, updates inputs, clears banner, and allows saving again", async () => {
    const errResult = { data: null, error: { message: "changed elsewhere" } };
    const errBuilder = Object.assign(Promise.resolve(errResult), {
      select: vi.fn().mockResolvedValue(errResult),
    });
    mockUpdateEq.mockReturnValueOnce(errBuilder);

    renderSheet();
    const repsInput = screen.getByTestId("edit-set-reps-input");
    fireEvent.change(repsInput, { target: { value: "14" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This set was changed on another device.");
    });

    // Mock fetchSetById returning fresh row from another device: 205 lb, 12 reps, RPE 9, working
    mockFetchSetById.mockResolvedValueOnce({
      id: "set-123",
      workout_id: "workout-456",
      exercise_id: "ex-1",
      weight: 205,
      reps: 12,
      rpe: 9,
      set_type: "working",
    });

    const reloadBtn = screen.getByTestId("reload-set-btn");
    fireEvent.click(reloadBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("reload-set-btn")).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent("");
    });

    expect(mockFetchSetById).toHaveBeenCalledWith(expect.anything(), "set-123");

    // Inputs now reflect fresh server values
    const weightInput = screen.getByTestId("edit-set-weight-input") as HTMLInputElement;
    expect(weightInput.value).toBe("205");
    expect((screen.getByTestId("edit-set-reps-input") as HTMLInputElement).value).toBe("12");
    expect((screen.getByTestId("edit-set-rpe-input") as HTMLInputElement).value).toBe("9");

    // Save button should be disabled because form matches newly reloaded values (not dirty)
    expect(screen.getByTestId("save-set-btn")).toBeDisabled();

    // Now user makes an edit from the reloaded values
    fireEvent.change(screen.getByTestId("edit-set-reps-input"), { target: { value: "13" } });
    expect(screen.getByTestId("save-set-btn")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 205,
          reps: 13,
          rpe: 9,
          set_type: "working",
        })
      );
      expect(mockExpected).toHaveBeenCalledWith(
        expect.objectContaining({
          weight: 205,
          reps: 12,
          rpe: 9,
          set_type: "working",
        })
      );
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("Reload flow closes the sheet if set was deleted on the server", async () => {
    const errResult = { data: null, error: { message: "deleted elsewhere" } };
    const errBuilder = Object.assign(Promise.resolve(errResult), {
      select: vi.fn().mockResolvedValue(errResult),
    });
    mockUpdateEq.mockReturnValueOnce(errBuilder);

    renderSheet();
    fireEvent.change(screen.getByTestId("edit-set-reps-input"), { target: { value: "14" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This set was deleted on another device.");
    });

    mockFetchSetById.mockResolvedValueOnce(null);

    fireEvent.click(screen.getByTestId("reload-set-btn"));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("builds normalized expected pre-image from resolved exercise UUID and normalized set_type", async () => {
    const setWithDrift = {
      ...mockSet,
      exercise_id: "non-uuid-name",
      exercise_name: "Incline Bench Press",
      set_type: "normal" as any,
      rpe: undefined,
    };

    renderSheet({ set: setWithDrift });

    fireEvent.change(screen.getByTestId("edit-set-reps-input"), { target: { value: "11" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockExpected).toHaveBeenCalledWith(
        expect.objectContaining({
          exercise_id: "ex-1",
          set_type: "working",
          weight: 185,
          reps: 8,
        })
      );
    });
  });

  it("preserves warmup set_type and rpe 8 in expected pre-image when editing reps", async () => {
    const warmupSetWithRpe = {
      ...mockSet,
      set_type: "warmup" as const,
      rpe: 8,
    };

    renderSheet({ set: warmupSetWithRpe });

    fireEvent.change(screen.getByTestId("edit-set-reps-input"), { target: { value: "11" } });
    fireEvent.click(screen.getByTestId("save-set-btn"));

    await waitFor(() => {
      expect(mockExpected).toHaveBeenCalledWith(
        expect.objectContaining({
          exercise_id: "ex-1",
          set_type: "warmup",
          rpe: 8,
          weight: 185,
          reps: 8,
        })
      );
    });
  });
});
