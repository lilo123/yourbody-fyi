import React, { useEffect } from 'react';
import { onSynced } from '../../offline';
import { useToast } from '../../hooks/useToast';

/**
 * Global bridge component mounted once in App.tsx.
 * Subscribes to outbox onSynced events and emits exactly one shell toast per flush.
 * STD-FB-1 / STD-CPY-2: Uses useToast().show({ message, kind: 'success' }).
 */
export const SyncToastBridge: React.FC = () => {
  const { show } = useToast();

  useEffect(() => {
    const unsubscribe = onSynced((count: number) => {
      if (count > 0) {
        show({
          message: count === 1 ? 'Synced 1 change' : `Synced ${count} changes`,
          kind: 'success',
        });
      }
    });
    return unsubscribe;
  }, [show]);

  return null;
};

export default SyncToastBridge;
