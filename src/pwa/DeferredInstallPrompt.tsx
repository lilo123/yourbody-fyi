import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useInstallPrompt,
  syncFirstLogFromQueryClient,
  hasLoggedFirstActivity,
} from './installPromptStore';
import { InstallPromptCard } from './InstallPromptCard';

export const DeferredInstallPrompt: React.FC = () => {
  const queryClient = useQueryClient();
  const { shouldShowPrompt } = useInstallPrompt();

  // Sync first log from queryClient on mount or as queries resolve for returning users
  useEffect(() => {
    syncFirstLogFromQueryClient(queryClient);
    if (hasLoggedFirstActivity()) {
      return;
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        (event.query?.queryKey?.[0] === 'workout_sets' ||
          event.query?.queryKey?.[0] === 'nutrition_logs')
      ) {
        syncFirstLogFromQueryClient(queryClient);
        if (hasLoggedFirstActivity()) {
          unsubscribe();
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  if (!shouldShowPrompt) {
    return null;
  }

  return <InstallPromptCard />;
};

export default DeferredInstallPrompt;
