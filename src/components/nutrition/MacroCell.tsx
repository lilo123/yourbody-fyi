import React, { memo } from 'react';
import { roundTo1Decimal, formatCalories, formatMacro } from '../../utils/nutrition';
import { type MacroColumnKey, MACRO_COLUMNS_CONFIG } from './macroColumns';

export type MacroCellVariant = 'component' | 'staged-total' | 'day-total';

export interface MacroCellProps {
  colKey: MacroColumnKey;
  value: number;
  target?: number;
  variant?: MacroCellVariant;
  testId?: string;
  valTestId?: string;
}

export const MacroCell: React.FC<MacroCellProps> = memo(({
  colKey,
  value,
  target,
  variant = 'component',
  testId,
  valTestId,
}) => {
  const config = MACRO_COLUMNS_CONFIG[colKey];
  const num = roundTo1Decimal(value);
  const isOver = Boolean(target && target > 0 && num > target);
  const isZero = colKey === 'calories' ? Math.abs(num) < 0.5 : Math.abs(num) < 0.05;
  const formatted = isZero ? '0' : (colKey === 'calories' ? formatCalories(value) : formatMacro(value));

  const colorClass = isOver
    ? 'text-rose-400'
    : isZero
    ? 'text-zinc-600 font-normal'
    : config.colorClass;

  const overAmount = isOver ? roundTo1Decimal(num - target!) : 0;
  const formattedOver = colKey === 'calories' ? formatCalories(overAmount) : formatMacro(overAmount);
  const overDescription = isOver ? `over target by ${formattedOver} ${config.label}` : undefined;

  const defaultContainerTestId =
    testId ||
    (variant === 'component'
      ? `component-macro-${colKey}`
      : variant === 'staged-total'
      ? `staged-total-${colKey}`
      : `day-total-${colKey}`);

  const defaultValTestId =
    valTestId ||
    (variant === 'day-total' ? `day-total-val-${colKey}` : `macro-val-${colKey}`);

  const valueWeightClass =
    variant === 'component'
      ? 'tabular-nums font-normal'
      : variant === 'staged-total'
      ? `tabular-nums ${isZero ? 'font-normal' : 'font-semibold'}`
      : `tabular-nums ${isZero && !isOver ? 'font-normal' : 'font-semibold'}`;

  const labelClass = 'opacity-70 font-normal';

  return (
    <div
      data-testid={defaultContainerTestId}
      className={`text-right text-xs tabular-nums whitespace-nowrap ${colorClass}`}
    >
      <span data-testid={defaultValTestId} className={valueWeightClass}>
        {formatted}
      </span>{' '}
      <span className={labelClass}>
        {config.label}
      </span>
      {isOver && (
        <span data-testid={`day-total-over-${colKey}`} className="sr-only">
          {overDescription}
        </span>
      )}
    </div>
  );
});

MacroCell.displayName = 'MacroCell';
