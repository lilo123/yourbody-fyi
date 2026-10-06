import React, { memo } from 'react';
import type { WorkoutSet } from '../../types/database';
import { ChevronDown, Trophy, Check, ArrowUp, ArrowDown, Trash2, AlertCircle, RotateCcw } from 'lucide-react';
import { SetRow } from './SetRow';
import { SET_GRID_TEMPLATE } from './setGrid';
import { PendingMark } from '../sync/PendingMark';
import { Card } from '../common/Card';
import { Chip } from '../common/Chip';
import { formatSet, weightUnitLabel, toDisplayWeight } from '../../utils/weight';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { usePrMode } from '../../hooks/usePrMode';
import { e1rm } from '../../lib/prComparator';
import { formatWeight } from '../../utils/weight';

export interface ExerciseCardProps {
  exName: string;
  exIndex: number;
  activeExercisesLength: number;
  setsToday: WorkoutSet[];
  benchmarks: any;
  targetCount: number;
  targetRepCount?: number;
  ghostValues: any[];
  isExpanded: boolean;
  inputDrafts: Record<string, { weight?: string; reps?: string }>;
  isMutating: boolean;
  isBatchPending: boolean;
  error?: { message: string; onRetry?: () => void } | null;
  onDismissError?: (exName: string) => void;
  onToggleAccordion: (exName: string) => void;
  onAdjustTargetSets: (exName: string, delta: number) => void;
  onMoveExercise: (index: number, direction: number) => void;
  onRemoveExercise: (index: number) => void;
  onUpdateDraft: (exName: string, setIndex: number, field: 'weight' | 'reps', val: string) => void;
  onCommitSet: (exName: string, setIndex: number, ghost: any) => void;
  onEditSet?: (exIndex: number, rowIdx: number) => void;
  onBatchLogExercise: (exName: string, targetCount: number, ghostValues: any[], setsToday: WorkoutSet[]) => void;
}

function areBenchmarksEqual(prev: any, next: any): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  const prevLast = prev.lastSession;
  const nextLast = next.lastSession;
  if (prevLast !== nextLast) {
    if (!prevLast || !nextLast) return false;
    if (prevLast.date !== nextLast.date || prevLast.summaryText !== nextLast.summaryText) {
      return false;
    }
  }

  const prevPr = prev.pr;
  const nextPr = next.pr;
  if (prevPr !== nextPr) {
    if (!prevPr || !nextPr) return false;
    if (
      prevPr.weight !== nextPr.weight ||
      prevPr.reps !== nextPr.reps ||
      prevPr.date !== nextPr.date || (prevPr as any).e1rm !== (nextPr as any).e1rm
    ) {
      return false;
    }
  }

  return true;
}

function areGhostValuesEqual(prev: any[], next: any[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const n = next[i];
    if (
      p.weight !== n.weight ||
      p.reps !== n.reps ||
      p.hintText !== n.hintText ||
      p.isFromPrevious !== n.isFromPrevious
    ) {
      return false;
    }
  }
  return true;
}

function areExerciseCardPropsEqual(prev: ExerciseCardProps, next: ExerciseCardProps): boolean {
  if (
    prev.exName !== next.exName ||
    prev.exIndex !== next.exIndex ||
    prev.activeExercisesLength !== next.activeExercisesLength ||
    prev.targetCount !== next.targetCount ||
    prev.targetRepCount !== next.targetRepCount ||
    prev.isExpanded !== next.isExpanded ||
    prev.isMutating !== next.isMutating ||
    prev.isBatchPending !== next.isBatchPending ||
    prev.error?.message !== next.error?.message ||
    prev.onDismissError !== next.onDismissError ||
    prev.onToggleAccordion !== next.onToggleAccordion ||
    prev.onAdjustTargetSets !== next.onAdjustTargetSets ||
    prev.onMoveExercise !== next.onMoveExercise ||
    prev.onRemoveExercise !== next.onRemoveExercise ||
    prev.onUpdateDraft !== next.onUpdateDraft ||
    prev.onCommitSet !== next.onCommitSet ||
    prev.onEditSet !== next.onEditSet ||
    prev.onBatchLogExercise !== next.onBatchLogExercise
  ) {
    return false;
  }

  if (prev.setsToday.length !== next.setsToday.length) return false;
  for (let i = 0; i < prev.setsToday.length; i++) {
    if (
      prev.setsToday[i].id !== next.setsToday[i].id ||
      prev.setsToday[i].weight !== next.setsToday[i].weight ||
      prev.setsToday[i].reps !== next.setsToday[i].reps ||
      prev.setsToday[i].set_index !== next.setsToday[i].set_index ||
      (prev.setsToday[i] as any).pending !== (next.setsToday[i] as any).pending
    ) {
      return false;
    }
  }

  if (!areBenchmarksEqual(prev.benchmarks, next.benchmarks)) return false;
  if (!areGhostValuesEqual(prev.ghostValues, next.ghostValues)) return false;

  const totalRows = Math.max(next.targetCount, next.setsToday.length);
  for (let rowIdx = 0; rowIdx < totalRows; rowIdx++) {
    const setIndex = rowIdx + 1;
    const key = `${next.exName}_${setIndex}`;
    const prevDraft = prev.inputDrafts[key];
    const nextDraft = next.inputDrafts[key];
    if (prevDraft?.weight !== nextDraft?.weight || prevDraft?.reps !== nextDraft?.reps) {
      return false;
    }
  }

  return true;
}

export const ExerciseCard: React.FC<ExerciseCardProps> = memo((props) => {
  const {
    exName,
    exIndex,
    activeExercisesLength,
    setsToday,
    benchmarks,
    targetCount,
    targetRepCount,
    ghostValues,
    isExpanded,
    inputDrafts,
    isMutating,
    isBatchPending,
    error,
    onDismissError,
    onToggleAccordion,
    onAdjustTargetSets,
    onMoveExercise,
    onRemoveExercise,
    onUpdateDraft,
    onCommitSet,
    onEditSet,
    onBatchLogExercise,
  } = props;

  const unit = useWeightUnit();
  const { mode: prMode } = usePrMode();
  const isCompleted = setsToday.length >= targetCount;
  const unloggedCount = Math.max(0, targetCount - setsToday.length);
  const totalRows = Math.max(targetCount, setsToday.length);

  return (
    <Card testId={`exercise-card-${exIndex}`} className="space-y-2.5">
      {/* LINE 1: Header Accordion Button */}
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={`exercise-card-body-${exIndex}`}
        onClick={() => onToggleAccordion(exName)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleAccordion(exName);
          }
        }}
        className="w-full flex items-center justify-between cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 rounded-xl touch-manipulation text-left relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:min-w-[44px] before:min-h-[44px] before:content-['']"
        aria-label={`${exName}, ${isExpanded ? 'collapse' : 'expand'} exercise`}
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span data-testid={`exercise-index-${exIndex}`} className="w-6 h-6 rounded-lg bg-zinc-800 border border-zinc-700/80 flex items-center justify-center font-bold text-cyan-400 text-xs shrink-0 tabular-nums">
            {exIndex + 1}
          </span>
          <span data-testid="exercise-title" className="text-white font-bold text-sm tracking-tight leading-snug break-words">
            {exName}
          </span>
          {setsToday.some((s: any) => s.pending) && (
            <PendingMark size="sm" className="shrink-0" />
          )}
        </div>

        <div className="w-8 h-8 rounded-lg text-zinc-400 flex items-center justify-center shrink-0">
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isExpanded ? 'rotate-180 text-cyan-400' : ''
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* LINE 2: Chip Row */}
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        {benchmarks.lastSession ? (
          <Chip
            size="sm"
            variant="metric"
            label={`Last: ${benchmarks.lastSession.summaryText}`}
            className="max-w-[110px] truncate text-zinc-300 font-semibold tabular-nums"
            testId={`last-chip-${exIndex}`}
          />
        ) : (
          <span className="text-xs text-zinc-400 font-normal shrink-0">No prior session</span>
        )}

        {benchmarks.pr && (() => {
          const prE1rm =
            (benchmarks.pr as any)?.e1rm ??
            (benchmarks.pr.weight > 0 && benchmarks.pr.reps <= 12
              ? e1rm(benchmarks.pr.weight, benchmarks.pr.reps)
              : null);
          const e1rmSuffix =
            prMode === 'e1rm' && prE1rm != null && prE1rm > 0
              ? ` · e1RM ${formatWeight(prE1rm, unit, { showUnit: true })}`
              : '';
          return (
            <Chip
              size="sm"
              variant="default"
              icon={<Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
              label={`PR: ${formatSet(benchmarks.pr.weight, benchmarks.pr.reps, unit)}${e1rmSuffix}`}
              className="bg-amber-500/10 border-amber-500/30 text-amber-400 font-semibold tabular-nums shrink-0"
              testId={`pr-chip-${exIndex}`}
            />
          );
        })()}

        {isCompleted ? (
          <Chip
            size="sm"
            variant="default"
            icon={<Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 stroke-[2.5]" />}
            label={`${setsToday.length}/${targetCount} Sets`}
            className="bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-semibold tabular-nums shadow-[0_0_10px_rgba(16,185,129,0.15)] shrink-0"
            testId={`sets-completed-chip-${exIndex}`}
          />
        ) : setsToday.length > 0 ? (
          <Chip
            size="sm"
            variant="default"
            label={`${setsToday.length}/${targetCount} Sets`}
            className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30 font-semibold tabular-nums shrink-0"
            testId={`sets-progress-chip-${exIndex}`}
          />
        ) : (
          <Chip
            size="sm"
            variant="default"
            label={`0/${targetCount} Sets`}
            className="bg-zinc-800 border-zinc-700/80 text-zinc-400 font-semibold tabular-nums shrink-0"
            testId={`sets-zero-chip-${exIndex}`}
          />
        )}
      </div>

      {/* LINE 3: Control Row (STD INT 9) */}
      <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-zinc-800/60">
        {/* Stepper for target sets */}
        <div className="flex items-center bg-zinc-800/90 border border-zinc-700/70 rounded-xl h-11 px-0.5 text-xs">
          <button
            type="button"
            onClick={() => onAdjustTargetSets(exName, -1)}
            disabled={targetCount <= Math.max(1, setsToday.length)}
            className="relative h-11 w-11 flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-300 font-bold touch-manipulation cursor-pointer select-none text-xs"
            title="Decrease target sets"
            aria-label={`Decrease target sets for ${exName}`}
          >
            −
          </button>
          <span className="font-bold text-white px-1 text-xs tabular-nums select-none">
            {targetCount}
          </span>
          <button
            type="button"
            onClick={() => onAdjustTargetSets(exName, 1)}
            className="relative h-11 w-11 flex items-center justify-center text-zinc-300 hover:text-white font-bold touch-manipulation cursor-pointer select-none text-xs"
            title="Increase target sets"
            aria-label={`Increase target sets for ${exName}`}
          >
            +
          </button>
        </div>

        {/* Quick actions: Reorder + Remove */}
        <div className="flex items-center gap-1.5 shrink-0">
          {exIndex > 0 && (
            <button
              type="button"
              onClick={() => onMoveExercise(exIndex, -1)}
              className="relative h-11 w-11 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-border-interactive flex items-center justify-center text-zinc-300 hover:text-cyan-400 transition touch-manipulation cursor-pointer"
              title="Move up"
              aria-label={`Move ${exName} up`}
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}

          {exIndex < activeExercisesLength - 1 && (
            <button
              type="button"
              onClick={() => onMoveExercise(exIndex, 1)}
              className="relative h-11 w-11 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-border-interactive flex items-center justify-center text-zinc-300 hover:text-cyan-400 transition touch-manipulation cursor-pointer"
              title="Move down"
              aria-label={`Move ${exName} down`}
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onRemoveExercise(exIndex)}
            className="relative h-11 w-11 rounded-xl bg-zinc-800/80 hover:bg-rose-500/20 border border-border-interactive flex items-center justify-center text-zinc-400 hover:text-rose-400 transition touch-manipulation cursor-pointer"
            title="Remove from workout"
            aria-label={`Remove ${exName} from workout`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Accordion Body: Sets & Ghost Placeholders */}
      {isExpanded && (
        <div id={`exercise-card-body-${exIndex}`} className="pt-1 space-y-1">
          {/* 5-Column Table Header */}
          <div className={`grid ${SET_GRID_TEMPLATE} gap-1 text-xs font-bold uppercase tracking-wider text-zinc-400 px-1.5 pb-1 text-center items-center`}>
            <div>Set</div>
            <div>Previous</div>
            <div>
              <span className="sr-only">Weight</span>
              <span aria-hidden="true">{weightUnitLabel(unit).toUpperCase()}</span>
            </div>
            <div>Reps</div>
            <div className="flex items-center justify-center">
              <span className="sr-only">Action</span>
              <span aria-hidden="true">Log</span>
            </div>
          </div>

          {Array.from({ length: totalRows }, (_, rowIdx) => {
            const setIndex = rowIdx + 1;
            const loggedSet = setsToday[rowIdx];
            const ghost = ghostValues[rowIdx] || {
              weight: '',
              reps: '',
              hintText: '—',
              isFromPrevious: false,
            };

            const draftKey = `${exName}_${setIndex}`;
            const draft = inputDrafts[draftKey];
            const ghostWeightStr = typeof ghost.weight === 'number'
              ? String(toDisplayWeight(ghost.weight, unit))
              : '';
            const draftWeight = draft?.weight !== undefined ? draft.weight : ghostWeightStr;
            const draftReps = draft?.reps !== undefined ? draft.reps : ghost.reps.toString();

            return (
              <SetRow
                key={loggedSet?.id || rowIdx}
                exName={exName}
                exIndex={exIndex}
                rowIdx={rowIdx}
                setIndex={setIndex}
                loggedSet={loggedSet}
                ghost={ghost}
                draftWeight={draftWeight}
                draftReps={draftReps}
                targetRepCount={targetRepCount}
                isMutating={isMutating}
                unit={unit}
                onUpdateDraft={onUpdateDraft}
                onCommitSet={onCommitSet}
                onEditSet={onEditSet}
              />
            );
          })}

          {error && (
            <div
              role="alert"
              data-testid={`exercise-card-error-${exIndex}`}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs my-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
                <span className="break-words">
                  <span className="font-bold text-rose-200">{exName}: </span>
                  {error.message}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {error.onRetry && (
                  <button
                    type="button"
                    onClick={error.onRetry}
                    data-testid={`retry-exercise-btn-${exIndex}`}
                    className="flex items-center gap-1 px-3 py-1.5 min-h-[44px] min-w-[44px] text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                )}
                {onDismissError && (
                  <button
                    type="button"
                    onClick={() => onDismissError(exName)}
                    aria-label={`Dismiss error for ${exName}`}
                    data-testid={`dismiss-exercise-error-btn-${exIndex}`}
                    className="flex items-center justify-center min-h-[44px] min-w-[44px] text-rose-400 hover:text-white transition touch-manipulation cursor-pointer text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          {!isCompleted && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => onBatchLogExercise(exName, targetCount, ghostValues, setsToday)}
                disabled={isBatchPending}
                className="min-h-[44px] px-3.5 text-xs font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-xl transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 touch-manipulation cursor-pointer"
                data-testid={`batch-log-exercise-btn-${exIndex}`}
              >
                <Check className="w-4 h-4 text-cyan-400 stroke-[2.5]" />
                <span>Log All ({unloggedCount})</span>
              </button>
            </div>
          )}
        </div>
      )}

      {!isExpanded && error && (
        <div
          role="alert"
          data-testid={`exercise-card-error-${exIndex}`}
          className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs my-1"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span className="break-words">
              <span className="font-bold text-rose-200">{exName}: </span>
              {error.message}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {error.onRetry && (
              <button
                type="button"
                onClick={error.onRetry}
                data-testid={`retry-exercise-btn-${exIndex}`}
                className="flex items-center gap-1 px-3 py-1.5 min-h-[44px] min-w-[44px] text-xs font-bold text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 border border-rose-500/40 rounded-xl transition touch-manipulation cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            )}
            {onDismissError && (
              <button
                type="button"
                onClick={() => onDismissError(exName)}
                aria-label={`Dismiss error for ${exName}`}
                data-testid={`dismiss-exercise-error-btn-${exIndex}`}
                className="flex items-center justify-center min-h-[44px] min-w-[44px] text-rose-400 hover:text-white transition touch-manipulation cursor-pointer text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}, areExerciseCardPropsEqual);

ExerciseCard.displayName = 'ExerciseCard';
