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

    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      syncFirstLogFromQueryClient(queryClient);
      if (hasLoggedFirstActivity()) {
        unsubscribe();
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
