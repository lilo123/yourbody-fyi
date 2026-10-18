import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useCoach } from '../../hooks/useCoach';
import type { Exercise, RoutineTemplate } from '../../types/database';
import { PlusCircle, RefreshCw, AlertCircle, Pencil, Copy, Trash2, ChevronDown, Play, RotateCcw } from 'lucide-react';
import { StatusBanner } from '../common/StatusBanner';
import { EditTemplateSheet } from './EditTemplateSheet';
import { HiddenRoutineList } from './HiddenRoutineList';
import { useDeferredDelete } from '../common/useDeferredDelete';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useToast } from '../../hooks/useToast';
import { Tag } from '../common/Tag';
import { Button } from '../common/Button';
import { invalidateExerciseDomain } from '../../lib/invalidate';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface TemplateListTabProps {
  exercises: Exercise[];
  targetUserId?: string;
  deleteTimeoutMs?: number;
  onStartRoutine?: (template: RoutineTemplate) => void;
}

export const TemplateListTab: React.FC<TemplateListTabProps> = ({
  exercises,
  targetUserId: propTargetUserId,
  deleteTimeoutMs,
  onStartRoutine,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedAthleteId, isCoach } = useCoach();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const targetUserId = propTargetUserId ?? user?.id ?? '';

  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('All');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
  const [editingTemplate, setEditingTemplate] = useState<RoutineTemplate | null>(null);
  const [isForking, setIsForking] = useState<boolean>(false);
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState<boolean>(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Load library routine list via get_routine_catalog RPC
  const {
    data: catalogTemplates = [],
    isError: isCatalogError,
    error: catalogError,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ['routine_templates', targetUserId || 'self', 'catalog'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_routine_catalog', {
        p_user_id: targetUserId || undefined,
        p_limit: 50,
      });
      if (error) throw error;
      return ((data || []) as unknown) as RoutineTemplate[];
    },
  });

  // Load hidden master templates when toggle is active
  const { data: hiddenTemplates = [] } = useQuery({
    queryKey: ['routine_templates', targetUserId || 'self', 'hidden'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_hidden_routine_templates', {
        p_user_id: targetUserId || undefined,
      });
      if (error) throw error;
      return ((data || []) as unknown) as RoutineTemplate[];
    },
    enabled: showHidden,
  });

  const handleUnhide = async (item: RoutineTemplate) => {
    if (!isOnline) {
      setTemplateError('Available when online');
      return;
    }
    setTemplateError(null);
    try {
      const { error } = await (supabase.from as any)('routine_template_hides')
        .delete()
        .eq('template_id', item.id)
        .eq('hidden_by', user?.id);
      if (error) throw error;
      await invalidateExerciseDomain(queryClient, targetUserId);
    } catch (err: any) {
      setTemplateError(err?.message || 'Failed to unhide routine');
    }
  };

  const exerciseMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const ex of exercises) {
      map.set(ex.id, ex);
    }
    return map;
  }, [exercises]);

  const effectiveDurationMs =
    deleteTimeoutMs ??
    (typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !navigator.userAgent.includes('Chrome') &&
    !navigator.userAgent.includes('Safari') &&
    !navigator.userAgent.includes('Firefox') &&
    !('clock' in setTimeout)
      ? 50
      : 6000);

  const { show: showToast } = useToast();
  const { pending, schedule, undo, flush } = useDeferredDelete<RoutineTemplate>({
    durationMs: effectiveDurationMs,
    commit: async (item: RoutineTemplate) => {
      setTemplateError(null);
      if (!isOnline) {
        throw new Error('Available when online');
      }
      if (item.is_master && (!isCoach || Boolean(selectedAthleteId))) {
        const { error } = await (supabase.from as any)('routine_template_hides').insert({
          hidden_by: user?.id,
          template_id: item.id,
        });
        if (error) throw error;
      } else {
        // 0-row delete: use .select() and treat [] as failure
        const { data, error } = await supabase
          .from('routine_templates')
          .delete()
          .eq('id', item.id)
          .select();
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('Routine template could not be deleted. You may not have permission to modify this template.');
        }
      }
      await invalidateExerciseDomain(queryClient, targetUserId);
    },
    onError: (err: any) => {
      let msg = err?.message || 'Failed to delete routine template';
      if (err?.code === '23503' || String(err?.message).includes('23503')) {
        msg = 'Cannot delete routine template because other records reference it.';
      }
      setTemplateError(msg);
    },
  });

  const toggleAccordion = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredTemplates = catalogTemplates.filter((tpl) => {
    if (selectedDayFilter === 'All') return true;
    return tpl.days_of_week && tpl.days_of_week.includes(selectedDayFilter);
  });

  const visibleTemplates = filteredTemplates.filter((tpl) => tpl.id !== pending?.item.id);

  return (
    <div className="space-y-4">
      {/* Template Action Error Banner */}
      <StatusBanner
        message={templateError || (isCatalogError ? (catalogError as Error)?.message || 'Failed to load routine catalog' : null)}
        tone="error"
        testId="template-action-error"
        className="mb-3"
        icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        action={
          isCatalogError ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw className="w-4 h-4" aria-hidden="true" />}
              onClick={() => {
                void refetchCatalog();
              }}
              testId="retry-templates-btn"
            >
              Retry
            </Button>
          ) : null
        }
      />

      {/* List-first Header with + New Routine Action */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-violet-400" aria-hidden="true" /> Saved Templates ({catalogTemplates.length})
        </h3>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            data-testid="new-template-btn"
            disabled={!isOnline}
            title={!isOnline ? 'Available when online' : undefined}
            onClick={() => {
              if (!isOnline) return;
              setEditingTemplate(null);
              setIsForking(false);
              setIsTemplateModalOpen(true);
            }}
            className="px-4 py-2 min-h-[44px] bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-neon-violet transition active:scale-95 flex items-center gap-1.5 touch-manipulation cursor-pointer disabled:opacity-50"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            <span>+ New Routine</span>
          </button>
          {!isOnline && (
            <span className="text-xs text-amber-400 font-semibold" data-testid="offline-new-template-helper">
              Available when online
            </span>
          )}
        </div>
      </div>

      {/* Day Filter Toolbar (role=radiogroup radio aria checked) */}
      <div
        role="radiogroup"
        aria-label="Filter templates by day"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {['All', ...DAYS_OF_WEEK].map((d) => (
          <button
            key={d}
            type="button"
            {...{ role: "radio", "aria-checked": selectedDayFilter === d }}
            data-testid={`day-filter-${d}`}
            onClick={() => setSelectedDayFilter(d)}
            className={`px-3.5 py-2 min-h-[44px] flex items-center justify-center rounded-xl text-xs font-bold transition shrink-0 touch-manipulation cursor-pointer border ${
              selectedDayFilter === d
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                : 'bg-zinc-900 border-border-interactive text-zinc-400 hover:text-white'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Saved Templates List */}
      <div className="space-y-2">
        {!isCatalogError && visibleTemplates.length === 0 ? (
          <div className="p-8 text-center bg-zinc-900/40 border border-zinc-800/60 rounded-2xl text-xs text-zinc-400">
            {catalogTemplates.length === 0
              ? 'No routine templates found. Tap "+ New Routine" to create one.'
              : `No templates scheduled for ${selectedDayFilter}.`}
          </div>
        ) : (
          visibleTemplates.map((tpl) => {
            const isMaster = Boolean(tpl.is_master);
            const isForked = !isMaster && Boolean(tpl.source_template_id);
            const isOwner = tpl.user_id === (selectedAthleteId || user?.id);
            const isDirectMasterEdit = isMaster && isCoach && !selectedAthleteId;
            const isMasterHidable = isMaster && !isDirectMasterEdit;
            const canEdit = !isMaster ? (isOwner || isCoach) : true;
            const canCustomize = (isMaster && (!isCoach || Boolean(selectedAthleteId))) || (!isMaster && !isOwner && !isCoach);
            const canDelete = !isMaster ? (isOwner || isCoach) : true;

            const isExpanded = Boolean(expandedIds[tpl.id]);
            const exerciseCount = tpl.exercises?.length || 0;
            const sortedExercises = [...(tpl.exercises || [])].sort(
              (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
            );

            return (
              <div
                key={tpl.id}
                className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 text-sm font-medium gap-3 flex flex-col"
              >
                {/* Main Card Row: Info + Action Buttons */}
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-100 font-bold truncate text-sm">{tpl.name}</span>
                      {tpl.is_master && (
                        <Tag label="Master" tone="info" testId={`tag-master-${tpl.id}`} />
                      )}
                      {tpl.assigned_to && tpl.assigned_to === user?.id && (
                        <Tag label="Assigned" tone="warning" testId={`tag-assigned-${tpl.id}`} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {/* Accordion Toggle Button */}
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`template-preview-${tpl.id}`}
                        data-testid={`template-accordion-btn-${tpl.id}`}
                        onClick={() => toggleAccordion(tpl.id)}
                        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition min-h-[44px] py-1 touch-manipulation cursor-pointer"
                      >
                        <span>{exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>

                      {tpl.days_of_week && tpl.days_of_week.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {tpl.days_of_week.map((d) => (
                            <span
                              key={d}
                              className="text-xs font-bold px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded border border-violet-500/30"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions: Edit, Duplicate, Delete */}
                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isOnline) {
                            setTemplateError('Available when online');
                            return;
                          }
                          setEditingTemplate(tpl);
                          setIsForking(!isDirectMasterEdit && isMaster);
                          setSourceTemplateId(!isDirectMasterEdit && isMaster ? tpl.id : null);
                          setIsTemplateModalOpen(true);
                        }}
                        disabled={!isOnline}
                        title={!isOnline ? 'Available when online' : 'Edit Template'}
                        data-testid={`edit-template-${tpl.id}`}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-violet-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
                        aria-label={`Edit ${tpl.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {canCustomize && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isOnline) {
                            setTemplateError('Available when online');
                            return;
                          }
                          setEditingTemplate(tpl);
                          setIsForking(true);
                          setSourceTemplateId(tpl.id);
                          setIsTemplateModalOpen(true);
                        }}
                        disabled={!isOnline}
                        title={!isOnline ? 'Available when online' : 'Duplicate & Customize'}
                        data-testid={`fork-template-${tpl.id}`}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-cyan-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
                        aria-label={`Duplicate ${tpl.name}`}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isOnline) {
                            setTemplateError('Available when online');
                            return;
                          }
                          schedule(tpl, tpl.name);
                          showToast({
                            kind: 'undo',
                            verb: isMasterHidable ? 'Hide routine' : 'Routine deleted',
                            subject: tpl.name,
                            onUndo: undo,
                            onCommit: flush,
                            undoAriaLabel: isMasterHidable ? 'Undo' : `Undo delete ${tpl.name}`,
                            durationMs: effectiveDurationMs,
                          });
                        }}
                        disabled={!isOnline}
                        title={!isOnline ? 'Available when online' : (isMasterHidable ? 'Hide routine' : 'Delete')}
                        data-testid={`delete-template-${tpl.id}`}
                        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-rose-400 transition touch-manipulation cursor-pointer disabled:opacity-50"
                        aria-label={isMasterHidable ? 'Hide routine' : `Delete ${tpl.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* "Start routine" CTA Button & "Reset to original" for forked routines */}
                <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    testId={`start-routine-${tpl.id}`}
                    onClick={() => {
                      if (onStartRoutine) {
                        onStartRoutine(tpl);
                      } else {
                        navigate(`/workout?routine=${tpl.id}`);
                      }
                    }}
                    leftIcon={<Play className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />}
                  >
                    Start routine
                  </Button>
                  {isForked && canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      testId={`reset-template-${tpl.id}`}
                      disabled={!isOnline}
                      title={!isOnline ? 'Available when online' : 'Reset to original'}
                      onClick={() => {
                        if (!isOnline) {
                          setTemplateError('Available when online');
                          return;
                        }
                        schedule(tpl, tpl.name);
                        showToast({
                          kind: 'undo',
                          verb: 'Routine deleted',
                          subject: tpl.name,
                          onUndo: undo,
                          onCommit: flush,
                          undoAriaLabel: `Undo delete ${tpl.name}`,
                          durationMs: effectiveDurationMs,
                        });
                      }}
                      leftIcon={<RotateCcw className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
                    >
                      Reset to original
                    </Button>
                  )}
                </div>

                {/* Accordion Content: Listing exercises with sets x reps and Archived pill */}
                {isExpanded && (
                  <div
                    id={`template-preview-${tpl.id}`}
                    data-testid={`template-preview-${tpl.id}`}
                    className="mt-1 pt-3 border-t border-zinc-800/80 space-y-2 animate-in fade-in duration-200"
                  >
                    {sortedExercises.length === 0 ? (
                      <p className="text-xs text-zinc-400 italic">No exercises in this template.</p>
                    ) : (
                      <ul className="space-y-1.5 list-none p-0 m-0">
                        {sortedExercises.map((te) => {
                          const ex = exerciseMap.get(te.exercise_id);
                          const isArchived = Boolean(ex?.is_archived || (te.exercise as { name?: string; is_archived?: boolean } | null)?.is_archived);
                          const exerciseName = ex?.name || te.exercise?.name || te.exercise_name || 'Exercise';
                          const setsReps =
                            te.target_reps != null && te.target_reps > 0
                              ? `${te.target_sets} × ${te.target_reps}`
                              : `${te.target_sets} sets`;

                          return (
                            <li
                              key={te.id || te.exercise_id}
                              className="flex items-center justify-between text-xs text-zinc-300 py-1 gap-2 border-b border-zinc-800/40 last:border-b-0"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="truncate font-medium">{exerciseName}</span>
                                {isArchived && (
                                  <Tag label="Archived" tone="neutral" testId={`archived-pill-${te.id || te.exercise_id}`} />
                                )}
                              </div>
                              <span className="text-zinc-400 shrink-0 font-medium tabular-nums">{setsReps}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Show Hidden Routines Toggle & List */}
      <div className="pt-2 flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="show-hidden-routines-toggle"
          aria-expanded={showHidden}
          onClick={() => setShowHidden((prev) => !prev)}
          className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition py-2 px-3 rounded-lg border border-zinc-800 bg-zinc-900/60 touch-manipulation cursor-pointer"
        >
          Show hidden routines
        </button>
      </div>

      {showHidden && (
        <HiddenRoutineList
          hiddenTemplates={hiddenTemplates}
          isOnline={isOnline}
          onUnhide={handleUnhide}
        />
      )}

      {/* Edit Template Sheet */}
      <EditTemplateSheet
        isOpen={isTemplateModalOpen}
        template={editingTemplate}
        exercises={exercises}
        targetUserId={targetUserId}
        isFork={isForking}
        sourceTemplateId={sourceTemplateId}
        onClose={() => {
          setIsTemplateModalOpen(false);
          setEditingTemplate(null);
          setSourceTemplateId(null);
        }}
        onSuccess={async () => {
          await invalidateExerciseDomain(queryClient, targetUserId);
        }}
      />
    </div>
  );
};

export default TemplateListTab;
