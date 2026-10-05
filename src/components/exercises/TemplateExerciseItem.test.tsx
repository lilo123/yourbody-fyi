import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateExerciseItem } from "./TemplateExerciseItem";
import type { EditableTemplateExercise } from "./EditTemplateSheet";
import { expectNoA11yViolations } from "../../test/a11y";

describe("TemplateExerciseItem", () => {
  const mockExercise: EditableTemplateExercise = {
    id: "te-1",
    exercise_id: "ex-1",
    exercise_name: "Barbell Bench Press",
    body_parts: ["Chest", "Triceps"],
    target_sets: 3,
    target_reps: 10,
  };

  const defaultProps = {
    exercise: mockExercise,
    index: 0,
    totalCount: 3,
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onRemove: vi.fn(),
    onUpdateSets: vi.fn(),
    onUpdateReps: vi.fn(),
  };

  it("renders exercise name, sequence number, and body_parts subtitle", () => {
    render(<TemplateExerciseItem {...defaultProps} />);

    expect(screen.getByText("Barbell Bench Press")).toBeDefined();
    expect(screen.getByText("1.")).toBeDefined();
    expect(screen.getByText("Chest, Triceps")).toBeDefined();
  });

  it("L16: provides descriptive aria-labels naming the exercise on all buttons", () => {
    render(<TemplateExerciseItem {...defaultProps} index={1} />);

    expect(screen.getByRole("button", { name: "Move Barbell Bench Press up" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Move Barbell Bench Press down" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove Barbell Bench Press" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Decrease Barbell Bench Press sets" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Increase Barbell Bench Press sets" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Decrease Barbell Bench Press reps" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Increase Barbell Bench Press reps" })).toBeDefined();
  });

  it("disables move-up on first item and move-down on last item", () => {
    const { rerender } = render(<TemplateExerciseItem {...defaultProps} index={0} totalCount={3} />);

    const moveUp0 = screen.getByRole("button", { name: "Move Barbell Bench Press up" });
    const moveDown0 = screen.getByRole("button", { name: "Move Barbell Bench Press down" });
    expect(moveUp0).toBeDisabled();
    expect(moveDown0).not.toBeDisabled();

    // Move down click calls onMoveDown
    fireEvent.click(moveDown0);
    expect(defaultProps.onMoveDown).toHaveBeenCalledWith(0);

    // Last item
    rerender(<TemplateExerciseItem {...defaultProps} index={2} totalCount={3} />);
    const moveUp2 = screen.getByRole("button", { name: "Move Barbell Bench Press up" });
    const moveDown2 = screen.getByRole("button", { name: "Move Barbell Bench Press down" });
    expect(moveUp2).not.toBeDisabled();
    expect(moveDown2).toBeDisabled();

    fireEvent.click(moveUp2);
    expect(defaultProps.onMoveUp).toHaveBeenCalledWith(2);
  });

  it("calls onRemove when remove button is clicked", () => {
    render(<TemplateExerciseItem {...defaultProps} index={1} />);

    const removeBtn = screen.getByRole("button", { name: "Remove Barbell Bench Press" });
    fireEvent.click(removeBtn);
    expect(defaultProps.onRemove).toHaveBeenCalledWith(1);
  });

  it("L40: stepper clear != 1 then blur clamps (clearing input does not snap to 1; clamps on blur)", () => {
    const onUpdateSets = vi.fn();
    render(<TemplateExerciseItem {...defaultProps} onUpdateSets={onUpdateSets} />);

    const setsInput = screen.getByLabelText("Barbell Bench Press sets");
    expect(setsInput).toHaveValue(3);

    // Clear input: value is blank, does not snap to 1 immediately!
    fireEvent.change(setsInput, { target: { value: "" } });
    expect(setsInput).toHaveValue("");
    expect(onUpdateSets).not.toHaveBeenCalled();

    // Blur input: clamps to min (1) and commits
    fireEvent.blur(setsInput);
    expect(onUpdateSets).toHaveBeenCalledWith(0, 1);
    expect((setsInput as HTMLInputElement).value).toBe("1");
  });

  it("L40: stepper clamps out-of-range typed values on blur", () => {
    const onUpdateReps = vi.fn();
    render(<TemplateExerciseItem {...defaultProps} onUpdateReps={onUpdateReps} />);

    const repsInput = screen.getByLabelText("Barbell Bench Press reps");
    expect(repsInput).toHaveValue(10);

    // Type 999 (exceeds max 100)
    fireEvent.change(repsInput, { target: { value: "999" } });
    fireEvent.blur(repsInput);
    expect(onUpdateReps).toHaveBeenCalledWith(0, 100);
    expect((repsInput as HTMLInputElement).value).toBe("100");
  });

  it("L13: disables all controls when disabled=true", () => {
    render(<TemplateExerciseItem {...defaultProps} index={1} disabled={true} />);

    expect(screen.getByRole("button", { name: "Move Barbell Bench Press up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Barbell Bench Press down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Barbell Bench Press" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease Barbell Bench Press sets" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase Barbell Bench Press sets" })).toBeDisabled();
  });

  it("passes axe accessibility rules", async () => {
    const { container } = render(<TemplateExerciseItem {...defaultProps} index={1} />);
    await expectNoA11yViolations(container);
  });
});
