import React from 'react';
import { roundTo1Decimal } from '../../utils/nutrition';
import { MacroCell } from './MacroCell';
import {
  type MacroColumnKey,
  getMacroGridTemplateColumns,
} from './macroColumns';

export interface MacroTotalsShape {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export interface DayTotalRowProps {
  macroColumns: MacroColumnKey[];
  mealTotals: MacroTotalsShape;
  dailyTotals?: Partial<MacroTotalsShape>;
  targets?: Partial<MacroTotalsShape>;
}

export const DayTotalRow: React.FC<DayTotalRowProps> = ({
  macroColumns,
  mealTotals,
  dailyTotals,
  targets,
}) => {
  return (
    <div
      data-testid="staged-meal-day-total"
      className="mt-2.5 text-xs tabular-nums leading-tight"
    >
      <div
        data-testid="day-total-label"
        className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-0.5 leading-none"
      >
        Day total
      </div>
      <div
        data-testid="day-total-grid"
        className="grid text-xs tabular-nums leading-tight"
        style={{ gridTemplateColumns: getMacroGridTemplateColumns(macroColumns) }}
      >
        {macroColumns.map((colKey) => {
          const consumed = Number(dailyTotals?.[colKey]) || 0;
          const meal = Number(mealTotals[colKey]) || 0;
          const newVal = roundTo1Decimal(consumed + meal);
          const target = Number(targets?.[colKey]) || 0;

          return (
            <MacroCell
              key={colKey}
              colKey={colKey}
              value={newVal}
              target={target}
              variant="day-total"
            />
          );
        })}
      </div>
    </div>
  );
};

