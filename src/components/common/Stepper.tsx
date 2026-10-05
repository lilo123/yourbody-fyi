import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { IconButton } from './IconButton';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export const Stepper: React.FC<StepperProps> = ({
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
  disabled = false,
  ariaLabel = 'value',
  testId,
  className = '',
}) => {
  const [prevValue, setPrevValue] = useState(value);
  const [draft, setDraft] = useState<string>(() => String(value));

  // Sync draft when value prop changes externally (React state-during-render pattern)
  if (prevValue !== value) {
    setPrevValue(value);
    setDraft(String(value));
  }

  const commitDraft = () => {
    if (draft.trim() === '' || isNaN(Number(draft))) {
      const fallback = min;
      setDraft(String(fallback));
      if (fallback !== value) {
        onChange(fallback);
      }
      return;
    }

    const parsed = Number(draft);
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow empty string so user can clear and type a new number without snap-to-1
    if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) {
      setDraft(raw);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitDraft();
      e.currentTarget.blur();
    }
  };

  const handleDecrease = () => {
    const next = Math.max(min, value - step);
    setDraft(String(next));
    onChange(next);
  };

  const handleIncrease = () => {
    const next = Math.min(max, value + step);
    setDraft(String(next));
    onChange(next);
  };

  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  return (
    <div
      data-testid={testId}
      className={`inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800 ${className}`}
    >
      <IconButton
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        variant="secondary"
        size="sm"
        disabled={!canDecrease}
        onClick={handleDecrease}
        testId={testId ? `${testId}-decrease` : 'stepper-decrease'}
        icon={<Minus className="w-4 h-4 text-zinc-300" />}
      />
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        onChange={handleInputChange}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        onFocus={(e) => e.target.select()}
        className="w-12 h-11 min-h-[44px] text-center text-base font-semibold text-white bg-zinc-950 border border-zinc-800 rounded-lg tabular-nums focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/80 disabled:opacity-50 disabled:cursor-not-allowed select-all"
      />
      <IconButton
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        variant="secondary"
        size="sm"
        disabled={!canIncrease}
        onClick={handleIncrease}
        testId={testId ? `${testId}-increase` : 'stepper-increase'}
        icon={<Plus className="w-4 h-4 text-zinc-300" />}
      />
    </div>
  );
};
