import React, { useState } from 'react';
import { Card } from '../components/common/Card';
import { useInstallPrompt } from './installPromptStore';
import { X, Download, Share } from 'lucide-react';

export const InstallPromptCard: React.FC = () => {
  const { shouldShowPrompt, isIOSSafari, promptToInstall, dismissPrompt } = useInstallPrompt();
  const [isInstalling, setIsInstalling] = useState(false);

  if (!shouldShowPrompt) {
    return null;
  }

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      await promptToInstall();
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div
      className="w-full max-w-xl mx-auto px-4 pt-2 pb-1"
      data-testid="install-prompt-container"
    >
      <Card
        variant="active"
        testId="install-prompt-card"
        className="flex items-center justify-between gap-3 p-3 text-xs"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            {isIOSSafari ? (
              <Share className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-zinc-100 truncate">Install Yourbody</div>
            {isIOSSafari ? (
              <div className="text-zinc-400 truncate">Tap Share, then Add to Home Screen</div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isIOSSafari && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={isInstalling}
              data-testid="install-prompt-button"
              className="px-3 min-h-[44px] rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition active:scale-95 touch-manipulation flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              Install
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissPrompt()}
            aria-label="Dismiss install prompt"
            data-testid="install-prompt-dismiss"
            className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl text-zinc-400 hover:text-zinc-100 flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </Card>
    </div>
  );
};

export default InstallPromptCard;
