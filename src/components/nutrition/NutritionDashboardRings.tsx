import React, { memo } from 'react';
import { Flame } from 'lucide-react';
import { MacroRing } from '../common/MacroRing';
import type { BreakdownNutrient } from './NutrientBreakdownModal';

export interface NutritionDashboardRingsProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  dailyTotals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  remainingFuel: {
    calories: { badgeLabel: string; isOver: boolean };
    protein: { badgeLabel: string; isOver: boolean };
    carbs: { badgeLabel: string; isOver: boolean };
    fat: { badgeLabel: string; isOver: boolean };
    fiber: { badgeLabel: string; isOver: boolean };
  };
  onSelectBreakdownNutrient: (nutrient: BreakdownNutrient) => void;
}

export const NutritionDashboardRings: React.FC<NutritionDashboardRingsProps> = memo(({
  selectedDate,
  onDateChange,
  dailyTotals,
  targets,
  remainingFuel,
  onSelectBreakdownNutrient,
}) => {

  const formatStatus = (label: string, fuel: { badgeLabel: string; isOver: boolean }) => {
    const isOver = fuel.isOver;
    const cleanDiff = fuel.badgeLabel.replace(/^\+/, '').replace(/\s*over$/, '').replace(/\s*left$/, '');
    const num = fuel.badgeLabel.replace(/^[^\d.]*/, '').replace(/[^\d.].*$/, '') || '0';
    const text = isOver ? `${num} over` : `${num} left`;
    const ariaLabel = isOver
      ? `${label}: ${cleanDiff} over target`
      : `${label}: ${cleanDiff} left`;
    return { text, isOver, ariaLabel };
  };

  const calStatus = formatStatus('Calories', remainingFuel.calories);
  const pStatus = formatStatus('Protein', remainingFuel.protein);
  const cStatus = formatStatus('Carbs', remainingFuel.carbs);
  const fStatus = formatStatus('Fat', remainingFuel.fat);
  const fibStatus = formatStatus('Fiber', remainingFuel.fiber);

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl px-2 py-4 sm:p-5 shadow-2xl">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <Flame className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-amber-400 shrink-0" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-white whitespace-nowrap">
            Today's Nutrition
          </h2>
        </div>
        <input
          type="date"
          data-testid="nutrition-date-input"
          value={selectedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="date-pill bg-zinc-950 border border-border-interactive text-cyan-400 rounded-xl px-1 sm:px-2.5 py-1 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none cursor-pointer shrink-0 min-h-[44px] h-11 -my-1.5 w-[120px] sm:w-auto"
        />
      </div>

            <span className="sr-only">Remaining Fuel:</span>
      <div className="grid grid-cols-6 sm:grid-cols-5 gap-1.5 sm:gap-2">
        <div className="col-span-2 sm:col-span-1">
          <MacroRing
            label="Calories"
            current={dailyTotals.calories}
            target={targets.calories}
            unit="kcal"
            colorClass="text-amber-400"
            strokeColor="#f59e0b"
            onClick={() => onSelectBreakdownNutrient('calories')}
            testId="macro-ring-calories"
            subtitle={calStatus.text}
            isOver={calStatus.isOver}
            statusTestId="remaining-fuel-calories"
            statusAriaLabel={calStatus.ariaLabel}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <MacroRing
            label="Protein"
            current={dailyTotals.protein}
            target={targets.protein}
            unit="g"
            colorClass="text-cyan-400"
            strokeColor="#06b6d4"
            onClick={() => onSelectBreakdownNutrient('protein')}
            testId="macro-ring-protein"
            subtitle={pStatus.text}
            isOver={pStatus.isOver}
            statusTestId="remaining-fuel-protein"
            statusAriaLabel={pStatus.ariaLabel}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <MacroRing
            label="Carbs"
            current={dailyTotals.carbs}
            target={targets.carbs}
            unit="g"
            colorClass="text-emerald-400"
            strokeColor="#10b981"
            onClick={() => onSelectBreakdownNutrient('carbs')}
            testId="macro-ring-carbs"
            subtitle={cStatus.text}
            isOver={cStatus.isOver}
            statusTestId="remaining-fuel-carbs"
            statusAriaLabel={cStatus.ariaLabel}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <MacroRing
            label="Fat"
            current={dailyTotals.fat}
            target={targets.fat}
            unit="g"
            colorClass="text-violet-400"
            strokeColor="#8b5cf6"
            onClick={() => onSelectBreakdownNutrient('fat')}
            testId="macro-ring-fat"
            subtitle={fStatus.text}
            isOver={fStatus.isOver}
            statusTestId="remaining-fuel-fat"
            statusAriaLabel={fStatus.ariaLabel}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <MacroRing
            label="Fiber"
            current={dailyTotals.fiber}
            target={targets.fiber}
            unit="g"
            colorClass="text-teal-400"
            strokeColor="#14b8a6"
            onClick={() => onSelectBreakdownNutrient('fiber')}
            testId="macro-ring-fiber"
            subtitle={fibStatus.text}
            isOver={fibStatus.isOver}
            statusTestId="remaining-fuel-fiber"
            statusAriaLabel={fibStatus.ariaLabel}
          />
        </div>
      </div>

      </div>
  );
});

NutritionDashboardRings.displayName = 'NutritionDashboardRings';
