import React, { memo } from 'react';
import { kcalMacroMismatch } from '../../utils/nutrition';

export interface KcalMacroHintProps {
  kcal?: number | string | null;
  calories?: number | string | null;
  protein?: number | string | null;
  carbs?: number | string | null;
  fat?: number | string | null;
  fiber?: number | string | null;
  testId?: string;
  className?: string;
}

export const KcalMacroHint: React.FC<KcalMacroHintProps> = memo(({
  kcal,
  calories,
  protein,
  carbs,
  fat,
  fiber,
  testId = 'macro-mismatch-hint',
  className = '',
}) => {
  const result = kcalMacroMismatch({
    kcal: kcal !== undefined ? kcal : calories,
    protein,
    carbs,
    fat,
    fiber,
  });

  const message = result ? result.message : '';

  return (
    <output
      aria-live="polite"
      aria-atomic="true"
      data-testid={testId}
      className={
        message
          ? `block mt-1 text-xs text-zinc-400 leading-4 whitespace-nowrap overflow-hidden ${className}`.trim()
          : 'block h-0 m-0 p-0 border-0 overflow-hidden'
      }
    >
      {message}
    </output>
  );
});

KcalMacroHint.displayName = 'KcalMacroHint';
