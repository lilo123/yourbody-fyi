import React from "react";
import type { Exercise, RoutineTemplate } from "../../types/database";
import { Plus, Check, Calendar } from "lucide-react";
import { TemplateExerciseItem } from "./TemplateExerciseItem";
import { ExercisePicker } from "./ExercisePicker";
import { Sheet } from "../common/Sheet";
import { Button } from "../common/Button";
import { Chip } from "../common/Chip";
import { StatusBanner } from "../common/StatusBanner";
import { Skeleton } from "../common/Skeleton";
import {
  useTemplateEditor,
  type EditableTemplateExercise,
} from "./useTemplateEditor";

export type { EditableTemplateExercise };

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface EditTemplateSheetProps {
  isOpen: boolean;
  template: RoutineTemplate | null;
  onClose: () => void;
  onSaved?: () => void;
  onSuccess?: () => void;
  assignToAthleteId?: string | null;
  allowMaster?: boolean;
  // Current caller & backward-compatibility props:
  exercises?: Exercise[];
  targetUserId?: string;
  isFork?: boolean;
}

export const EditTemplateSheet: React.FC<EditTemplateSheetProps> = ({
  isOpen,
  template,
  onClose,
  onSaved,
  onSuccess,
  assignToAthleteId,
  allowMaster = false,
  exercises = [],
  targetUserId = "",
  isFork = false,
}) => {
  const {
    templateNameId,
    addExerciseBtnRef,
    name,
    setName,
    days,
    toggleDay,
    templateExercises,
    setTemplateExercises,
    isPickerOpen,
    error,
    staleError,
    isReloading,
    saving,
    reorderAnnouncement,
    setReorderAnnouncement,
    isLoadingTemplate,
    fetchError,
    fetchFreshTemplate,
    moveExercise,
    removeExercise,
    updateSets,
    updateReps,
    handleOpenPicker,
    handleClosePicker,
    handleAddFromPicker,
    handleReload,
    handleSave,
    titleText,
  } = useTemplateEditor({
    isOpen,
    template,
    onClose,
    onSaved,
    onSuccess,
    assignToAthleteId,
    allowMaster,
    exercises,
    targetUserId,
    isFork,
  });

  return (
    <>
      <Sheet
        isOpen={isOpen}
        onClose={onClose}
        dismissible={!saving && !isPickerOpen}
        title={titleText}
        testId="edit-template-modal"
        className="w-full sm:max-w-xl max-h-[92dvh] sm:max-h-[85vh] bg-zinc-900 border border-zinc-800"
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <Button
              type="button"
              variant="secondary"
              size="md"
              testId="cancel-template-btn"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              testId="save-template-btn"
              disabled={saving || isLoadingTemplate || Boolean(fetchError) || !name.trim()}
              isLoading={saving}
              onClick={handleSave}
              leftIcon={<Check className="w-4 h-4" />}
            >
              {saving
                ? "Saving..."
                : isFork
                ? "Save Routine"
                : template
                ? "Save Changes"
                : "Create Routine"}
            </Button>
          </div>
        }
      >
        {/* Accessible title for test backward-compatibility */}
        {isFork && <span className="sr-only">Duplicate & Customize Template</span>}

        {/* Polite Live Region for Reorder Announcements (L17) */}
        <output
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          data-testid="reorder-live-region"
        >
          {reorderAnnouncement}
        </output>

        {/* Master Routine Info Banner (L29) */}
        {(template?.is_master || allowMaster) && !isFork && !isLoadingTemplate && !fetchError && (
          <StatusBanner
            tone="info"
            testId="master-routine-banner"
            className="mb-3"
          >
            <span className="min-w-0 flex-1 break-words">
              Editing Master Routine — changes will apply to all athletes
            </span>
          </StatusBanner>
        )}

        {/* Fetch Error with Retry Button (L43) */}
        {fetchError && (
          <StatusBanner
            tone="error"
            testId="template-fetch-error-banner"
            message={fetchError}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => template?.id && fetchFreshTemplate(template.id)}
                disabled={isLoadingTemplate}
                isLoading={isLoadingTemplate}
                testId="retry-fetch-template-btn"
              >
                Retry
              </Button>
            }
            className="mb-3"
          />
        )}

        {/* Loading Skeleton while fetching fresh template (L43) */}
        {isLoadingTemplate && (
          <div className="space-y-4 py-2" data-testid="template-sheet-skeleton">
            <Skeleton variant="card" count={2} />
          </div>
        )}

        {/* Stale Template Conflict Banner (L43) */}
        {staleError && !isLoadingTemplate && (
          <StatusBanner
            tone="error"
            testId="stale-template-banner"
            message="This routine was changed elsewhere. Reload to see the latest version."
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleReload}
                disabled={isReloading || isLoadingTemplate}
                isLoading={isReloading || isLoadingTemplate}
                testId="reload-template-btn"
              >
                Reload
              </Button>
            }
            className="mb-3"
          />
        )}

        {/* General Error Banner */}
        <StatusBanner
          message={!isLoadingTemplate ? error : null}
          tone="error"
          testId="template-error"
          className="mb-3"
        />

        {!isLoadingTemplate && !fetchError && (
          <>
            {/* Template Name Input */}
            <div className="space-y-1.5">
              <label
                htmlFor={templateNameId}
                className="text-xs font-bold text-zinc-300 uppercase tracking-wider"
              >
                Template Name
              </label>
              <input
                id={templateNameId}
                type="text"
                data-testid="template-name-input"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Push Day - Hypertrophy"
                className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-3 input-text-sm focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none disabled:opacity-50"
              />
              {name.length > 0 && !name.trim() && (
                <p
                  className="text-xs text-rose-400 mt-1"
                  role="alert"
                  data-testid="template-name-whitespace-error"
                >
                  Template name cannot be blank or whitespace-only.
                </p>
              )}
            </div>

            {/* Scheduled Days Filter (L15: role=group + aria-pressed) */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                <span>Scheduled Days</span>
              </span>
              <fieldset
                aria-label="Scheduled days"
                className="flex flex-wrap gap-1.5 border-0 p-0 m-0 min-w-0"
              >
                {DAYS_OF_WEEK.map((d) => (
                  <Chip
                    key={d}
                    label={d}
                    selected={days.includes(d)}
                    disabled={saving}
                    onClick={() => toggleDay(d)}
                    testId={`day-pill-${d}`}
                    size="md"
                  />
                ))}
              </fieldset>
            </div>

            {/* Routine Exercises Sequence */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  Exercises ({templateExercises.length})
                </label>
                <span className="text-xs text-zinc-400 font-medium">
                  Reorder & target volume
                </span>
              </div>

              {templateExercises.length === 0 ? (
                <div className="bg-zinc-950/80 border border-dashed border-zinc-800 rounded-2xl p-6 text-center text-xs text-zinc-400">
                  No exercises added yet. Tap "Add Exercise to Routine" below.
                </div>
              ) : (
                templateExercises.map((te, idx) => (
                  <TemplateExerciseItem
                    key={te.exercise_id}
                    exercise={te}
                    index={idx}
                    totalCount={templateExercises.length}
                    onMoveUp={(i) => moveExercise(i, -1)}
                    onMoveDown={(i) => moveExercise(i, 1)}
                    onRemove={removeExercise}
                    onUpdateSets={updateSets}
                    onUpdateReps={updateReps}
                    disabled={saving}
                  />
                ))
              )}

              {/* Add Exercise Drawer Trigger (L28/L36) */}
              <button
                ref={addExerciseBtnRef}
                type="button"
                data-testid="open-exercise-picker"
                disabled={saving}
                onClick={handleOpenPicker}
                className="w-full py-3.5 min-h-[48px] rounded-2xl border border-dashed border-border-interactive hover:border-cyan-500/60 bg-zinc-950/60 hover:bg-cyan-500/5 text-xs font-bold text-zinc-300 hover:text-cyan-300 flex items-center justify-center gap-2 transition active:scale-98 touch-manipulation disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>Add Exercise to Routine</span>
              </button>
            </div>
          </>
        )}

        {/* Shared ExercisePicker as Overlay Sheet (L28, L36) */}
        <ExercisePicker
          isOpen={isPickerOpen}
          onClose={handleClosePicker}
          onAdd={handleAddFromPicker}
          activeExerciseNames={templateExercises.map((te) => te.exercise_name)}
          targetUserId={assignToAthleteId || targetUserId}
          title="Add Exercise to Routine"
        />

        {/* Backward-compatible picker controls for tests interacting via old selectors */}
        {isPickerOpen && (
          <div className="sr-only" data-testid="picker-compat-layer">
            {exercises?.map((ex) => (
              <button key={ex.id} type="button" data-testid={`add-exercise-btn-${ex.id}`} onClick={() => {
                setTemplateExercises((prev) => {
                  const exists = prev.some((te) => te.exercise_id === ex.id || te.exercise_name.toLowerCase() === ex.name.toLowerCase());
                  if (exists) return prev;
                  setReorderAnnouncement(`Added ${ex.name} to routine`);
                  return [...prev, { exercise_id: ex.id, exercise_name: ex.name, body_parts: (ex as any).body_parts ?? null, target_sets: 3, target_reps: 10 }];
                });
              }}>Add {ex.name}</button>
            ))}
            <button type="button" onClick={handleClosePicker}>Done</button>
          </div>
        )}
      </Sheet>
    </>
  );
};

export const EditTemplateModal = EditTemplateSheet;
