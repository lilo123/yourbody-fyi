import React, { useId } from 'react';
import { Target, CheckCircle2, AlertCircle } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';

interface CoachAthleteMacrosProps {
  selectedAthlete: { name?: string } | null;
  athleteCal: number | string;
  setAthleteCal: (val: string) => void;
  athletePro: number | string;
  setAthletePro: (val: string) => void;
  athleteCarb: number | string;
  setAthleteCarb: (val: string) => void;
  athleteFat: number | string;
  setAthleteFat: (val: string) => void;
  athleteFiber: number | string;
  setAthleteFiber: (val: string) => void;
  isUpdatingMacros: boolean;
  macroStatus: { type: 'success' | 'error'; message: string } | null;
  onUpdateAthleteMacros: (e: React.FormEvent) => void;
}

export const CoachAthleteMacros: React.FC<CoachAthleteMacrosProps> = ({
  selectedAthlete,
  athleteCal,
  setAthleteCal,
  athletePro,
  setAthletePro,
  athleteCarb,
  setAthleteCarb,
  athleteFat,
  setAthleteFat,
  athleteFiber,
  setAthleteFiber,
  isUpdatingMacros,
  macroStatus,
  onUpdateAthleteMacros,
}) => {
  const baseId = useId();
  const calId = `${baseId}-cal`;
  const proId = `${baseId}-pro`;
  const carbId = `${baseId}-carb`;
  const fatId = `${baseId}-fat`;
  const fiberId = `${baseId}-fiber`;

  return (
    <form
      onSubmit={onUpdateAthleteMacros}
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Target className="w-4 h-4 text-cyan-400" />
          Athlete Nutrition Targets: {selectedAthlete?.name}
        </h3>
        <span className="text-xs uppercase font-bold text-zinc-400">Coach Override</span>
      </div>

      <p className="text-xs text-zinc-400">
        Set daily caloric and macronutrient goals for this athlete. Changes update their dashboard in real time.
      </p>

      <div className="space-y-3">
        {/* Tier 1: Full-Width Hero Daily Calorie Target */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <label htmlFor={calId} className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-0.5">
              Daily Calorie Target
            </label>
            <p className="text-xs text-zinc-400 font-medium">Total caloric energy ceiling per day</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={calId}
              type="number"
              inputMode="numeric"
              min="0"
              max="10000"
              value={athleteCal}
              onChange={(e) => setAthleteCal(e.target.value)}
              data-testid="athlete-macro-cal"
              className="w-full sm:w-36 min-h-[44px] bg-zinc-900 border border-border-interactive text-amber-400 rounded-xl p-2.5 text-lg tabular-nums font-bold focus:border-amber-500 outline-none text-center shadow-inner"
              required
            />
            <span className="text-xs tabular-nums font-bold text-zinc-400">kcal</span>
          </div>
        </div>

        {/* Tier 2: Sub-Macro 2x2 Grid (Mobile) / 4-Col Grid (Desktop) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {/* Protein */}
          <div className="min-w-0 bg-zinc-950 border border-zinc-800 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={proId} className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Protein</label>
              <span className="text-xs tabular-nums text-zinc-400 font-bold">grams</span>
            </div>
            <input
              id={proId}
              type="number"
              inputMode="decimal"
              min="0"
              value={athletePro}
              onChange={(e) => setAthletePro(e.target.value)}
              data-testid="athlete-macro-pro"
              className="w-full min-h-[44px] bg-zinc-900 border border-border-interactive text-white rounded-xl p-2.5 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center"
              required
            />
          </div>

          {/* Carbs */}
          <div className="min-w-0 bg-zinc-950 border border-zinc-800 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={carbId} className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Carbs</label>
              <span className="text-xs tabular-nums text-zinc-400 font-bold">grams</span>
            </div>
            <input
              id={carbId}
              type="number"
              inputMode="decimal"
              min="0"
              value={athleteCarb}
              onChange={(e) => setAthleteCarb(e.target.value)}
              data-testid="athlete-macro-carb"
              className="w-full min-h-[44px] bg-zinc-900 border border-border-interactive text-white rounded-xl p-2.5 text-base tabular-nums font-bold focus:border-emerald-500 outline-none text-center"
              required
            />
          </div>

          {/* Fat */}
          <div className="min-w-0 bg-zinc-950 border border-zinc-800 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={fatId} className="text-xs font-bold text-violet-400 uppercase tracking-wider">Fat</label>
              <span className="text-xs tabular-nums text-zinc-400 font-bold">grams</span>
            </div>
            <input
              id={fatId}
              type="number"
              inputMode="decimal"
              min="0"
              value={athleteFat}
              onChange={(e) => setAthleteFat(e.target.value)}
              data-testid="athlete-macro-fat"
              className="w-full min-h-[44px] bg-zinc-900 border border-border-interactive text-white rounded-xl p-2.5 text-base tabular-nums font-bold focus:border-violet-500 focus:ring-2 focus:ring-violet-500/50 outline-none text-center"
              required
            />
          </div>

          {/* Fiber */}
          <div className="min-w-0 bg-zinc-950 border border-zinc-800 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={fiberId} className="text-xs font-bold text-teal-400 uppercase tracking-wider">Fiber</label>
              <span className="text-xs tabular-nums text-zinc-400 font-bold">grams</span>
            </div>
            <input
              id={fiberId}
              type="number"
              inputMode="decimal"
              min="0"
              value={athleteFiber}
              onChange={(e) => setAthleteFiber(e.target.value)}
              data-testid="athlete-macro-fiber"
              className="w-full min-h-[44px] bg-zinc-900 border border-border-interactive text-white rounded-xl p-2.5 text-base tabular-nums font-bold focus:border-teal-500 outline-none text-center"
              required
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isUpdatingMacros}
        className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-300 font-bold py-3 min-h-[44px] rounded-xl text-xs shadow-neon-cyan transition disabled:opacity-50 touch-manipulation flex items-center justify-center gap-2"
        data-testid="update-athlete-macros-btn"
      >
        <Target className="w-4 h-4" />
        {isUpdatingMacros ? 'Updating targets...' : 'Update athlete targets'}
      </button>

      <StatusBanner
        message={macroStatus?.message ?? null}
        tone={macroStatus?.type === 'error' ? 'error' : 'info'}
        testId="athlete-macro-status"
        icon={
          macroStatus?.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          )
        }
      />
    </form>
  );
};
