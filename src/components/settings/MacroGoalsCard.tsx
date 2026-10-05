import React, { useId } from 'react';
import { Target, CheckCircle2, AlertCircle } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';

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
  const proteinId = `${baseId}-protein`;
  const carbsId = `${baseId}-carbs`;
  const fatId = `${baseId}-fat`;
  const fiberId = `${baseId}-fiber`;

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
            Calories (kcal)
          </label>
          <input
            id={caloriesId}
            type="number"
            inputMode="numeric"
            value={targetCalories}
            onChange={(e) => setTargetCalories(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={proteinId} className="block text-xs font-bold text-cyan-400 uppercase tracking-wider mb-1">
            Protein (g)
          </label>
          <input
            id={proteinId}
            type="number"
            inputMode="decimal"
            value={targetProtein}
            onChange={(e) => setTargetProtein(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={carbsId} className="block text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">
            Carbs (g)
          </label>
          <input
            id={carbsId}
            type="number"
            inputMode="decimal"
            value={targetCarbs}
            onChange={(e) => setTargetCarbs(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={fatId} className="block text-xs font-bold text-violet-400 uppercase tracking-wider mb-1">
            Fat (g)
          </label>
          <input
            id={fatId}
            type="number"
            inputMode="decimal"
            value={targetFat}
            onChange={(e) => setTargetFat(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
        </div>
        <div className="col-span-1 sm:col-span-1">
          <label htmlFor={fiberId} className="block text-xs font-bold text-teal-400 uppercase tracking-wider mb-1">
            Fiber (g)
          </label>
          <input
            id={fiberId}
            type="number"
            inputMode="decimal"
            value={targetFiber}
            onChange={(e) => setTargetFiber(Number(e.target.value))}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-bold tabular-nums focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
            required
          />
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
