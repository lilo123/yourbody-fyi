import React, { useState } from 'react';
import { Clock, RefreshCw, Trash2, Edit3, AlertTriangle, ChevronRight } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  discardAiItem,
  getOfflineDb,
  listAiItems,
  notifyAiQueueChanged,
  type AiQueueItem,
  type AiQueueCounts,
} from '../../offline';
import { formatShortDate } from '../../utils/date';

export interface PendingReviewListProps {
  userId: string;
  items: AiQueueItem[];
  counts: AiQueueCounts;
  onReviewItem: (item: AiQueueItem) => void;
  onEnterManually: (item: AiQueueItem) => void;
}

export const PendingReviewList: React.FC<PendingReviewListProps> = ({
  userId,
  items,
  counts,
  onReviewItem,
  onEnterManually,
}) => {
  const isOnline = useOnlineStatus();
  const [itemToConfirmDiscard, setItemToConfirmDiscard] = useState<AiQueueItem | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  if (counts.total === 0) {
    return null;
  }

  const handleRetry = async (item: AiQueueItem) => {
    setRetryingIds((prev) => new Set(prev).add(item.id));
    try {
      const db = await getOfflineDb(userId);
      const existing = await db.get('aiq', item.id);
      if (existing) {
        existing.status = 'queued';
        existing.attempts = 0;
        existing.nextAttemptAt = 0;
        delete existing.lastError;
        await db.put('aiq', existing);
        await listAiItems(userId);
        notifyAiQueueChanged(userId);
      }
    } catch (err) {
      console.warn('[PendingReviewList] Retry error:', err);
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleConfirmDiscard = async (item: AiQueueItem) => {
    try {
      await discardAiItem(userId, item.id);
    } catch (err) {
      console.warn('[PendingReviewList] Discard error:', err);
    } finally {
      setItemToConfirmDiscard(null);
    }
  };

  return (
    <section
      data-testid="pending-review-list"
      aria-label="Pending AI review"
      className="bg-zinc-900/90 border border-cyan-500/40 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <h3
            data-testid="pending-review-title"
            className="text-xs font-bold text-white uppercase tracking-wider"
          >
            {counts.ready > 0 ? `Pending Review (${counts.total})` : `Pending AI Analysis (${counts.total})`}
          </h3>
        </div>
        <div
          data-testid="pending-review-counts"
          className="text-xs text-zinc-400 tabular-nums flex items-center gap-1.5"
        >
          {counts.ready > 0 && (
            <span className="text-emerald-400 font-bold">{counts.ready} ready</span>
          )}
          {counts.queued > 0 && (
            <span className="text-cyan-400">{counts.queued} queued</span>
          )}
          {counts.failed > 0 && (
            <span className="text-rose-400 font-bold">{counts.failed} failed</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => {
          const isDiscardingThis = itemToConfirmDiscard?.id === item.id;
          const isRetryingThis = retryingIds.has(item.id);

          return (
            <div
              key={item.id}
              data-testid={`pending-review-item-${item.id}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      data-testid={`pending-item-kind-${item.id}`}
                      className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-zinc-400"
                    >
                      {item.kind === 'photo' ? 'Photo' : 'Text'}
                    </span>
                    <span
                      data-testid={`pending-item-date-${item.id}`}
                      className="text-xs text-zinc-400 tabular-nums"
                    >
                      {formatShortDate(item.captureDate)}
                    </span>
                  </div>
                  <p
                    data-testid={`pending-item-label-${item.id}`}
                    className="text-sm font-semibold text-white truncate mt-1"
                  >
                    {item.text || (item.kind === 'photo' ? 'Captured meal photo' : 'Meal entry')}
                  </p>
                </div>

                {item.status === 'ready' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-400">Ready to review</span>
                    <button
                      type="button"
                      data-testid={`review-aiq-item-${item.id}`}
                      onClick={() => onReviewItem(item)}
                      className="shrink-0 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs px-3.5 py-2 min-h-[44px] transition shadow-[0_0_12px_rgba(16,185,129,0.3)] active:scale-95 touch-manipulation flex items-center gap-1"
                    >
                      <span>Review</span>
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {(item.status === 'queued' || item.status === 'analyzing') && (
                  <div
                    data-testid={`pending-item-status-${item.id}`}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs font-bold"
                  >
                    {item.status === 'analyzing' ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        <span>Analyzing</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                        <span>{!isOnline ? 'Waiting for connection' : 'Queued'}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {item.status === 'failed' && (
                <div
                  data-testid={`pending-item-failure-${item.id}`}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-xs space-y-2"
                >
                  <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
                    <span>Analysis failed</span>
                  </div>
                  {item.lastError && (
                    <p className="text-xs text-rose-300/80">{item.lastError}</p>
                  )}

                  {isDiscardingThis ? (
                    <div
                      data-testid={`discard-confirm-box-${item.id}`}
                      className="flex items-center gap-2 pt-1 border-t border-rose-500/20"
                    >
                      <span className="text-zinc-300 flex-1">Discard AI Capture?</span>
                      <button
                        type="button"
                        data-testid={`cancel-discard-btn-${item.id}`}
                        onClick={() => setItemToConfirmDiscard(null)}
                        className="px-2.5 py-1.5 min-h-[44px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold transition touch-manipulation flex items-center justify-center"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        data-testid={`confirm-discard-btn-${item.id}`}
                        onClick={() => handleConfirmDiscard(item)}
                        className="px-2.5 py-1.5 min-h-[44px] rounded-lg bg-rose-500/30 hover:bg-rose-500/40 text-rose-200 border border-rose-500/40 text-xs font-bold transition touch-manipulation flex items-center justify-center"
                      >
                        Discard
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <button
                        type="button"
                        data-testid={`retry-aiq-item-${item.id}`}
                        onClick={() => handleRetry(item)}
                        disabled={isRetryingThis}
                        className="px-3 py-1.5 min-h-[44px] rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold transition touch-manipulation flex items-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${isRetryingThis ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>Retry</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`manual-aiq-item-${item.id}`}
                        onClick={() => onEnterManually(item)}
                        className="px-3 py-1.5 min-h-[44px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition touch-manipulation flex items-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Enter manually</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`discard-aiq-item-${item.id}`}
                        onClick={() => setItemToConfirmDiscard(item)}
                        className="px-3 py-1.5 min-h-[44px] rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold transition touch-manipulation flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Discard</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
