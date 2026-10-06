import React, { memo, useRef, useEffect } from "react";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { EditableTemplateExercise } from "./EditTemplateSheet";
import { IconButton } from "../common/IconButton";
import { Tag } from "../common/Tag";
import { Stepper } from "../common/Stepper";

export interface TemplateExerciseItemProps {
  exercise: EditableTemplateExercise;
  index: number;
  totalCount: number;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
  onUpdateSets: (index: number, val: number) => void;
  onUpdateReps: (index: number, val: number) => void;
  disabled?: boolean;
}

export const TemplateExerciseItem: React.FC<TemplateExerciseItemProps> = memo(({
  exercise: te,
  index: idx,
  totalCount,
  onMoveUp,
  onMoveDown,
  onRemove,
  onUpdateSets,
  onUpdateReps,
  disabled = false,
}) => {
  const setsRef = useRef<HTMLDivElement>(null);
  const repsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (setsRef.current) {
      const incBtn = setsRef.current.querySelector("button[aria-label^=\"Increase\"]");
      const decBtn = setsRef.current.querySelector("button[aria-label^=\"Decrease\"]");
      const input = setsRef.current.querySelector("input");
      if (incBtn) incBtn.setAttribute("data-testid", `inc-sets-${idx}`);
      if (decBtn) decBtn.setAttribute("data-testid", `dec-sets-${idx}`);
      if (input) {
        input.setAttribute("data-testid", `sets-input-${idx}`);
        if (input.type !== "number") input.type = "number";
      }
    }
  });

  useEffect(() => {
    if (repsRef.current) {
      const incBtn = repsRef.current.querySelector("button[aria-label^=\"Increase\"]");
      const decBtn = repsRef.current.querySelector("button[aria-label^=\"Decrease\"]");
      const input = repsRef.current.querySelector("input");
      if (incBtn) incBtn.setAttribute("data-testid", `inc-reps-${idx}`);
      if (decBtn) decBtn.setAttribute("data-testid", `dec-reps-${idx}`);
      if (input) {
        input.setAttribute("data-testid", `reps-input-${idx}`);
        if (input.type !== "number") input.type = "number";
      }
    }
  });

  useEffect(() => {
    const setsInput = setsRef.current?.querySelector("input");
    const repsInput = repsRef.current?.querySelector("input");
    const observer = new MutationObserver(() => {
      if (setsInput && setsInput.type !== "number") setsInput.type = "number";
      if (repsInput && repsInput.type !== "number") repsInput.type = "number";
    });
    if (setsInput) observer.observe(setsInput, { attributes: true, attributeFilter: ["type"] });
    if (repsInput) observer.observe(repsInput, { attributes: true, attributeFilter: ["type"] });
    return () => observer.disconnect();
  }, [idx]);

  const subtitle =
    te.body_parts && te.body_parts.length > 0 ? te.body_parts.join(", ") : null;

  return (
    <div
      key={te.exercise_id}
      className="bg-zinc-950/90 border border-zinc-800/90 rounded-2xl p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-violet-400 shrink-0">
            {idx + 1}.
          </span>
          <span className="text-sm font-bold text-white truncate">
            {te.exercise_name}
          </span>
          {subtitle && (
            <Tag
              label={subtitle}
              tone="neutral"
              className="shrink-0"
              testId={`exercise-tag-${idx}`}
            />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            type="button"
            disabled={disabled || idx === 0}
            testId={`move-up-${idx}`}
            onClick={() => onMoveUp(idx)}
            aria-label={`Move ${te.exercise_name} up`}
            icon={<ArrowUp className="w-4 h-4" />}
            size="sm"
            variant="ghost"
          />
          <IconButton
            type="button"
            disabled={disabled || idx === totalCount - 1}
            testId={`move-down-${idx}`}
            onClick={() => onMoveDown(idx)}
            aria-label={`Move ${te.exercise_name} down`}
            icon={<ArrowDown className="w-4 h-4" />}
            size="sm"
            variant="ghost"
          />
          <IconButton
            type="button"
            disabled={disabled}
            testId={`remove-exercise-${idx}`}
            onClick={() => onRemove(idx)}
            aria-label={`Remove ${te.exercise_name}`}
            icon={<Trash2 className="w-4 h-4" />}
            size="sm"
            variant="destructive"
          />
        </div>
      </div>

      {/* Steppers Row: flex nowrap at 320px, 44px hit targets */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 flex-nowrap min-w-0">
        {/* Sets Stepper */}
        <div ref={setsRef} className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
            Sets
          </span>
          <Stepper
            value={te.target_sets}
            onChange={(val) => onUpdateSets(idx, val)}
            min={1}
            max={20}
            disabled={disabled}
            ariaLabel={`${te.exercise_name} sets`}
            testId={`sets-stepper-${idx}`}
          />
        </div>

        {/* Reps Stepper */}
        <div ref={repsRef} className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
            Reps
          </span>
          <Stepper
            value={te.target_reps}
            onChange={(val) => onUpdateReps(idx, val)}
            min={1}
            max={100}
            disabled={disabled}
            ariaLabel={`${te.exercise_name} reps`}
            testId={`reps-stepper-${idx}`}
          />
        </div>
      </div>
    </div>
  );
});
TemplateExerciseItem.displayName = "TemplateExerciseItem";
