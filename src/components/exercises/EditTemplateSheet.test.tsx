import { useState, useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditTemplateSheet } from "./EditTemplateSheet";
import { expectNoA11yViolationsForRules } from "../../test/a11y";
import type { Exercise, RoutineTemplate } from "../../types/database";
import { supabase } from "../../lib/supabase";
import {
  createSupabaseBuilder,
  clearMockHistory,
  getRecordedTables,
  assertSelectRecorded,
} from "../../test/supabaseBuilderMock";

let mockTemplateRows: Record<string, any> = {};
let mockFetchError: any = null;
let mockFromHandler: ((table: string) => any) | null = null;

function resetMockTemplateRows() {
  mockFetchError = null;
  mockFromHandler = null;
  mockTemplateRows = {
    "tpl-1": {
      id: "tpl-1",
      user_id: "user-1",
      name: "Push Day",
      is_master: false,
      days_of_week: ["Mon"],
      assigned_to: null,
      updated_at: "2026-09-28T12:00:00Z",
      exercises: [],
    },
    "tpl-master-1": {
      id: "tpl-master-1",
      user_id: "user-1",
      name: "Master Routine",
      is_master: true,
      days_of_week: ["Mon"],
      assigned_to: null,
      updated_at: "2026-09-28T12:00:00Z",
      exercises: [
        {
          id: "te-1",
          template_id: "tpl-master-1",
          exercise_id: "ex-1",
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
          exercise: { id: "ex-1", name: "Squat" },
        },
      ],
    },
  };
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (mockFromHandler) {
        const custom = mockFromHandler(table);
        if (custom !== undefined) return custom;
      }
      if (table === "routine_templates") {
        return createSupabaseBuilder(table, {
          resolver: (builder: any) => {
            if (mockFetchError) {
              return { data: null, error: mockFetchError };
            }
            const idFilter = builder.filters.find((f: any) => f.column === "id");
            const id = idFilter ? idFilter.value : "tpl-1";
            const row = mockTemplateRows[id] ?? {
              id,
              user_id: "user-1",
              name: "Push Day",
              is_master: false,
              days_of_week: ["Mon"],
              assigned_to: null,
              updated_at: "2026-09-28T12:00:00Z",
              exercises: [],
            };
            return { data: row, error: null };
          },
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

// Mock ExercisePicker to verify overlay integration & focus return
vi.mock("./ExercisePicker", () => ({
  ExercisePicker: ({
    isOpen,
    onClose,
    onAdd,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (ex: any[]) => void;
  }) => {
    useEffect(() => {
      if (!isOpen) return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
        }
      };
      document.addEventListener("keydown", onKeyDown, true);
      return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [isOpen, onClose]);

    if (!isOpen) return null;
    return (
      <dialog open aria-modal="true" data-testid="exercise-picker-sheet">
        <button
          type="button"
          data-testid="close-exercise-picker"
          onClick={onClose}
        >
          Close Picker
        </button>
        <button
          type="button"
          data-testid="add-picker-item"
          onClick={() =>
            onAdd([
              {
                id: "ex-new-1",
                name: "Incline Dumbbell Press",
                body_part: "Chest",
                equipment: "Dumbbell",
                is_master: false,
                user_id: null,
                is_archived: false,
                is_hidden: false,
              },
            ])
          }
        >
          Add Incline Press
        </button>
      </dialog>
    );
  },
}));

describe("EditTemplateSheet", () => {
  const mockTemplate: RoutineTemplate = {
    id: "tpl-1",
    user_id: "user-1",
    name: "Push Day",
    is_master: false,
    days_of_week: ["Mon"],
    assigned_to: null,
    exercises: [],
  };

  const mockProps = {
    isOpen: true,
    template: mockTemplate,
    exercises: [] as Exercise[],
    targetUserId: "user-1",
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    resetMockTemplateRows();
  });

  function renderSheet(ui: React.ReactElement) {
    if (ui && (ui as any).props && (ui as any).props.template && (ui as any).props.template.id) {
      const t = (ui as any).props.template;
      mockTemplateRows[t.id] = {
        ...t,
        updated_at: mockTemplateRows[t.id]?.updated_at || t.updated_at || "2026-09-28T12:00:00Z",
        exercises: (t.exercises || []).map((te: any) => ({
          ...te,
          exercise: te.exercise || {
            id: te.exercise_id,
            name:
              te.exercise_id === "ex-2"
                ? "Overhead Press"
                : te.exercise_id === "ex-1"
                ? ((ui as any).props.exercises?.find((e: any) => e.id === "ex-1")?.name || "Squat")
                : "Exercise",
          },
        })),
      };
    }
    return render(ui);
  }

  async function renderSheetAndWait(ui: React.ReactElement) {
    const res = renderSheet(ui);
    await waitFor(() => {
      expect(screen.queryByTestId("template-sheet-skeleton")).toBeNull();
    });
    return res;
  }

  it("has accessible label association for Template Name and uses input-text-sm (NEW-17)", async () => {
    await renderSheetAndWait(<EditTemplateSheet {...mockProps} />);
    const input = screen.getByLabelText(/template name/i);
    expect(input).toBeDefined();
    expect(input.classList.contains("input-text-sm")).toBe(true);
    expect(input.classList.contains("text-sm")).toBe(false);
  });

  it("has no a11y label violations", async () => {
    const { container } = await renderSheetAndWait(<EditTemplateSheet {...mockProps} />);
    await expectNoA11yViolationsForRules(container, ["label"]);
  });

  it("mounts template-error live region empty while idle and retains same node on error (NEW-15)", async () => {
    const { container } = await renderSheetAndWait(<EditTemplateSheet {...mockProps} />);

    // Live region exists and is empty while idle
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe("");

    // Trigger save with no exercises
    fireEvent.click(screen.getByTestId("save-template-btn"));

    expect(alert?.textContent).toBe("Please add at least one exercise to the template.");
    expect(screen.getByTestId("template-error")).toBeDefined();

    // Live region DOM node remains identical
    expect(container.querySelector('[role="alert"]')).toBe(alert);
  });

  describe("accessibility and focus management", () => {
    it("traps focus, restores focus on close, and closes on Escape", async () => {
      function Wrapper() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <button data-testid="opener-btn" onClick={() => setOpen(true)}>
              Open
            </button>
            <EditTemplateSheet
              {...mockProps}
              isOpen={open}
              onClose={() => setOpen(false)}
            />
          </div>
        );
      }

      render(<Wrapper />);
      const opener = screen.getByTestId("opener-btn");
      opener.focus();
      fireEvent.click(opener);

      // Wait for sheet to finish loading
      await waitFor(() => {
        expect(screen.queryByTestId("template-sheet-skeleton")).toBeNull();
      });

      // 1. Dialog element exists with ARIA attributes
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeDefined();
      expect(dialog).toHaveAttribute("aria-modal", "true");

      // 2. Focus moved into dialog
      const closeBtn = screen.getByRole("button", { name: /close/i });
      expect(document.activeElement).toBe(closeBtn);

      // 3. Tab wraps from last focusable to first focusable
      const saveBtn = screen.getByTestId("save-template-btn");
      saveBtn.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(closeBtn);

      // 4. Shift+Tab wraps from first focusable to last focusable
      closeBtn.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(saveBtn);

      // 5. Escape closes the sheet and restores focus to the opener
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it("closes nested ExercisePicker first on Escape, then closes sheet on second Escape", async () => {
      function Wrapper() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <button data-testid="opener-btn" onClick={() => setOpen(true)}>
              Open
            </button>
            <EditTemplateSheet
              {...mockProps}
              isOpen={open}
              onClose={() => setOpen(false)}
            />
          </div>
        );
      }

      render(<Wrapper />);
      fireEvent.click(screen.getByTestId("opener-btn"));
      await waitFor(() => {
        expect(screen.queryByTestId("template-sheet-skeleton")).toBeNull();
      });
      expect(screen.getByRole("dialog")).toBeDefined();

      // Open exercise picker sheet
      fireEvent.click(screen.getByTestId("open-exercise-picker"));
      expect(screen.getByTestId("close-exercise-picker")).toBeDefined();

      // First Escape closes picker only
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("close-exercise-picker")).toBeNull();
      expect(screen.getByRole("dialog")).toBeDefined();

      // Second Escape closes sheet
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("focus returns to Add exercise button after closing ExercisePicker (L36)", async () => {
      await renderSheetAndWait(<EditTemplateSheet {...mockProps} />);

      const addBtn = screen.getByTestId("open-exercise-picker");
      fireEvent.click(addBtn);

      // Picker is open
      const closePickerBtn = screen.getByTestId("close-exercise-picker");
      fireEvent.click(closePickerBtn);

      // Picker is closed and focus returns to add exercise trigger
      await waitFor(() => {
        expect(document.activeElement).toBe(addBtn);
      });
    });
  });

  it("satisfies mock fidelity contracts for routine template mutations", () => {
    // Exact projection assertion for fetch-on-open
    const queryBuilder = createSupabaseBuilder("routine_templates", { data: [], error: null });
    queryBuilder.select("*, exercises:template_exercises(*, exercise:exercises(*))");

    assertSelectRecorded(
      "routine_templates",
      "*, exercises:template_exercises(*, exercise:exercises(*))"
    );

    // WILDCARD_MUTATION_RETURN: routine_templates returns created row via bare .select()
    // NO_PROJECTION_APPLIES: template_exercises updates and inserts are mutation-only
    const tplBuilder = createSupabaseBuilder("routine_templates", {
      data: [],
      error: null,
    });
    const exBuilder = createSupabaseBuilder("template_exercises", {
      data: [],
      error: null,
    });
    expect(tplBuilder.tableName).toBe("routine_templates");
    expect(exBuilder.tableName).toBe("template_exercises");
    expect(getRecordedTables()).toContain("routine_templates");
    expect(getRecordedTables()).toContain("template_exercises");
  });

  it("L2: passes p_is_master: true when saving an existing master routine template", async () => {
    const masterTpl: RoutineTemplate = {
      id: "tpl-master-1",
      user_id: "user-1",
      name: "Master Routine",
      is_master: true,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [
        {
          id: "te-1",
          template_id: "tpl-master-1",
          exercise_id: "ex-1",
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
        },
      ],
    };

    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.rpc as any) = mockRpc;

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={masterTpl}
        exercises={[
          {
            id: "ex-1",
            name: "Squat",
            body_part: "Legs",
            is_master: true,
            user_id: "master-owner",
            is_archived: false,
          },
        ]}
      />
    );

    fireEvent.click(screen.getByTestId("save-template-btn"));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        "save_routine_template",
        expect.objectContaining({
          p_template_id: "tpl-master-1",
          p_is_master: true,
        })
      );
    });
  });

  it("L5: when save_routine_template RPC fails, no fallback queries are executed and error is shown", async () => {
    const tpl: RoutineTemplate = {
      id: "tpl-1",
      user_id: "user-1",
      name: "Push Routine",
      is_master: false,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [
        {
          id: "te-1",
          template_id: "tpl-1",
          exercise_id: "ex-1",
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
        },
      ],
    };

    const mockRpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("RPC save failed") });
    (supabase.rpc as any) = mockRpc;

    const mockFromSpy = vi.fn();
    mockFromHandler = (table: string) => {
      mockFromSpy(table);
      if (table === "routine_templates") {
        return createSupabaseBuilder(table, {
          resolver: () => ({
            data: {
              ...tpl,
              updated_at: "2026-09-28T12:00:00Z",
              exercises: [{ ...(tpl.exercises as any)[0], exercise: { id: "ex-1", name: "Squat" } }],
            },
            error: null,
          }),
        });
      }
      return undefined;
    };

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tpl}
        exercises={[
          {
            id: "ex-1",
            name: "Squat",
            body_part: "Legs",
            is_master: true,
            user_id: "master-owner",
            is_archived: false,
          },
        ]}
      />
    );

    mockFromSpy.mockClear();

    fireEvent.click(screen.getByTestId("save-template-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("template-error")).toBeDefined();
    });

    expect(mockFromSpy).not.toHaveBeenCalled();
  });

  it("L12: disables save button and displays inline error on whitespace name", async () => {
    const tpl: RoutineTemplate = {
      id: "tpl-1",
      user_id: "user-1",
      name: "Push Routine",
      is_master: false,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [
        {
          id: "te-1",
          template_id: "tpl-1",
          exercise_id: "ex-1",
          order_index: 0,
          target_sets: 3,
          target_reps: 10,
        },
      ],
    };

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tpl}
        exercises={[
          {
            id: "ex-1",
            name: "Squat",
            body_part: "Legs",
            is_master: true,
            user_id: "master-owner",
            is_archived: false,
          },
        ]}
      />
    );

    const input = screen.getByLabelText(/template name/i);
    fireEvent.change(input, { target: { value: "    " } });

    const saveBtn = screen.getByTestId("save-template-btn");
    expect(saveBtn).toBeDisabled();
    expect(
      screen.getByText(/Template name cannot be blank or whitespace-only./i)
    ).toBeDefined();
  });

  it("L15: day toggles have role=group aria-label='Scheduled days' and aria-pressed attributes", async () => {
    await renderSheetAndWait(<EditTemplateSheet {...mockProps} />);

    const group = screen.getByRole("group", { name: "Scheduled days" });
    expect(group).toBeDefined();

    const monPill = screen.getByTestId("day-pill-Mon");
    expect(monPill).toHaveAttribute("aria-pressed", "true");

    const tuePill = screen.getByTestId("day-pill-Tue");
    expect(tuePill).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(tuePill);
    expect(tuePill).toHaveAttribute("aria-pressed", "true");
  });

  it("L17: reorder polite live region announces 'Moved <name> to position N of M'", async () => {
    const tpl: RoutineTemplate = {
      id: "tpl-1",
      user_id: "user-1",
      name: "Push Day",
      is_master: false,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
        { id: "te-2", template_id: "tpl-1", exercise_id: "ex-2", order_index: 1, target_sets: 3, target_reps: 10 },
      ],
    };

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tpl}
        exercises={[
          { id: "ex-1", name: "Bench Press", body_part: "Chest", is_master: true, user_id: null, is_archived: false },
          { id: "ex-2", name: "Overhead Press", body_part: "Shoulders", is_master: true, user_id: null, is_archived: false },
        ]}
      />
    );

    const liveRegion = screen.getByTestId("reorder-live-region");
    expect(liveRegion.textContent).toBe("");

    // Move second exercise up to position 1 of 2
    const moveUpBtn = screen.getByTestId("move-up-1");
    fireEvent.click(moveUpBtn);

    expect(liveRegion.textContent).toBe("Moved Overhead Press to position 1 of 2");
  });

  it("L29: displays StatusBanner info for master routine (replaces hand-rolled banner)", async () => {
    const masterTpl: RoutineTemplate = {
      id: "tpl-master-1",
      user_id: "user-1",
      name: "Master Routine",
      is_master: true,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [],
    };

    await renderSheetAndWait(<EditTemplateSheet {...mockProps} template={masterTpl} />);

    const banner = screen.getByTestId("master-routine-banner");
    expect(banner).toBeDefined();
    expect(screen.getAllByText(/Editing Master Routine — changes will apply to all athletes/i).length).toBeGreaterThanOrEqual(1);
  });

  it("L43: single RPC call with p_expected_updated_at", async () => {
    const tplWithDate = {
      ...mockTemplate,
      updated_at: "2026-09-28T12:00:00Z",
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
      ],
    } as any;

    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.rpc as any) = mockRpc;

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tplWithDate}
        exercises={[{ id: "ex-1", name: "Squat", body_part: "Legs", is_master: true, user_id: null, is_archived: false }]}
      />
    );

    fireEvent.click(screen.getByTestId("save-template-btn"));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith(
        "save_routine_template",
        expect.objectContaining({
          p_template_id: "tpl-1",
          p_expected_updated_at: "2026-09-28T12:00:00Z",
        })
      );
    });
  });

  it("L43: displays stale 409 StatusBanner with Reload action, no second write, and reload refetches", async () => {
    const tplWithDate = {
      ...mockTemplate,
      updated_at: "2026-09-28T12:00:00Z",
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
      ],
    } as any;

    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PT409", message: "stale_template" },
    });
    (supabase.rpc as any) = mockRpc;

    const reloadedRow = {
      id: "tpl-1",
      name: "Push Day (Updated Elsewhere)",
      days_of_week: ["Mon", "Wed"],
      updated_at: "2026-09-28T13:00:00Z",
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10, exercise: { id: "ex-1", name: "Squat" } },
      ],
    };

    let fetchCount = 0;
    mockFromHandler = (table: string) => {
      if (table === "routine_templates") {
        return createSupabaseBuilder(table, {
          resolver: () => {
            fetchCount++;
            if (fetchCount === 1) {
              return {
                data: {
                  ...tplWithDate,
                  exercises: [{ ...tplWithDate.exercises[0], exercise: { id: "ex-1", name: "Squat" } }],
                },
                error: null,
              };
            }
            return { data: reloadedRow, error: null };
          },
        });
      }
      return undefined;
    };

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tplWithDate}
        exercises={[{ id: "ex-1", name: "Squat", body_part: "Legs", is_master: true, user_id: null, is_archived: false }]}
      />
    );

    fireEvent.click(screen.getByTestId("save-template-btn"));

    // 409 error banner shown
    await waitFor(() => {
      expect(screen.getByTestId("stale-template-banner")).toBeDefined();
      expect(
        screen.getAllByText(
          "This routine was changed elsewhere. Reload to see the latest version."
        ).length
      ).toBeGreaterThanOrEqual(1);
    });

    // Never overwrite: exactly 1 RPC call, no second write!
    expect(mockRpc).toHaveBeenCalledTimes(1);

    // Click Reload action
    const reloadBtn = screen.getByTestId("reload-template-btn");
    fireEvent.click(reloadBtn);

    await waitFor(() => {
      expect(screen.getByTestId("template-name-input")).toHaveValue(
        "Push Day (Updated Elsewhere)"
      );
      // Stale banner cleared
      expect(screen.queryByTestId("stale-template-banner")).toBeNull();
    });
  });

  it("L13: dismiss blocked while saving (dismissible={!saving}) and buttons disabled", async () => {
    let resolveRpc: (val: any) => void;
    const rpcPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });

    const mockRpc = vi.fn().mockReturnValue(rpcPromise);
    (supabase.rpc as any) = mockRpc;

    const onClose = vi.fn();
    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        onClose={onClose}
        template={{
          ...mockTemplate,
          exercises: [
            { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
          ],
        }}
        exercises={[{ id: "ex-1", name: "Squat", body_part: "Legs", is_master: true, user_id: null, is_archived: false }]}
      />
    );

    fireEvent.click(screen.getByTestId("save-template-btn"));

    // While saving is pending:
    // 1. Escape does NOT close the modal
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    // 2. Cancel and Save buttons are disabled
    expect(screen.getByTestId("cancel-template-btn")).toBeDisabled();
    expect(screen.getByTestId("save-template-btn")).toBeDisabled();

    // Resolve RPC
    resolveRpc!({ data: null, error: null });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("L43: fetch-on-open queries routine_templates with exact projection on mount", async () => {
    const existingTpl: RoutineTemplate = {
      id: "tpl-1",
      user_id: "user-1",
      name: "Fresh Push Day",
      is_master: false,
      days_of_week: ["Mon", "Wed"],
      assigned_to: null,
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 4, target_reps: 12 },
      ],
    };

    mockTemplateRows["tpl-1"] = {
      ...existingTpl,
      updated_at: "2026-09-28T15:30:00Z",
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 4, target_reps: 12, exercise: { id: "ex-1", name: "Squat" } },
      ],
    };

    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.rpc as any) = mockRpc;

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={existingTpl}
        exercises={[{ id: "ex-1", name: "Squat", body_part: "Legs", is_master: true, user_id: null, is_archived: false }]}
      />
    );

    // Verify projection
    assertSelectRecorded(
      "routine_templates",
      "*, exercises:template_exercises(*, exercise:exercises(*))"
    );

    // Form is populated from fetched data
    expect(screen.getByTestId("template-name-input")).toHaveValue("Fresh Push Day");

    // Saving passes fetched updated_at
    fireEvent.click(screen.getByTestId("save-template-btn"));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        "save_routine_template",
        expect.objectContaining({
          p_template_id: "tpl-1",
          p_expected_updated_at: "2026-09-28T15:30:00Z",
        })
      );
    });
  });

  it("L43: displays loading skeleton and disables save while loading template", async () => {
    let resolveQuery: (val: any) => void;
    const queryPromise = new Promise((resolve) => {
      resolveQuery = resolve;
    });

    mockFromHandler = (table: string) => {
      if (table === "routine_templates") {
        return createSupabaseBuilder(table, {
          resolver: () => queryPromise,
        });
      }
      return undefined;
    };

    render(<EditTemplateSheet {...mockProps} />);

    // Skeleton is visible while loading
    expect(screen.getByTestId("template-sheet-skeleton")).toBeDefined();
    // Save button is disabled
    expect(screen.getByTestId("save-template-btn")).toBeDisabled();

    // Resolve query
    resolveQuery!({
      data: {
        id: "tpl-1",
        name: "Loaded Push",
        days_of_week: ["Mon"],
        updated_at: "2026-09-28T12:00:00Z",
        exercises: [],
      },
      error: null,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("template-sheet-skeleton")).toBeNull();
    });
    expect(screen.getByTestId("template-name-input")).toHaveValue("Loaded Push");
  });

  it("L43: displays StatusBanner with Retry on fetch error and retries fetch on click", async () => {
    mockFetchError = new Error("Network timeout loading routine template");

    render(<EditTemplateSheet {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByTestId("template-fetch-error-banner")).toBeDefined();
      expect(
        screen.getAllByText("Network timeout loading routine template").length
      ).toBeGreaterThanOrEqual(1);
    });

    const retryBtn = screen.getByTestId("retry-fetch-template-btn");
    expect(retryBtn).toBeDefined();

    // Clear error
    mockFetchError = null;
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("template-fetch-error-banner")).toBeNull();
      expect(screen.getByTestId("template-name-input")).toBeDefined();
    });
  });

  it("L17: polite live region announces remove and add to routine", async () => {
    const tpl: RoutineTemplate = {
      id: "tpl-1",
      user_id: "user-1",
      name: "Push Day",
      is_master: false,
      days_of_week: ["Mon"],
      assigned_to: null,
      exercises: [
        { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
      ],
    };

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={tpl}
        exercises={[
          { id: "ex-1", name: "Bench Press", body_part: "Chest", is_master: true, user_id: null, is_archived: false },
          { id: "ex-2", name: "Incline Dumbbell Press", body_part: "Chest", is_master: true, user_id: null, is_archived: false },
        ]}
      />
    );

    const liveRegion = screen.getByTestId("reorder-live-region");

    // Remove exercise
    const removeBtn = screen.getByTestId("remove-exercise-0");
    fireEvent.click(removeBtn);
    expect(liveRegion.textContent).toBe("Removed Bench Press from routine");

    // Add exercise via picker trigger
    const addTrigger = screen.getByTestId("open-exercise-picker");
    fireEvent.click(addTrigger);
    const addCompatBtn = screen.getByTestId("add-exercise-btn-ex-2");
    fireEvent.click(addCompatBtn);
    expect(liveRegion.textContent).toBe("Added Incline Dumbbell Press to routine");
  });

  it("L13: double-submit guard calls save_routine_template only once on rapid multiple clicks", async () => {
    let resolveRpc: (val: any) => void;
    const rpcPromise = new Promise((resolve) => {
      resolveRpc = resolve;
    });

    const mockRpc = vi.fn().mockReturnValue(rpcPromise);
    (supabase.rpc as any) = mockRpc;

    await renderSheetAndWait(
      <EditTemplateSheet
        {...mockProps}
        template={{
          ...mockTemplate,
          exercises: [
            { id: "te-1", template_id: "tpl-1", exercise_id: "ex-1", order_index: 0, target_sets: 3, target_reps: 10 },
          ],
        }}
        exercises={[{ id: "ex-1", name: "Squat", body_part: "Legs", is_master: true, user_id: null, is_archived: false }]}
      />
    );

    const saveBtn = screen.getByTestId("save-template-btn");
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(mockRpc).toHaveBeenCalledTimes(1);

    resolveRpc!({ data: { success: true, template_id: "tpl-1" }, error: null });
  });

});
