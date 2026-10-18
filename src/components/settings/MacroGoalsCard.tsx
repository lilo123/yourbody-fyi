import React, { useId } from 'react';
import { Target, CheckCircle2, AlertCircle } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { DecimalInput } from '../nutrition/DecimalInput';

interface MacroGoalsCardProps {
  targetCalories: number;
  setTargetCalories: (val: number) => void;
  targetProtein: number;
  setTargetProtein: (val: number) => void;
  targetCarbs: number;
  setTargetCarbs: (val: number) => void;
  targetFat: number;
  setTargetFat: (val: number) => void;
  targetFiber: number;
  setTargetFiber: (val: number) => void;
  loading: boolean;
  status: { type: 'success' | 'error'; message: string } | null;
  onSave: (e: React.FormEvent) => void;
}

export const MacroGoalsCard: React.FC<MacroGoalsCardProps> = ({
  targetCalories,
  setTargetCalories,
  targetProtein,
  setTargetProtein,
  targetCarbs,
  setTargetCarbs,
  targetFat,
  setTargetFat,
  targetFiber,
  setTargetFiber,
  loading,
  status,
  onSave,
}) => {
  const baseId = useId();
  const caloriesId = `${baseId}-calories`;
  const caloriesUnitId = `${baseId}-calories-unit`;
  const proteinId = `${baseId}-protein`;
  const proteinUnitId = `${baseId}-protein-unit`;
  const carbsId = `${baseId}-carbs`;
  const carbsUnitId = `${baseId}-carbs-unit`;
  const fatId = `${baseId}-fat`;
  const fatUnitId = `${baseId}-fat-unit`;
  const fiberId = `${baseId}-fiber`;
  const fiberUnitId = `${baseId}-fiber-unit`;

  return (
    <form
      onSubmit={onSave}
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Target className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Daily Macro Goals
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor={caloriesId} className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
            Calories
          </label>
          <input
            id={caloriesId}
            type="number"
            inputMode="numeric"
            value={targetCalories}
            onChange={(e) => setTargetCalories(Number(e.target.value))}
            aria-describedby={caloriesUnitId}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
          <span id={caloriesUnitId} className="block text-xs text-zinc-400 italic text-center mt-1">
            kcal
          </span>
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={proteinId} className="block text-xs font-bold text-cyan-400 uppercase tracking-wider mb-1">
            Protein
          </label>
          <DecimalInput
            id={proteinId}
            value={targetProtein}
            onChange={(val) => setTargetProtein(typeof val === 'number' && !Number.isNaN(val) ? val : 0)}
            aria-describedby={proteinUnitId}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
          <span id={proteinUnitId} className="block text-xs text-zinc-400 italic text-center mt-1">
            g
          </span>
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={carbsId} className="block text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">
            Carbs
          </label>
          <DecimalInput
            id={carbsId}
            value={targetCarbs}
            onChange={(val) => setTargetCarbs(typeof val === 'number' && !Number.isNaN(val) ? val : 0)}
            aria-describedby={carbsUnitId}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
          <span id={carbsUnitId} className="block text-xs text-zinc-400 italic text-center mt-1">
            g
          </span>
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={fatId} className="block text-xs font-bold text-violet-400 uppercase tracking-wider mb-1">
            Fat
          </label>
          <DecimalInput
            id={fatId}
            value={targetFat}
            onChange={(val) => setTargetFat(typeof val === 'number' && !Number.isNaN(val) ? val : 0)}
            aria-describedby={fatUnitId}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
          <span id={fatUnitId} className="block text-xs text-zinc-400 italic text-center mt-1">
            g
          </span>
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={fiberId} className="block text-xs font-bold text-teal-400 uppercase tracking-wider mb-1">
            Fiber
          </label>
          <DecimalInput
            id={fiberId}
            value={targetFiber}
            onChange={(val) => setTargetFiber(typeof val === 'number' && !Number.isNaN(val) ? val : 0)}
            aria-describedby={fiberUnitId}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 min-h-[44px] text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
          <span id={fiberUnitId} className="block text-xs text-zinc-400 italic text-center mt-1">
            g
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold py-3 min-h-[44px] rounded-xl text-xs shadow-neon-cyan active:scale-95 transition disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save goals'}
      </button>

      <StatusBanner
        testId="settings-status-banner"
        message={status?.message}
        tone={status?.type === 'error' ? 'error' : 'info'}
        icon={
          status?.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          )
        }
      />
    </form>
  );
};
