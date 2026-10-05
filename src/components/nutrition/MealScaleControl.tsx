import React, { useEffect, useRef, useState } from 'react';
import { formatMealScale, parseMealScaleInput } from './nutritionEngineHelpers';

export interface MealScaleControlProps {
  /** Current whole-meal scale (1 = as staged / as opened). */
  scale: number;
  /** Called with a new, valid factor. Not called for invalid or unchanged input. */
  onScale: (factor: number) => void;
}

/**
 * D46: the "Scale" chip in the staged-card header, next to "+ Add".
 *
 * Idle it reads "Scale" (or "×0.2" in cyan when the meal is scaled). Tapping
 * it swaps the chip in place for a small "× [ 1 ]" box with the decimal
 * keypad. Enter or blur applies; Escape cancels without closing the sheet.
 * Invalid input (empty, 0, out of range) simply reverts.
 */
export const MealScaleControl: React.FC<MealScaleControlProps> = ({ scale, onScale }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  // Enter/Escape unmount the input, which can also fire blur: settle once.
  const settledRef = useRef(false);
  const isScaled = scale !== 1;
  const label = formatMealScale(scale);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [isEditing]);

  const open = () => {
    settledRef.current = false;
    setDraft(label);
    setIsEditing(true);
  };

  const close = (returnFocus: boolean) => {
    settledRef.current = true;
    restoreFocusRef.current = returnFocus;
    setIsEditing(false);
  };

  const commit = (returnFocus: boolean) => {
    if (settledRef.current) return;
    const parsed = parseMealScaleInput(draft);
    if (parsed !== null && parsed !== scale) {
      onScale(parsed);
    }
    close(returnFocus);
  };

  if (isEditing) {
    return (
      <label
        data-testid="meal-scale-field"
        data-captures-escape=""
        className="-my-3 h-10 min-h-[40px] flex items-center cursor-text touch-manipulation normal-case tracking-normal"
      >
        <span className="w-[76px] h-8 rounded-lg border border-cyan-500 ring-1 ring-cyan-400 bg-zinc-950 flex items-center pl-2 pr-1 gap-0.5">
          <span aria-hidden="true" className="text-xs font-semibold text-zinc-400">
            &times;
          </span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            data-testid="meal-scale-input"
            aria-label="Scale whole meal by"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => commit(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit(true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
            }}
            className="w-full min-w-0 bg-transparent text-base font-semibold tabular-nums text-white outline-none border-0 p-0"
          />
        </span>
      </label>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="meal-scale-button"
      aria-label={isScaled ? `Scale whole meal, currently times ${label}` : 'Scale whole meal'}
      onClick={open}
      className="-my-3 h-10 min-h-[40px] px-1 flex items-center justify-center rounded-lg touch-manipulation normal-case tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <span
        className={`h-7 px-2.5 rounded-full border text-xs font-bold tabular-nums flex items-center whitespace-nowrap transition motion-reduce:transition-none ${
          isScaled
            ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300'
            : 'border-border-interactive bg-zinc-800 text-zinc-300 hover:text-white'
        }`}
      >
        {isScaled ? <>&times;{label}</> : 'Scale'}
      </span>
    </button>
  );
};
