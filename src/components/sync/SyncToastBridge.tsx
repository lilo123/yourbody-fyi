import React, { useEffect, useRef } from 'react';
import { onSynced } from '../../offline';
import { useToast } from '../../hooks/useToast';

/**
 * Global bridge component mounted once in App.tsx.
 * Subscribes to outbox onSynced events and emits exactly one shell toast per flush.
 * STD-FB-1 / STD-CPY-2: Uses useToast().show({ message, kind: 'success' }).
 *
 * If an Undo toast is active, sync notices are deferred/queued until the Undo toast
 * clears (either via user undo or window expiration) so that the sync notice never
 * replaces the active Undo toast or triggers premature commit of deferred deletes.
 */
export const SyncToastBridge: React.FC = () => {
  const { show, activeToast } = useToast();
  const pendingCountRef = useRef(0);
  const activeToastRef = useRef(activeToast);

  useEffect(() => {
    activeToastRef.current = activeToast;
  }, [activeToast]);

  useEffect(() => {
    const unsubscribe = onSynced((count: number) => {
      if (count > 0) {
        if (activeToastRef.current?.kind === 'undo') {
          pendingCountRef.current += count;
        } else {
          show({
            message: count === 1 ? 'Synced 1 change' : `Synced ${count} changes`,
            kind: 'success',
          });
        }
      }
    });
    return unsubscribe;
  }, [show]);

  useEffect(() => {
    if (activeToast?.kind !== 'undo' && pendingCountRef.current > 0) {
      const count = pendingCountRef.current;
      pendingCountRef.current = 0;
      show({
        message: count === 1 ? 'Synced 1 change' : `Synced ${count} changes`,
        kind: 'success',
      });
    }
  }, [activeToast, show]);

  return null;
};

export default SyncToastBridge;
