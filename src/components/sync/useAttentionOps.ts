import { retryOp, discardOp, flushNow, type OutboxOp } from '../../offline';
import { useAuth } from '../../hooks/useAuth';
import { useOutboxStatus } from './useOutboxStatus';

export interface UseAttentionOpsResult {
  ops: OutboxOp[];
  count: number;
  retry: (opId: string) => Promise<void>;
  discard: (opId: string) => Promise<void>;
}

/**
 * Hook to retrieve and manage outbox operations that require user attention.
 * Built on useOutboxStatus and outbox manipulation APIs.
 */
export function useAttentionOps(explicitUserId?: string): UseAttentionOpsResult {
  const { user } = useAuth();
  const userId = explicitUserId || user?.id || '';
  const summary = useOutboxStatus(userId);

  const retry = async (opId: string) => {
    if (!userId) return;
    await retryOp(opId, userId);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      flushNow(userId).catch(() => {});
    }
  };

  const discard = async (opId: string) => {
    if (!userId) return;
    await discardOp(opId, userId);
  };

  return {
    ops: summary.needsAttentionOps,
    count: summary.attention,
    retry,
    discard,
  };
}

export default useAttentionOps;
