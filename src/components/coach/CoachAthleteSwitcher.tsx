import React from 'react';
import { Users, Trash2 } from 'lucide-react';

interface CoachAthleteSwitcherProps {
  selectedAthleteId: string;
  selectedAthlete: { name?: string; email?: string } | null;
  athletes: { id: string; name: string; email: string }[];
  onSwitchAthlete: (id: string) => void;
  onDisconnectAthlete: () => void;
}

export const CoachAthleteSwitcher: React.FC<CoachAthleteSwitcherProps> = ({
  selectedAthleteId,
  selectedAthlete,
  athletes,
  onSwitchAthlete,
  onDisconnectAthlete,
}) => {
  return (
    <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase font-bold text-zinc-400 tracking-wider">Active Athlete</div>
            <div className="text-sm font-bold text-white truncate max-w-[200px] sm:max-w-xs">
              {selectedAthlete?.name || 'None'}
            </div>
          </div>
        </div>

        <div className="w-full sm:w-auto min-w-0">
          <select
            value={selectedAthleteId}
            onChange={(e) => onSwitchAthlete(e.target.value)}
            aria-label="Select athlete"
            data-testid="coach-athlete-select"
            className="w-full sm:w-64 max-w-full truncate bg-zinc-900 border border-border-interactive text-white rounded-xl px-3 py-2.5 text-base font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none cursor-pointer min-h-[44px]"
          >
            <option value="">-- None --</option>
            {athletes.map((ath) => (
              <option key={ath.id} value={ath.id}>
                {ath.name} ({ath.email})
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedAthleteId && (
        <div className="flex justify-end pt-2 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={onDisconnectAthlete}
            data-testid="disconnect-athlete-btn"
            className="text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 min-h-[44px] rounded-xl border border-rose-500/30 transition flex items-center gap-1.5 touch-manipulation"
            title="Disconnect Athlete"
          >
            <Trash2 className="w-4 h-4" />
            <span>Disconnect Athlete</span>
          </button>
        </div>
      )}
    </div>
  );
};
