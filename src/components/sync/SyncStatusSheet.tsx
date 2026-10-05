import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../common/Sheet';
import { Button } from '../common/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { type OutboxOp } from '../../offline';
import { useOutboxStatus } from './useOutboxStatus';
import { useAttentionOps } from './useAttentionOps';
import { useAuth } from '../../hooks/useAuth';
import { formatWeight } from '../../utils/weight';
import { RefreshCw, Trash2, AlertTriangle, CloudOff, LogIn, CheckCircle2 } from 'lucide-react';

export interface SyncStatusSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatOpKind(op: OutboxOp): string {
  switch (op.kind) {
    case 'set.create':
      return `Create set (${formatWeight(op.payload.weight)} × ${op.payload.reps})`;
    case 'set.update':
      return 'Update set';
    case 'set.delete':
      return 'Delete set';
    case 'workout.ensure':
      return `Workout (${op.payload.workout_date})`;
    case 'workout.rename':
      return `Rename workout to "${op.payload.name}"`;
    default:
      return 'Workout change';
  }
}

function formatOpTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoString;
  }
}

export const SyncStatusSheet: React.FC<SyncStatusSheetProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const summary = useOutboxStatus(user?.id);
  const { ops: attentionOps, retry, discard } = useAttentionOps(user?.id);

  const [discardingOpId, setDiscardingOpId] = useState<string | null>(null);
  const [isRetryingId, setIsRetryingId] = useState<string | null>(null);

  const handleRetry = async (opId: string) => {
    setIsRetryingId(opId);
    try {
      await retry(opId);
    } finally {
      setIsRetryingId(null);
    }
  };

  const handleConfirmDiscard = async () => {
    if (!discardingOpId) return;
    const opId = discardingOpId;
    setDiscardingOpId(null);
    await discard(opId);
  };

  const handleSignIn = () => {
    onClose();
    navigate('/login');
  };

  return (
    <>
      <Sheet
        isOpen={isOpen}
        onClose={onClose}
        title="Sync status"
        testId="sync-status-sheet"
      >
        <div className="space-y-4">
          {/* Auth Required Row */}
          {summary.authRequired && (
            <div
              data-testid="auth-required-row"
              className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <LogIn className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="font-semibold text-amber-300">
                  Sign in to sync your changes
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={handleSignIn}
                testId="sync-sheet-sign-in-btn"
                className="shrink-0"
              >
                Sign in
              </Button>
            </div>
          )}

          {/* Pending Changes Summary Card */}
          <div
            data-testid="pending-summary-card"
            className="p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              {summary.pending > 0 ? (
                <CloudOff className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              )}
              <div>
                <div className="text-xs font-bold text-white">
                  {summary.pending > 0
                    ? `${summary.pending} ${summary.pending === 1 ? 'change' : 'changes'} pending`
                    : 'All changes synced'}
                </div>
                <div className="text-xs text-zinc-400">
                  {summary.syncing
                    ? 'Syncing in progress...'
                    : summary.pending > 0
                    ? 'Changes will sync automatically when online'
                    : 'Your device is up to date with the server'}
                </div>
              </div>
            </div>
            {summary.pending > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 tabular-nums">
                {summary.pending}
              </span>
            )}
          </div>

          {/* Needs Attention Section */}
          {attentionOps.length > 0 && (
            <div className="space-y-3" data-testid="needs-attention-section">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Needs attention ({attentionOps.length})
                </h3>
              </div>

              <div className="space-y-2">
                {attentionOps.map((op) => (
                  <div
                    key={op.opId}
                    data-testid={`attention-item-${op.opId}`}
                    className="p-3.5 rounded-2xl bg-zinc-950/80 border border-amber-500/30 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {formatOpKind(op)}
                        </div>
                        <div className="text-xs text-zinc-400 tabular-nums mt-0.5">
                          {formatOpTime(op.createdAt)}
                        </div>
                      </div>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 shrink-0">
                        Attention
                      </span>
                    </div>

                    <div className="text-xs text-rose-300/90 break-words bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                      {op.error || 'Server error or conflict encountered.'}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-800/60">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setDiscardingOpId(op.opId)}
                        testId={`discard-op-btn-${op.opId}`}
                        aria-label={`Discard ${formatOpKind(op)}`}
                        className="min-h-[44px]"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                        <span>Discard</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRetry(op.opId)}
                        disabled={isRetryingId === op.opId}
                        testId={`retry-op-btn-${op.opId}`}
                        aria-label={`Retry ${formatOpKind(op)}`}
                        className="min-h-[44px]"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 mr-1 ${isRetryingId === op.opId ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>{isRetryingId === op.opId ? 'Retrying...' : 'Retry'}</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>

      {/* Discard Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(discardingOpId)}
        onCancel={() => setDiscardingOpId(null)}
        onConfirm={() => void handleConfirmDiscard()}
        title="Discard change?"
        consequence="This change will be permanently removed from your sync queue and will not be applied to the server."
        confirmLabel="Discard change"
        cancelLabel="Keep change"
        isDestructive={true}
        testId="discard-confirm-dialog"
      />
    </>
  );
};

export default SyncStatusSheet;
