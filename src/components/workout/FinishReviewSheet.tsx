import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Sheet } from '../common/Sheet';
import { Button } from '../common/Button';
import { IconButton } from '../common/IconButton';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import {
  toDisplayWeight,
  resolveWeightInput,
  weightUnitLabel,
  type WeightUnit,
} from '../../utils/weight';

export interface PendingReviewSet {
  exerciseName: string;
  weight: number;
  reps: number;
  setIndex: number;
  exerciseId?: string;
}

export interface FinishReviewSheetProps {
  isOpen: boolean;
  onClose: () => void;
  pendingSets: PendingReviewSet[];
  onConfirmFinishWithSets: (reviewedSets: PendingReviewSet[]) => void;
  onFinishWithoutSets: () => void;
  isSubmitting?: boolean;
  unit?: WeightUnit;
}

interface ReviewRow {
  exerciseName: string;
  weightDraft: string;
  originalLb: number;
  repsDraft: string;
  setIndex: number;
  exerciseId?: string;
}

const createRowsFromPending = (items: PendingReviewSet[], u: WeightUnit): ReviewRow[] =>
  items.map((s) => ({
    exerciseName: s.exerciseName,
    weightDraft: s.weight === 0 ? '0' : s.weight != null ? String(toDisplayWeight(s.weight, u)) : '',
    originalLb: s.weight,
    repsDraft: s.reps != null ? String(s.reps) : '',
    setIndex: s.setIndex,
    exerciseId: s.exerciseId,
  }));

export const FinishReviewSheet: React.FC<FinishReviewSheetProps> = ({
  isOpen,
  onClose,
  pendingSets,
  onConfirmFinishWithSets,
  onFinishWithoutSets,
  isSubmitting = false,
  unit: propUnit,
}) => {
  const contextUnit = useWeightUnit();
  const unit = propUnit ?? contextUnit;

  const [rows, setRows] = useState<ReviewRow[]>(() => createRowsFromPending(pendingSets, unit));
  const [prevPendingSets, setPrevPendingSets] = useState(pendingSets);
  const [prevUnit, setPrevUnit] = useState(unit);

  if (pendingSets !== prevPendingSets || unit !== prevUnit) {
    setPrevPendingSets(pendingSets);
    setPrevUnit(unit);
    setRows(createRowsFromPending(pendingSets, unit));
  }

  const handleUpdateWeight = (index: number, val: string) => {
    const sanitized = val.replace(',', '.');
    if (sanitized !== '' && !/^\d*\.?\d*$/.test(sanitized)) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], weightDraft: sanitized };
      return next;
    });
  };

  const handleUpdateReps = (index: number, val: string) => {
    if (val !== '' && !/^\d*$/.test(val)) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], repsDraft: val };
      return next;
    });
  };

  const handleRemoveSet = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const resolvedSets = rows.map((r) => {
    const resolvedWeight = resolveWeightInput(r.weightDraft, unit, r.originalLb);
    const parsedReps = r.repsDraft === '' ? NaN : parseInt(r.repsDraft, 10);
    return {
      exerciseName: r.exerciseName,
      weight: resolvedWeight,
      reps: parsedReps,
      setIndex: r.setIndex,
      exerciseId: r.exerciseId,
    };
  });

  const hasInvalidSets = resolvedSets.some(
    (s) =>
      s.weight === null ||
      !Number.isFinite(s.weight) ||
      s.weight < 0 ||
      !Number.isFinite(s.reps) ||
      s.reps <= 0
  );

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title="Review Pending Sets"
      testId="finish-review-sheet"
      className="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {rows.length > 0
              ? `Review the ${rows.length} pending set(s) to be logged from drafts or previous session values.`
              : 'All pending sets removed. You can finish the workout now.'}
          </p>
        </div>

        {rows.length > 0 ? (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {rows.map((r, idx) => (
              <div
                key={`${r.exerciseName}_${r.setIndex}_${idx}`}
                data-testid={`finish-review-row-${idx}`}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-800/40 border border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white truncate">
                    {r.exerciseName}
                  </div>
                  <div className="text-xs text-zinc-400">
                    Set {r.setIndex}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-center">
                    <label
                      htmlFor={`finish-weight-${idx}`}
                      className="text-xs text-zinc-400 mb-0.5"
                    >
                      Weight ({weightUnitLabel(unit)})
                    </label>
                    <input
                      id={`finish-weight-${idx}`}
                      type="text"
                      inputMode="decimal"
                      value={r.weightDraft}
                      onChange={(e) => handleUpdateWeight(idx, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      aria-label={`${r.exerciseName} set ${r.setIndex} weight`}
                      data-testid={`finish-review-weight-${idx}`}
                      className="w-16 h-10 bg-zinc-950 border border-zinc-700 rounded-lg text-center font-semibold text-white text-base focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none tabular-nums"
                    />
                  </div>

                  <div className="flex flex-col items-center">
                    <label
                      htmlFor={`finish-reps-${idx}`}
                      className="text-xs text-zinc-400 mb-0.5"
                    >
                      Reps
                    </label>
                    <input
                      id={`finish-reps-${idx}`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={r.repsDraft}
                      onChange={(e) => handleUpdateReps(idx, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      aria-label={`${r.exerciseName} set ${r.setIndex} reps`}
                      data-testid={`finish-review-reps-${idx}`}
                      className="w-14 h-10 bg-zinc-950 border border-zinc-700 rounded-lg text-center font-semibold text-white text-base focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none tabular-nums"
                    />
                  </div>

                  <div className="pt-4">
                    <IconButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveSet(idx)}
                      aria-label={`Remove ${r.exerciseName} set ${r.setIndex}`}
                      testId={`finish-review-remove-${idx}`}
                      icon={<Trash2 className="w-4 h-4 text-zinc-400 hover:text-rose-400 transition" />}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-2 pt-2 border-t border-zinc-800/80">
          {hasInvalidSets && (
            <p className="text-xs text-rose-400 font-semibold" role="alert">
              Each set must have valid reps (&gt; 0) and weight (&ge; 0).
            </p>
          )}
          {rows.length > 0 && (
            <Button
              type="button"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
              disabled={isSubmitting || hasInvalidSets}
              onClick={() => onConfirmFinishWithSets(resolvedSets as PendingReviewSet[])}
              testId="log-reviewed-sets-btn"
              className="w-full min-h-[44px]"
            >
              Log {rows.length} set{rows.length === 1 ? '' : 's'} &amp; finish
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={isSubmitting}
            onClick={onFinishWithoutSets}
            testId="finish-without-sets-btn"
            className="w-full min-h-[44px]"
          >
            Finish without them
          </Button>
        </div>
      </div>
    </Sheet>
  );
};
