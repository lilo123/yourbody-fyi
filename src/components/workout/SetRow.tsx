import React, { memo, useRef } from 'react';
import type { WorkoutSet } from '../../types/database';
import { Check } from 'lucide-react';
import { formatWeight, weightUnitLabel, toDisplayWeight, type WeightUnit } from '../../utils/weight';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { SET_GRID_TEMPLATE } from './setGrid';
import { PendingMark } from '../sync/PendingMark';

export interface SetRowProps {
  exName: string;
  exIndex: number;
  rowIdx: number;
  setIndex: number;
  loggedSet?: WorkoutSet;
  ghost: {
    weight: number | string;
    reps: number | string;
    hintText: string;
    isFromPrevious: boolean;
  };
  draftWeight: string;
  draftReps: string;
  targetRepCount?: number;
  isMutating: boolean;
  unit?: WeightUnit;
  onUpdateDraft: (exName: string, setIndex: number, field: 'weight' | 'reps', val: string) => void;
  onCommitSet: (exName: string, setIndex: number, ghost: any) => void;
  onEditSet?: (exIndex: number, rowIdx: number) => void;
}

export const SetRow: React.FC<SetRowProps> = memo((props) => {
  const {
    exName,
    exIndex,
    rowIdx,
    setIndex,
    loggedSet,
    ghost,
    draftWeight,
    draftReps,
    targetRepCount,
    isMutating,
    onUpdateDraft,
    onCommitSet,
    onEditSet,
  } = props;

  const hookUnit = useWeightUnit();
  const unit = props.unit ?? hookUnit;
  const repsInputRef = useRef<HTMLInputElement>(null);

  if (loggedSet) {
    const displayedIndex = loggedSet.set_index ?? setIndex;

    return (
      <button
        key={loggedSet.id || rowIdx}
        type="button"
        onClick={() => onEditSet?.(exIndex, rowIdx)}
        aria-label={`Edit set ${displayedIndex} of ${exName}`}
        data-testid={`logged-set-row-${exIndex}-${rowIdx}`}
        className={`w-full text-left grid ${SET_GRID_TEMPLATE} gap-1 py-0.5 px-1.5 rounded-xl items-center bg-cyan-500/10 border border-cyan-500/20 text-xs my-1 transition cursor-pointer min-h-[44px] hover:bg-cyan-500/15 focus:outline-none focus:ring-1 focus:ring-cyan-500/80 active:scale-[0.99] touch-manipulation select-none`}
      >
        <div className="font-bold text-cyan-400 text-center flex items-center justify-center relative">
          <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-xs flex items-center justify-center font-bold tabular-nums">
            {displayedIndex}
          </span>
          {Boolean((loggedSet as any)?.pending) && (
            <PendingMark className="absolute -top-0.5 -right-0.5" />
          )}
        </div>
        <div data-testid={`ghost-hint-${exIndex}-${rowIdx}`} className="text-zinc-400 text-center text-xs truncate tabular-nums">
          {ghost.hintText}
        </div>
        <div className="flex justify-center">
          {/* data-input-mirror: shows a logged value in the input column, sized like the 16px inputs (D43 exception). */}
          <div data-testid={`logged-weight-value-${exIndex}-${rowIdx}`} data-input-mirror="true" className="w-full max-w-[58px] h-11 rounded-lg bg-zinc-950/80 border border-zinc-700/60 flex items-center justify-center font-semibold text-white text-base tabular-nums">
            {formatWeight(loggedSet.weight, unit)}
          </div>
        </div>
        <div className="flex justify-center">
          <div data-testid={`logged-reps-value-${exIndex}-${rowIdx}`} data-input-mirror="true" className="w-full max-w-[52px] h-11 rounded-lg bg-zinc-950/80 border border-zinc-700/60 flex items-center justify-center font-semibold text-cyan-300 text-base tabular-nums">
            {loggedSet.reps}
          </div>
        </div>
        <div className="flex items-center justify-center">
          <div
            className="w-8 h-8 rounded-full bg-cyan-500 text-zinc-950 flex items-center justify-center shadow-[0_0_10px_rgba(6,182,212,0.4)]"
            aria-hidden="true"
          >
            <Check className="w-4 h-4 stroke-[3]" />
          </div>
        </div>
      </button>
    );
  }

  return (
    <div
      key={rowIdx}
      className={`grid ${SET_GRID_TEMPLATE} gap-1 py-0.5 px-1.5 rounded-xl items-center border border-transparent hover:bg-zinc-800/30 text-xs my-1 transition min-h-[44px]`}
    >
      <div className="font-bold text-zinc-400 text-center flex items-center justify-center">
        <span className="w-5 h-5 rounded-full bg-zinc-800 text-xs flex items-center justify-center font-bold text-zinc-400 tabular-nums">
          {setIndex}
        </span>
      </div>
      <div data-testid={`ghost-hint-${exIndex}-${rowIdx}`} className="text-zinc-400 text-center text-xs truncate tabular-nums">
        {ghost.hintText}
      </div>
      <div className="flex justify-center">
        <input
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          placeholder={typeof ghost.weight === 'number' ? toDisplayWeight(ghost.weight, unit).toString() : weightUnitLabel(unit)}
          value={draftWeight}
          onChange={(e) => onUpdateDraft(exName, setIndex, 'weight', e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              repsInputRef.current?.focus();
              repsInputRef.current?.select();
            }
          }}
          aria-label={`Set ${setIndex} weight`}
          className="h-11 w-full max-w-[58px] bg-zinc-800/80 border border-border-interactive rounded-lg text-center font-semibold text-white text-base focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none transition tabular-nums"
          data-testid={`ghost-weight-${exIndex}-${rowIdx}`}
        />
      </div>
      <div className="flex justify-center">
        <input
          ref={repsInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          enterKeyHint="done"
          placeholder={
            typeof ghost.reps === 'number'
              ? ghost.reps.toString()
              : targetRepCount
              ? `${targetRepCount}`
              : 'reps'
          }
          value={draftReps}
          onChange={(e) => onUpdateDraft(exName, setIndex, 'reps', e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitSet(exName, setIndex, ghost);
              focusNextPendingSet(exIndex, rowIdx);
            }
          }}
          aria-label={`Set ${setIndex} reps`}
          className="h-11 w-full max-w-[52px] bg-zinc-800/80 border border-border-interactive rounded-lg text-center font-semibold text-white text-base focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none transition tabular-nums"
          data-testid={`ghost-reps-${exIndex}-${rowIdx}`}
        />
      </div>
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => {
            onCommitSet(exName, setIndex, ghost);
            focusNextPendingSet(exIndex, rowIdx);
          }}
          disabled={isMutating}
          className="relative w-8 h-8 rounded-full border-2 border-border-interactive hover:border-cyan-400 hover:bg-cyan-500/10 text-transparent hover:text-cyan-400 flex items-center justify-center transition active:scale-95 disabled:opacity-50 touch-manipulation cursor-pointer before:absolute before:-inset-y-1.5 before:-left-1 before:-right-2 before:min-w-[44px] before:min-h-[44px] before:content-['']"
          title="Commit Set (One-tap)"
          aria-label={`Commit set ${setIndex} for ${exName}`}
          data-testid={`commit-set-btn-${exIndex}-${rowIdx}`}
        >
          <Check className="w-4 h-4 stroke-[2.5]" />
        </button>
      </div>
    </div>
  );
});

SetRow.displayName = 'SetRow';

export function focusNextPendingSet(exIndex: number, rowIdx: number) {
  if (typeof document === 'undefined') return;
  const doFocus = () => {
    // Do not steal focus into background cards if a modal, sheet, or dialog is active
    if (document.querySelector('[role="dialog"]')) return;

    // Look for next pending set in the same exercise: rowIdx + 1 (W34: restricted to active card)
    const nextWeightInput = document.querySelector<HTMLInputElement>(
      `input[data-testid="ghost-weight-${exIndex}-${rowIdx + 1}"]`
    );
    const nextRepsInput = document.querySelector<HTMLInputElement>(
      `input[data-testid="ghost-reps-${exIndex}-${rowIdx + 1}"]`
    );

    // Move focus: if weight is prefilled (has non-empty value), focus reps input, otherwise weight input
    if (nextWeightInput) {
      const isWeightPrefilled = Boolean(nextWeightInput.value && nextWeightInput.value.trim() !== '');
      if (isWeightPrefilled && nextRepsInput) {
        nextRepsInput.focus();
        nextRepsInput.select();
      } else {
        nextWeightInput.focus();
        nextWeightInput.select();
      }
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(doFocus);
  } else {
    setTimeout(doFocus, 0);
  }
}
