import React, { useState, useMemo, useRef, useCallback } from 'react';
import type { Exercise, WorkoutSet } from '../../types/database';
import { Search, Trophy } from 'lucide-react';
import { formatShortDate, normalizeDateStr } from '../../utils/date';
import { normalizeSearch } from '../../utils/normalizeSearch';
import { resolveExerciseLabel } from '../../utils/exerciseLabel';
import { useAuth } from '../../hooks/useAuth';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { usePrMode } from '../../hooks/usePrMode';
import { e1rm } from '../../lib/prComparator';
import { formatWeight } from '../../utils/weight';
import { Tag } from '../common/Tag';
import { ExerciseSparkline } from './ExerciseSparkline';
import { ExerciseHistorySheet } from './ExerciseHistorySheet';
import type { RawExerciseStat } from './useWorkoutHistory';

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

export interface ExerciseStatsListProps {
  exerciseStats?: ExerciseStat[];
  exercises?: Exercise[];
  rawExerciseStats?: RawExerciseStat[];
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  selectedCategory: string;
  onSelectedCategoryChange: (cat: string) => void;
  isInspectingAthlete: boolean;
  onEditSet: (set: WorkoutSet & { workout_date?: string; workout_name?: string }) => void;
  userId?: string;
  timeZone?: string;
  isReadOnly?: boolean;
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

export const ExerciseStatsList: React.FC<ExerciseStatsListProps> = ({
  exerciseStats: initialStats,
  exercises = [],
  rawExerciseStats = [],
  searchQuery = '',
  onSearchQueryChange,
  selectedCategory = 'All',
  onSelectedCategoryChange,
  isInspectingAthlete,
  onEditSet,
  userId,
  timeZone,
  isReadOnly,
}) => {
  const { user } = useAuth();
  const unit = useWeightUnit();
  const { mode: prMode } = usePrMode();
  const effectiveUserId = userId || user?.id || '';
  const effectiveReadOnly = isReadOnly ?? isInspectingAthlete;

  const [showUnlogged, setShowUnlogged] = useState(false);
  const [selectedStatForSheet, setSelectedStatForSheet] = useState<ExerciseStat | null>(null);
  const lastOpenedCardIdRef = useRef<string | null>(null);

  const handleCardClick = (stat: ExerciseStat, idx: number) => {
    const cardId = stat.exercise.id || stat.exercise.name || String(idx);
    lastOpenedCardIdRef.current = cardId;
    setSelectedStatForSheet(stat);
  };

  const handleSheetClose = useCallback(() => {
    setSelectedStatForSheet(null);
    const cardId = lastOpenedCardIdRef.current;
    if (cardId) {
      requestAnimationFrame(() => {
        const btn = document.querySelector(
          `[data-testid="exercise-card-${cardId}"]`
        ) as HTMLElement | null;
        btn?.focus();
      });
    }
  }, []);

  // Group by exercise for workouts using RPC + catalog merge
  const computedStats = useMemo<ExerciseStat[]>(() => {
    if (initialStats) return initialStats;

    const stats: Record<string, ExerciseStat> = {};

    exercises.forEach((ex) => {
      stats[ex.id] = {
        exercise: ex,
        sets: [],
        maxWeight: 0,
        prReps: 0,
        setCount: 0,
      };
    });

    rawExerciseStats.forEach((row) => {
      let match: ExerciseStat | undefined = stats[row.exercise_id];
      if (!match) {
        match = Object.values(stats).find((s) => s.exercise.name === row.exercise_id);
      }
      if (match) {
        match.setCount = Number(row.set_count) || 0;
        match.maxWeight = Number(row.max_weight) || 0;
        match.prReps = Number(row.pr_reps) || 0;
        match.prDate = row.pr_date || null;
        match.prE1rm = row.pr_e1rm != null ? Number(row.pr_e1rm) : null;
        match.sets = Array.isArray(row.recent_sets) ? row.recent_sets : [];
        if (row.exercise_name && (!match.exercise.name || match.exercise.name === match.exercise.id)) {
          match.exercise.name = row.exercise_name;
        }
      } else {
        const name = row.exercise_name || resolveExerciseLabel(row.exercise_id);
        stats[row.exercise_id] = {
          exercise: { id: row.exercise_id, name, body_parts: ['Other'] } as any,
          sets: Array.isArray(row.recent_sets) ? row.recent_sets : [],
          maxWeight: Number(row.max_weight) || 0,
          prReps: Number(row.pr_reps) || 0,
          prDate: row.pr_date || null,
          prE1rm: row.pr_e1rm != null ? Number(row.pr_e1rm) : null,
          setCount: Number(row.set_count) || 0,
        };
      }
    });

    return Object.values(stats);
  }, [initialStats, exercises, rawExerciseStats]);

  const isLogged = (stat: ExerciseStat) =>
    (stat.setCount != null && stat.setCount > 0) || (stat.sets && stat.sets.length > 0);

  const getLastPerformedDate = (stat: ExerciseStat): string => {
    if (stat.sets && stat.sets.length > 0) {
      const last = stat.sets[stat.sets.length - 1];
      return last.workout_date || '';
    }
    return stat.prDate || '';
  };

  // Filter stats by category and normalized search
  const filteredStats = computedStats.filter((stat) => {
    if (selectedCategory !== 'All') {
      const parts = stat.exercise.body_parts || [];
      if (!parts.some((p) => p.toLowerCase().includes(selectedCategory.toLowerCase()))) return false;
    }
    if (searchQuery.trim()) {
      const normalizedQuery = normalizeSearch(searchQuery);
      const normalizedName = normalizeSearch(stat.exercise.name);
      if (!normalizedName.includes(normalizedQuery)) return false;
    }
    return true;
  });

  const loggedExercises = filteredStats
    .filter((s) => isLogged(s))
    .sort((a, b) => {
      const dateA = getLastPerformedDate(a);
      const dateB = getLastPerformedDate(b);
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
      return a.exercise.name.localeCompare(b.exercise.name);
    });

  const unloggedExercises = filteredStats.filter((s) => !isLogged(s));
  const isSearching = Boolean(searchQuery.trim());

  const getSparklinePoints = (stat: ExerciseStat): number[] => {
    if (!stat.sets || stat.sets.length < 2) return [];
    const sessionBestMap = new Map<string, number>();
    for (const s of stat.sets) {
      const key = s.workout_date || s.id || '';
      const w = Number(s.weight) || 0;
      const cur = sessionBestMap.get(key) ?? 0;
      if (w > cur) sessionBestMap.set(key, w);
    }
    if (sessionBestMap.size >= 2) {
      return Array.from(sessionBestMap.values());
    }
    return [];
  };

  const renderExerciseCard = (stat: ExerciseStat, idx: number) => {
    const totalSets = stat.setCount ?? stat.sets.length;
    const sparklinePoints = getSparklinePoints(stat);

    return (
      <button
        type="button"
        key={stat.exercise.id || stat.exercise.name || idx}
        aria-haspopup="dialog"
        onClick={() => handleCardClick(stat, idx)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCardClick(stat, idx);
          }
        }}
        className="w-full text-left bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700/80 rounded-3xl p-5 shadow-2xl space-y-3 cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-cyan-500/50 touch-manipulation block"
        data-testid={`exercise-card-${stat.exercise.id || stat.exercise.name || idx}`}
      >
        <div className="border-b border-zinc-800 pb-3 space-y-2">
          {/* Row 1: Title keeps its row (min width >= 60% of card, wraps before truncating) + Sparkline */}
          <div className="flex items-start justify-between gap-2">
            <h3
              className="text-sm font-bold text-white break-words min-w-0 flex-1"
              title={stat.exercise.name}
            >
              {stat.exercise.name}
            </h3>
            {sparklinePoints.length >= 2 && (
              <ExerciseSparkline
                points={sparklinePoints}
                width={60}
                height={22}
                className="text-cyan-400 shrink-0 mt-0.5"
                unit={unit}
              />
            )}
          </div>

          {/* Row 2: Tag & PR Badge (wraps within card if needed) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Tag
                label={stat.exercise.body_parts?.[0] || 'Full Body'}
                tone="info"
              />
            </div>

            {/* PR line shows formatted pr_date */}
            {totalSets > 0 ? (() => {
              const prE1rm =
                prMode === 'e1rm'
                  ? (stat.prE1rm ??
                    (stat.maxWeight > 0 && stat.prReps <= 12
                      ? e1rm(stat.maxWeight, stat.prReps)
                      : null))
                  : null;
              const hasE1rm = prMode === 'e1rm' && prE1rm != null && prE1rm > 0;
              const weightStr =
                stat.maxWeight > 0
                  ? formatWeight(stat.maxWeight, unit, { showUnit: true })
                  : 'Bodyweight';
              const dateStr = stat.prDate ? formatExerciseSetDate(stat.prDate) : '';

              return (
                <div
                  data-testid={`pr-badge-${stat.exercise.id || stat.exercise.name || idx}`}
                  className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-2xl text-amber-400 text-xs font-bold max-w-full"
                >
                  <Trophy className="w-3.5 h-3.5 shrink-0" />
                  <span className={hasE1rm ? "flex flex-col sm:inline sm:space-x-1 min-w-0" : "min-w-0"}>
                    {hasE1rm ? (
                      <>
                        <span className="break-words">PR: {weightStr} × {stat.prReps}</span>
                        <span className="text-xs font-semibold text-amber-300/90 break-words">
                          {`e1RM ${formatWeight(prE1rm, unit, { showUnit: true })}${dateStr ? ` · ${dateStr}` : ''}`}
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
                  <span className="text-cyan-300 font-bold tabular-nums">
                    {formatWeight(s.weight, unit, { showUnit: true })} × {s.reps} reps
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </button>
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
      {filteredStats.length === 0 ? (
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-8 text-center text-zinc-400 text-xs">
          No exercises found.
        </div>
      ) : isSearching ? (
        // When searching, render all matching exercises directly
        <div className="space-y-3">
          {filteredStats.map((stat, idx) => renderExerciseCard(stat, idx))}
        </div>
      ) : (
        // Logged exercises first, unlogged behind divider toggle
        <div className="space-y-3">
          {loggedExercises.map((stat, idx) => renderExerciseCard(stat, idx))}

          {unloggedExercises.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setShowUnlogged((prev) => !prev)}
                aria-expanded={showUnlogged}
                data-testid="toggle-unlogged-exercises"
                className="w-full py-2.5 px-4 min-h-[44px] rounded-xl text-xs font-bold text-zinc-400 hover:text-white bg-zinc-900/60 hover:bg-zinc-800/60 border border-zinc-800 flex items-center justify-between transition touch-manipulation cursor-pointer"
              >
                <span>Unlogged Exercises ({unloggedExercises.length})</span>
                <span className="text-xs text-zinc-400">
                  {showUnlogged ? 'Hide' : 'Show'}
                </span>
              </button>

              {showUnlogged && (
                <div className="space-y-3 mt-3">
                  {unloggedExercises.map((stat, idx) => renderExerciseCard(stat, idx))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Exercise History Drill-Down Sheet */}
      <ExerciseHistorySheet
        open={Boolean(selectedStatForSheet)}
        onClose={handleSheetClose}
        userId={effectiveUserId}
        exercise={selectedStatForSheet ? selectedStatForSheet.exercise : null}
        prDate={selectedStatForSheet?.prDate}
        prWeight={selectedStatForSheet?.maxWeight}
        prReps={selectedStatForSheet?.prReps}
        prE1rm={selectedStatForSheet?.prE1rm}
        isReadOnly={effectiveReadOnly}
        timeZone={timeZone}
        onEditSet={effectiveReadOnly ? undefined : onEditSet}
      />
    </div>
  );
};
