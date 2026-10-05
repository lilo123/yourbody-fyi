import React, { useState, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Trophy, Edit2, AlertCircle } from 'lucide-react';
import type { WorkoutSet } from '../../types/database';
import { Sheet } from '../common/Sheet';
import { Chip } from '../common/Chip';
import { Tag } from '../common/Tag';
import { Button } from '../common/Button';
import { Skeleton } from '../common/Skeleton';
import { StatusBanner } from '../common/StatusBanner';
import { ExerciseSparkline } from './ExerciseSparkline';
import { useWeightUnit } from '../../hooks/useWeightUnit';
import { usePrMode } from '../../hooks/usePrMode';
import { e1rm } from '../../lib/prComparator';
import { formatWeight } from '../../utils/weight';
import {
  fetchExerciseHistoryPage,
  computeHistorySince,
  type HistoryRange,
  type ExerciseHistorySet,
} from './useWorkoutHistory';
import { formatShortDate, normalizeDateStr, getDayOfWeekAbbr } from '../../utils/date';
import { useWorkoutPendingOps } from '../workout/useWorkoutPendingOps';

export interface ExerciseHistorySheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  exercise: {
    id: string;
    name: string;
    body_parts?: string[] | null;
  } | null;
  prDate?: string | null;
  prWeight?: number | null;
  prReps?: number | null;
  prE1rm?: number | null;
  isReadOnly?: boolean; // coach
  timeZone?: string;
  onEditSet?: (set: WorkoutSet & { workout_date?: string; workout_name?: string }) => void;
  testId?: string;
}

const RANGE_CHIPS: { label: string; value: HistoryRange }[] = [
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
  { label: '1Y', value: '1y' },
  { label: 'All', value: 'all' },
];

function formatSessionDate(dateStr: string): string {
  if (!dateStr) return '';
  const norm = normalizeDateStr(dateStr);
  const parts = norm.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const currentYear = new Date().getFullYear();
  const shortDate = formatShortDate(norm);
  const weekday = getDayOfWeekAbbr(norm);
  const withWeekday = weekday ? `${weekday}, ${shortDate}` : shortDate;
  if (!isNaN(year) && year !== currentYear) {
    return `${withWeekday}, ${year}`;
  }
  return withWeekday;
}

function formatPrDate(dateStr: string): string {
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

export const ExerciseHistorySheet: React.FC<ExerciseHistorySheetProps> = ({
  open,
  onClose,
  userId,
  exercise,
  prDate,
  prWeight,
  prReps,
  prE1rm,
  isReadOnly = false,
  timeZone,
  onEditSet,
  testId = 'exercise-history-sheet',
}) => {
  const unit = useWeightUnit();
  const { mode: prMode } = usePrMode();
  const [range, setRange] = useState<HistoryRange>('all');

  const since = useMemo(() => computeHistorySince(range, timeZone), [range, timeZone]);

  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['workout_sets', userId, 'exercise_history', exercise?.id, range],
    enabled: Boolean(open && userId && exercise?.id),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!userId || !exercise?.id) return [];
      return fetchExerciseHistoryPage(userId, exercise.id, {
        since,
        before: pageParam ?? null,
        limit: 10,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length === 0) return undefined;
      const oldestCivilDate = lastPage[lastPage.length - 1]?.civil_date;
      if (!oldestCivilDate) return undefined;

      const totalSessions = lastPage[0]?.total_sessions;
      const loadedSessionIds = new Set(allPages.flatMap((p) => p.map((s) => s.workout_id)));
      if (totalSessions != null && totalSessions > 0 && loadedSessionIds.size >= totalSessions) {
        return undefined;
      }
      const pageSessionIds = new Set(lastPage.map((s) => s.workout_id));
      if (pageSessionIds.size < 10) {
        return undefined;
      }
      return oldestCivilDate;
    },
  });

  const pendingOps = useWorkoutPendingOps(userId);

  const allRows = useMemo(() => {
    const serverRows = data?.pages.flatMap((page) => page) ?? [];
    if (!exercise?.id) return serverRows;

    const workoutRefDateMap = new Map<string, { date: string; name: string }>();
    for (const op of pendingOps) {
      if (op.kind === 'workout.ensure') {
        workoutRefDateMap.set(op.payload.clientWorkoutId, {
          date: op.payload.workout_date,
          name: op.payload.name || 'Workout',
        });
      }
    }

    const pendingSets: ExerciseHistorySet[] = [];
    const updatedSets = new Map<string, any>();
    const deletedSetIds = new Set<string>();

    for (const op of pendingOps) {
      if (op.kind === 'set.create' && op.payload.exercise_id === exercise.id) {
        const info = workoutRefDateMap.get(op.payload.workoutRef);
        const civilDate = info?.date || op.payload.created_at?.slice(0, 10) || '';
        pendingSets.push({
          workout_id: op.payload.workoutRef,
          civil_date: civilDate,
          workout_name: info?.name || 'Workout',
          set_id: op.payload.id,
          set_index: op.payload.set_index ?? 0,
          weight: Number(op.payload.weight) || 0,
          reps: Number(op.payload.reps) || 0,
          rpe: op.payload.rpe ?? null,
          created_at: op.payload.created_at || new Date().toISOString(),
          total_sessions: 0,
        });
      } else if (op.kind === 'set.update') {
        updatedSets.set(op.payload.id, op.payload.patch);
      } else if (op.kind === 'set.delete') {
        deletedSetIds.add(op.payload.id);
      }
    }

    let combined = [...pendingSets, ...serverRows].filter((s) => !deletedSetIds.has(s.set_id));
    combined = combined.map((s) => {
      const patch = updatedSets.get(s.set_id);
      if (!patch) return s;
      return {
        ...s,
        ...(patch.weight !== undefined ? { weight: Number(patch.weight) || 0 } : {}),
        ...(patch.reps !== undefined ? { reps: Number(patch.reps) || 0 } : {}),
        ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
      };
    });

    if (since) {
      combined = combined.filter((s) => !s.civil_date || s.civil_date >= since);
    }

    // Sort by civil_date descending, then set_index ascending
    combined.sort((a, b) => {
      const dateCmp = (b.civil_date || '').localeCompare(a.civil_date || '');
      if (dateCmp !== 0) return dateCmp;
      return (a.set_index ?? 0) - (b.set_index ?? 0);
    });

    return combined;
  }, [data, exercise, pendingOps, since]);

  const sessionGroups = useMemo(() => {
    const groups: Array<{
      workout_id: string;
      civil_date: string;
      workout_name: string;
      sets: ExerciseHistorySet[];
    }> = [];
    const groupMap = new Map<string, (typeof groups)[0]>();

    for (const row of allRows) {
      let g = groupMap.get(row.workout_id);
      if (!g) {
        g = {
          workout_id: row.workout_id,
          civil_date: row.civil_date,
          workout_name: row.workout_name,
          sets: [],
        };
        groupMap.set(row.workout_id, g);
        groups.push(g);
      }
      g.sets.push(row);
    }
    return groups;
  }, [allRows]);

  const trendPoints = useMemo(() => {
    if (sessionGroups.length < 2) return [];
    const chronological = [...sessionGroups].reverse();
    return chronological.map((g) => {
      const maxW = Math.max(...g.sets.map((s) => s.weight));
      return maxW > 0 ? maxW : 0;
    });
  }, [sessionGroups]);

  // RD-4: Exact PR set determination with tie-breaking (more reps then earliest date, then earliest set)
  const prSetId = useMemo(() => {
    if (prWeight == null || prWeight < 0 || prReps == null || prReps <= 0) return null;
    const matches: Array<{
      setId: string;
      civilDate: string;
      setIndex: number;
      createdAt: string;
    }> = [];

    for (const group of sessionGroups) {
      if (prDate && group.civil_date !== prDate) continue;
      for (let i = 0; i < group.sets.length; i++) {
        const s = group.sets[i];
        if (s.weight === prWeight && s.reps === prReps) {
          matches.push({
            setId: s.set_id || `${group.workout_id}-${i}`,
            civilDate: group.civil_date,
            setIndex: s.set_index > 0 ? s.set_index : i + 1,
            createdAt: s.created_at || '',
          });
        }
      }
    }

    if (matches.length === 0) return null;

    matches.sort((a, b) => {
      const dateCmp = a.civilDate.localeCompare(b.civilDate);
      if (dateCmp !== 0) return dateCmp;
      if (a.setIndex !== b.setIndex) return a.setIndex - b.setIndex;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return matches[0].setId;
  }, [sessionGroups, prWeight, prReps, prDate]);

  const hasPrInfo = (prWeight != null && prWeight > 0) || (prReps != null && prReps > 0);

  return (
    <Sheet
      isOpen={open}
      onClose={onClose}
      title={exercise?.name || 'Exercise History'}
      testId={testId}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Sub-header: Body part Tag & PR Summary */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80">
          <div className="flex items-center gap-2">
            <Tag
              label={exercise?.body_parts?.[0] || 'Full Body'}
              tone="info"
              testId="exercise-sheet-body-part"
            />
            {isReadOnly && (
              <span className="text-xs text-zinc-400 font-semibold bg-zinc-800/80 px-2 py-0.5 rounded-full border border-zinc-700/60">
                Coach View (Read-only)
              </span>
            )}
          </div>
          {hasPrInfo && (() => {
            const calculatedE1rm =
              prMode === 'e1rm'
                ? (prE1rm ??
                  (prWeight != null && prWeight > 0 && prReps != null && prReps <= 12
                    ? e1rm(prWeight, prReps)
                    : null))
                : null;
            const hasE1rm = prMode === 'e1rm' && calculatedE1rm != null && calculatedE1rm > 0;
            const weightStr =
              prWeight && prWeight > 0
                ? formatWeight(prWeight, unit, { showUnit: true })
                : 'Bodyweight';
            const dateStr = prDate ? formatPrDate(prDate) : '';

            return (
              <div
                data-testid="exercise-sheet-pr-summary"
                className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-2xl text-amber-400 text-xs font-bold max-w-full"
              >
                <Trophy className="w-3.5 h-3.5 shrink-0" />
                <span className={hasE1rm ? "flex flex-col sm:inline sm:space-x-1 min-w-0" : "min-w-0"}>
                  {hasE1rm ? (
                    <>
                      <span className="break-words">PR: {weightStr} × {prReps ?? 0}</span>
                      <span className="text-xs font-semibold text-amber-300/90 break-words">
                        {`e1RM ${formatWeight(calculatedE1rm, unit, { showUnit: true })}${dateStr ? ` · ${dateStr}` : ''}`}
                      </span>
                    </>
                  ) : (
                    `PR: ${weightStr} × ${prReps ?? 0}${dateStr ? ` · ${dateStr}` : ''}`
                  )}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Range Selector Chips (D2) */}
        <div
          data-testid="exercise-history-range-chips"
          className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
        >
          {RANGE_CHIPS.map((chip) => (
            <Chip
              key={chip.value}
              label={chip.label}
              selected={range === chip.value}
              onClick={() => setRange(chip.value)}
              testId={`range-chip-${chip.label.toLowerCase()}`}
            />
          ))}
        </div>

        {/* Trend Chart (Inline SVG Polyline) */}
        {trendPoints.length >= 2 && (
          <div
            data-testid="trend-chart-container"
            className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-2xl space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="font-bold uppercase tracking-wider text-zinc-400">
                Best Weight Trend
              </span>
              <span className="tabular-nums">
                {formatWeight(trendPoints[0], unit, { showUnit: true })} → {formatWeight(trendPoints[trendPoints.length - 1], unit, { showUnit: true })}
              </span>
            </div>
            <ExerciseSparkline
              points={trendPoints}
              width={280}
              height={44}
              className="w-full text-cyan-400"
              testId="exercise-history-sparkline"
              unit={unit}
            />
          </div>
        )}

        {/* Error State with Retry */}
        {isError && (
          <StatusBanner
            tone="error"
            title="Failed to load exercise history"
            message={error instanceof Error ? error.message : 'An unexpected error occurred'}
            icon={<AlertCircle className="w-5 h-5 shrink-0 text-rose-400" aria-hidden="true" />}
            testId="exercise-history-error"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => refetch()}
                testId="retry-exercise-history-btn"
              >
                Retry
              </Button>
            }
          />
        )}

        {/* Loading Skeletons */}
        {isPending && (
          <div data-testid="exercise-history-skeleton" className="space-y-3">
            <Skeleton variant="card" count={3} />
          </div>
        )}

        {/* Empty State */}
        {!isPending && !isError && sessionGroups.length === 0 && (
          <div
            data-testid="exercise-history-empty"
            className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-8 text-center text-zinc-400 text-xs"
          >
            No workout sets recorded for this exercise in the selected range.
          </div>
        )}

        {/* Session Groups & Set Rows */}
        {!isPending && !isError && sessionGroups.length > 0 && (
          <div className="space-y-4" data-testid="exercise-history-groups">
            {sessionGroups.map((group) => (
              <div
                key={group.workout_id}
                data-testid={`exercise-session-group-${group.workout_id}`}
                className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-4 space-y-2.5"
              >
                {/* Session Header */}
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-cyan-400 block truncate">
                      {formatSessionDate(group.civil_date)}
                    </span>
                    <h4 className="text-xs font-bold text-white truncate">
                      {group.workout_name || 'Workout Session'}
                    </h4>
                  </div>
                  <span className="text-xs text-zinc-400 shrink-0 tabular-nums">
                    {group.sets.length} {group.sets.length === 1 ? 'set' : 'sets'}
                  </span>
                </div>

                {/* Set Rows */}
                <div className="space-y-1.5">
                  {group.sets.map((set, sIdx) => {
                    const currentSetId = set.set_id || `${group.workout_id}-${sIdx}`;
                    const isPr = prSetId !== null && currentSetId === prSetId;

                    const setLabel = `Set ${set.set_index > 0 ? set.set_index : sIdx + 1}`;
                    const weightText = `${formatWeight(set.weight, unit, { showUnit: true })} × ${set.reps}`;

                    if (!isReadOnly) {
                      return (
                        <button
                          key={set.set_id || sIdx}
                          type="button"
                          onClick={() => {
                            onEditSet?.({
                              id: set.set_id,
                              workout_id: set.workout_id,
                              exercise_id: exercise?.id || '',
                              exercise_name: exercise?.name || '',
                              set_index: set.set_index > 0 ? set.set_index : sIdx + 1,
                              set_type: 'working',
                              weight: set.weight,
                              reps: set.reps,
                              rpe: set.rpe,
                              workout_date: group.civil_date,
                              workout_name: group.workout_name,
                              created_at: set.created_at,
                            });
                          }}
                          data-testid={`exercise-history-set-${set.set_id || sIdx}`}
                          className="w-full min-h-[44px] flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/80 hover:bg-zinc-800/60 border border-zinc-800/60 text-left transition cursor-pointer touch-manipulation group"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-400">{setLabel}</span>
                            <span className="text-xs font-bold text-white tabular-nums">
                              {weightText}
                            </span>
                            {set.rpe != null && (
                              <span className="text-xs text-zinc-400 tabular-nums">
                                @{set.rpe}
                              </span>
                            )}
                            {isPr && (
                              <span
                                data-testid="pr-badge"
                                className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full text-amber-400 text-xs font-bold"
                              >
                                <Trophy className="w-3 h-3 shrink-0" />
                                <span>PR</span>
                              </span>
                            )}
                          </div>
                          <Edit2 className="w-3.5 h-3.5 text-zinc-400 group-hover:text-cyan-400 transition shrink-0" />
                        </button>
                      );
                    }

                    // Coach read-only row (no edit affordance)
                    return (
                      <div
                        key={set.set_id || sIdx}
                        data-testid={`exercise-history-set-${set.set_id || sIdx}`}
                        className="w-full min-h-[44px] flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/60 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-400">{setLabel}</span>
                          <span className="text-xs font-bold text-white tabular-nums">
                            {weightText}
                          </span>
                          {set.rpe != null && (
                            <span className="text-xs text-zinc-400 tabular-nums">@{set.rpe}</span>
                          )}
                          {isPr && (
                            <span
                              data-testid="pr-badge"
                              className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full text-amber-400 text-xs font-bold"
                            >
                              <Trophy className="w-3 h-3 shrink-0" />
                              <span>PR</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Load Older Button */}
            {hasNextPage && (
              <div className="pt-2 flex justify-center">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => fetchNextPage()}
                  isLoading={isFetchingNextPage}
                  testId="load-older-btn"
                  className="w-full"
                >
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
};
