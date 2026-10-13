import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useInstallPrompt, syncFirstLogFromQueryClient } from './installPromptStore';
import { InstallPromptCard } from './InstallPromptCard';

export const DeferredInstallPrompt: React.FC = () => {
  const queryClient = useQueryClient();
  const { shouldShowPrompt } = useInstallPrompt();

  // One-time check on mount for returning users whose data is in queryClient
  useEffect(() => {
    syncFirstLogFromQueryClient(queryClient);
  }, [queryClient]);

  if (!shouldShowPrompt) {
    return null;
  }

  return <InstallPromptCard />;
};

export default DeferredInstallPrompt;
