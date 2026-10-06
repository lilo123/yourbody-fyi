import React from 'react';
import { Calendar, Dumbbell, Activity, Utensils } from 'lucide-react';
import { SegmentedTabs } from '../common/SegmentedTabs';
import type { HistoryRange } from './useWorkoutHistory';

export interface HistoryHeaderProps {
  historyDomain: 'workouts' | 'nutrition';
  onHistoryDomainChange: (domain: 'workouts' | 'nutrition') => void;
  viewMode: 'session' | 'exercise';
  onViewModeChange: (mode: 'session' | 'exercise') => void;
  timeRange: HistoryRange;
  onTimeRangeChange: (range: HistoryRange) => void;
}

export const HistoryHeader: React.FC<HistoryHeaderProps> = ({
  historyDomain,
  onHistoryDomainChange,
  viewMode,
  onViewModeChange,
  timeRange,
  onTimeRangeChange,
}) => {
  const isExerciseView = historyDomain === 'workouts' && viewMode === 'exercise';

  return (
    <div className="bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-transparent border border-cyan-500/20 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-cyan-400" />
        {/* Exactly one h1 heading on the page */}
        <h1 className="text-base font-bold text-white uppercase tracking-wider">
          {historyDomain === 'workouts' ? 'Workout History' : 'Nutrition History'}
        </h1>
      </div>
      <p className="text-xs text-zinc-400">
        {historyDomain === 'workouts'
          ? 'Review past workout sessions, personal records, and volume.'
          : 'Review daily caloric distribution, macronutrient breakdowns, and logged meals.'}
      </p>

      {/* Top-Level Domain Segmented Control via SegmentedTabs */}
      <SegmentedTabs
        ariaLabel="History domain"
        tabs={[
          {
            id: 'workouts',
            label: 'Workouts',
            icon: <Dumbbell className="w-4 h-4" />,
            testId: 'history-tab-workouts',
            activeClassName: 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-neon-cyan',
          },
          {
            id: 'nutrition',
            label: 'Nutrition',
            icon: <Utensils className="w-4 h-4" />,
            testId: 'history-tab-nutrition',
            activeClassName: 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-neon-emerald',
          },
        ]}
        activeTab={historyDomain}
        onChange={(tab) => onHistoryDomainChange(tab as 'workouts' | 'nutrition')}
      />

      {/* Sub-view switcher for Workouts via SegmentedTabs */}
      {historyDomain === 'workouts' && (
        <SegmentedTabs
          ariaLabel="Workout view mode"
          size="sm"
          className="bg-zinc-950/60 p-1 rounded-xl border border-zinc-800/80"
          tabs={[
            {
              id: 'session',
              label: 'By Session',
              icon: <Calendar className="w-3.5 h-3.5" />,
              testId: 'history-subview-session',
              activeClassName: 'bg-zinc-800 text-cyan-300 border border-border-interactive',
            },
            {
              id: 'exercise',
              label: 'By Exercise',
              icon: <Dumbbell className="w-3.5 h-3.5" />,
              testId: 'history-subview-exercise',
              activeClassName: 'bg-zinc-800 text-cyan-300 border border-border-interactive',
            },
          ]}
          activeTab={viewMode}
          onChange={(tab) => onViewModeChange(tab as 'session' | 'exercise')}
        />
      )}

      {/* Date chips fit 320px width; hidden in By-Exercise with 'All-time stats' caption */}
      {isExerciseView ? (
        <div data-testid="all-time-stats-caption" className="text-xs font-bold text-zinc-400 tracking-wider uppercase py-1">
          All-time stats
        </div>
      ) : (
        <div className="bg-zinc-950/70 p-1 rounded-2xl border border-zinc-800/80 flex gap-1 overflow-x-auto text-xs no-scrollbar">
          {(
            [
              { id: 'all', label: 'All' },
              { id: '1y', label: '1Y' },
              { id: '90d', label: '90D' },
              { id: '30d', label: '30D' },
            ] as const
          ).map((range) => {
            const isSelected = timeRange === range.id;
            return (
              <button
                key={range.id}
                type="button"
                onClick={() => onTimeRangeChange(range.id)}
                aria-pressed={isSelected}
                data-testid={`history-range-${range.id}`}
                className={`flex-1 py-1.5 px-3 min-h-[44px] rounded-xl font-bold transition whitespace-nowrap touch-manipulation cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-800 text-cyan-300 border border-border-interactive shadow-sm'
                    : 'text-zinc-400 hover:text-white bg-transparent'
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
