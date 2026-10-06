import React from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { Exercise, WorkoutSet } from '../../types/database';
import { Search, Trophy, Edit2 } from 'lucide-react';
import { formatShortDate, normalizeDateStr } from '../../utils/date';
import { Tag } from '../common/Tag';
import { FALLBACK_WINDOW } from './virtualizationConstants';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { usePrMode } from '../../hooks/usePrMode';
import { e1rm } from '../../lib/prComparator';
import { formatWeight } from '../../utils/weight';

const CATEGORIES = ['All', 'Chest', 'Back', 'Arms', 'Shoulders', 'Legs', 'Core'];

export interface ExerciseStat {
  exercise: Exercise;
  sets: any[];
  maxWeight: number;
  prReps: number;
  setCount?: number;
  prDate?: string | null;
  prE1rm?: number | null;
}

interface WorkoutExerciseHistoryProps {
  exerciseStats: ExerciseStat[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  selectedCategory: string;
  onSelectedCategoryChange: (cat: string) => void;
  isInspectingAthlete: boolean;
  onEditSet: (set: WorkoutSet & { workout_date?: string; workout_name?: string }) => void;
}

function formatExerciseSetDate(dateStr: string): string {
  if (!dateStr) return '';
  const norm = normalizeDateStr(dateStr);
  const parts = norm.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const currentYear = new Date().getFullYear();
  const shortDate = formatShortDate(norm);
  if (!isNaN(year) && year !== currentYear) {
    return `${shortDate}, ${year}`;
  }
  return shortDate;
}

export const WorkoutExerciseHistory: React.FC<WorkoutExerciseHistoryProps> = ({
  exerciseStats,
  searchQuery,
  onSearchQueryChange,
  selectedCategory,
  onSelectedCategoryChange,
  isInspectingAthlete,
  onEditSet,
}) => {
  const unit = useWeightUnit();
  const { mode: prMode } = usePrMode();
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);

  const measureScrollMargin = React.useCallback(() => {
    if (parentRef.current) {
      const offsetTop = parentRef.current.offsetTop;
      setScrollMargin((prev) => (prev !== offsetTop ? offsetTop : prev));
    }
  }, []);

  const containerRef = React.useCallback((node: HTMLDivElement | null) => {
    parentRef.current = node;
    if (node) {
      const offsetTop = node.offsetTop;
      setScrollMargin((prev) => (prev !== offsetTop ? offsetTop : prev));
    }
  }, []);

  React.useLayoutEffect(() => {
    measureScrollMargin();
  });

  React.useEffect(() => {
    measureScrollMargin();
    window.addEventListener('resize', measureScrollMargin);
    if (typeof ResizeObserver !== 'undefined' && document.body) {
      const observer = new ResizeObserver(() => {
        measureScrollMargin();
      });
      observer.observe(document.body);
      return () => {
        window.removeEventListener('resize', measureScrollMargin);
        observer.disconnect();
      };
    }
    return () => {
      window.removeEventListener('resize', measureScrollMargin);
    };
  }, [measureScrollMargin]);

  const virtualizer = useWindowVirtualizer({
    count: exerciseStats.length,
    estimateSize: () => 140,
    overscan: 1,
    gap: 12,
    scrollMargin,
    measureElement: (element, entry) => {
      if (entry?.borderBoxSize?.[0]?.blockSize) {
        return Math.round(entry.borderBoxSize[0].blockSize);
      }
      const measured = element?.getBoundingClientRect?.()?.height;
      return (measured && measured > 0) ? Math.round(measured) : 140;
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const isVirtual = virtualItems.length > 0;

  const renderExerciseCard = (stat: ExerciseStat, idx: number) => {
    const totalSets = stat.setCount ?? stat.sets.length;
    return (
      <div
        key={stat.exercise.name || idx}
        className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3 gap-2">
          {/* ex: min-w-0 flex-1 truncate with title,: Tag */}
          <div className="min-w-0 flex-1 space-y-1">
            <h3
              className="text-sm font-bold text-white truncate"
              title={stat.exercise.name}
            >
              {stat.exercise.name}
            </h3>
            <Tag
              label={stat.exercise.body_parts?.[0] || 'Full Body'}
              tone="info"
            />
          </div>

          {/* PR line shows formatted pr_date */}
          {totalSets > 0 ? (() => {
            const calculatedE1rm =
              prMode === 'e1rm'
                ? (stat.prE1rm ??
                  (stat.maxWeight > 0 && stat.prReps <= 12
                    ? e1rm(stat.maxWeight, stat.prReps)
                    : null))
                : null;
            const hasE1rm = prMode === 'e1rm' && calculatedE1rm != null && calculatedE1rm > 0;
            const weightStr =
              stat.maxWeight > 0
                ? formatWeight(stat.maxWeight, unit, { showUnit: true })
                : 'Bodyweight';
            const dateStr = stat.prDate ? formatExerciseSetDate(stat.prDate) : '';

            return (
              <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-2xl text-amber-400 text-xs font-bold max-w-full">
                <Trophy className="w-3.5 h-3.5 shrink-0" />
                <span className={hasE1rm ? "flex flex-col sm:inline sm:space-x-1 min-w-0" : "min-w-0"}>
                  {hasE1rm ? (
                    <>
                      <span className="break-words">PR: {weightStr} × {stat.prReps}</span>
                      <span className="text-xs font-semibold text-amber-300/90 break-words">
                        {`e1RM ${formatWeight(calculatedE1rm, unit, { showUnit: true })}${dateStr ? ` · ${dateStr}` : ''}`}
                      </span>
                    </>
                  ) : (
                    `PR: ${weightStr} × ${stat.prReps}${dateStr ? ` · ${dateStr}` : ''}`
                  )}
                </span>
              </div>
            );
          })() : (
            <span className="text-xs text-zinc-400 shrink-0">No logs yet</span>
          )}
        </div>

        {/* 'All-time: N sets · Last 3:' + year when not current year */}
        {totalSets > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase text-zinc-400 tracking-wider block mb-1">
              All-time: {totalSets} sets · Last 3:
            </span>
            <div className="space-y-1">
              {stat.sets.slice(-3).map((s, sIdx) => (
                <div
                  key={s.id || sIdx}
                  className="bg-zinc-950 border border-zinc-800/60 rounded-xl px-3 py-2 flex items-center justify-between text-xs"
                >
                  <span className="text-zinc-400">{formatExerciseSetDate(s.workout_date)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-300 font-bold tabular-nums">
                      {formatWeight(s.weight, unit, { showUnit: true })} × {s.reps} reps
                    </span>
                    {!isInspectingAthlete && (
                      <button
                        type="button"
                        onClick={() => onEditSet(s)}
                        className="min-w-[44px] min-h-[44px] rounded-lg bg-zinc-800/70 hover:bg-cyan-500/20 text-zinc-400 hover:text-cyan-300 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer"
                        title="Edit set"
                        aria-label={`Edit recent set of ${stat.exercise.name}`}
                        data-testid={`edit-recent-set-btn-${s.id || sIdx}`}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Exercise Filter Bar */}
      <div className="space-y-2">
        {/* search input text-base min-h-[44px] bg-zinc-950 cyan focus ring */}
        <div className="relative">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search exercise library..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-2xl pl-10 pr-4 py-2.5 text-base min-h-[44px] font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => onSelectedCategoryChange(cat)}
              aria-pressed={selectedCategory === cat}
              className={`px-3.5 py-2 min-h-[44px] flex items-center justify-center rounded-xl text-xs font-bold shrink-0 transition touch-manipulation cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-cyan-500 text-black shadow-neon-cyan'
                  : 'bg-zinc-900 text-zinc-400 hover:text-white border border-border-interactive'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Exercise Cards */}
      {exerciseStats.length === 0 ? (
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-8 text-center text-zinc-400 text-xs">
          No exercises found.
        </div>
      ) : !isVirtual ? (
        <div ref={containerRef} className="space-y-3">
          {exerciseStats.length > FALLBACK_WINDOW && (
            <div
              data-testid="virtualizer-fallback-notice"
              className="text-xs text-zinc-400 text-center py-2"
            >
              Showing first {FALLBACK_WINDOW} of {exerciseStats.length} (virtualization disabled)
            </div>
          )}
          {exerciseStats.slice(0, FALLBACK_WINDOW).map((stat, idx) => renderExerciseCard(stat, idx))}
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            width: '100%',
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          {virtualItems.map((virtualRow) => {
            const stat = exerciseStats[virtualRow.index];
            if (!stat) return null;
            return (
              <div
                key={stat.exercise.id || stat.exercise.name || virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                }}
              >
                {renderExerciseCard(stat, virtualRow.index)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
