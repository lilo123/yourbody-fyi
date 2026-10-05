import React, { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { CANONICAL_UNITS, shortUnitLabel, type CanonicalUnit } from '../../utils/unitConverter';

export interface UnitChipProps {
  value: CanonicalUnit;
  onChange: (next: CanonicalUnit) => void;
  disabled?: boolean;
  testId?: string;
  /** When true, outer borders and backgrounds are stripped for nesting inside compound controls (Card E2). */
  embedded?: boolean;
  ariaLabel?: string;
}

const FULL_UNIT_NAMES: Record<CanonicalUnit, string> = {
  g: 'Grams (g)',
  ml: 'Millilitres (ml)',
  unit: 'Units / pieces',
};

/**
 * The unit control is a <button> chip that opens a bottom sheet, not a <select>.
 *
 * Two independent reasons, both measured:
 *   * a <select> is a form control, so it must be >= 16 px to avoid iOS
 *     focus-zoom. A <button> is not, so the chip can be 12 px — which is real
 *     width recovered for free.
 *   * a <select> clips its own trigger text and scrollWidth does not report it.
 *     Constrained to 64 px it renders "serv" with the chevron on top while
 *     every numeric overflow gate reports zero. A <button> is a block container
 *     with inline content, so text-overflow: ellipsis genuinely applies.
 *
 * There is deliberately no chevron: it costs 16 px, which is 37% of the
 * quantity field next to it at a 320 px viewport.
 */
export const UnitChip: React.FC<UnitChipProps> = ({
  value,
  onChange,
  disabled,
  testId,
  embedded = false,
  ariaLabel,
}) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // Initial focus inside the sheet, so Tab does not walk into the page behind it.
    sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid={testId}
        aria-label={ariaLabel || `Unit: ${value}. Change unit`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`group shrink-0 ${
          embedded
            ? 'h-11 min-h-[44px] -my-1.5 w-[52px] min-w-[52px] max-w-[52px] bg-transparent border-0 p-0 flex items-center justify-center'
            : 'min-h-[40px] h-10 min-w-[40px] max-w-[64px] rounded-lg border border-border-interactive bg-zinc-950 hover:border-cyan-500 font-bold text-cyan-300 justify-center px-1'
        } flex items-center text-xs transition touch-manipulation disabled:opacity-50`}
      >
        {embedded ? (
          <span className="w-full h-8 border-l border-zinc-700/80 bg-zinc-700/60 group-hover:bg-zinc-700/80 group-hover:text-zinc-200 text-zinc-300 font-normal flex items-center justify-between pl-1.5 pr-1 rounded-r-[7px]">
            <span className="truncate text-left min-w-0">{shortUnitLabel(value)}</span>
            <ChevronDown className="w-3 h-3 shrink-0 text-zinc-300" aria-hidden="true" />
          </span>
        ) : (
          <span className="truncate text-left min-w-0">{shortUnitLabel(value)}</span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose unit"
          data-testid="unit-sheet"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <div
            ref={sheetRef}
            className="w-full max-w-md space-y-1 rounded-t-3xl border border-zinc-800 bg-zinc-900 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] shadow-2xl sm:rounded-3xl"
          >
            <span className="block pb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">
              Unit
            </span>
            {CANONICAL_UNITS.map((unit) => (
              <button
                key={unit}
                type="button"
                data-testid={`unit-option-${unit}`}
                aria-pressed={unit === value}
                onClick={() => {
                  onChange(unit);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`block w-full min-h-[44px] rounded-xl px-3 text-left text-xs font-bold transition touch-manipulation ${
                  unit === value
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white border border-transparent'
                }`}
              >
                {FULL_UNIT_NAMES[unit]}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
