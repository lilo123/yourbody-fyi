import React, { useState, useRef, useEffect } from 'react';
import { Trophy } from 'lucide-react';
import { usePrMode, type PrMode } from '../../hooks/usePrMode';
import { SegmentedTabs, type TabItem } from '../common/SegmentedTabs';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

/**
 * Settings card allowing user to toggle PR ranking mode between
 * 'Max weight' (traditional) and 'Estimated 1RM' (Epley formula).
 * Decisions: PR ranking mode profile setting.
 */
export const PrModeCard: React.FC = () => {
  const { mode, setMode, isSaving, error } = usePrMode();
  const [localError, setLocalError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll('button');
    buttons.forEach((btn) => {
      if (!isOnline) {
        btn.setAttribute('disabled', 'true');
        btn.setAttribute('title', 'Available when online');
      } else {
        btn.removeAttribute('disabled');
        btn.removeAttribute('title');
      }
    });
  }, [isOnline]);

  const tabs: TabItem<PrMode>[] = [
    { id: 'weight', label: 'Max weight', testId: 'pr-mode-weight' },
    { id: 'e1rm', label: 'Estimated 1RM', testId: 'pr-mode-e1rm' },
  ];

  const handleTabChange = async (tabId: PrMode) => {
    if (!isOnline || tabId === mode || isSaving) return;
    setLocalError(null);
    try {
      await setMode(tabId);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || 'Failed to update PR mode';
      setLocalError(msg);
    }
  };

  const displayError = localError || error;

  return (
    <div
      data-testid="pr-mode-card"
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Trophy className="w-4 h-4 text-cyan-400" aria-hidden="true" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Personal records
        </h3>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed">
        Choose how personal records are ranked across exercises.
      </p>

      {displayError ? (
        <StatusBanner
          tone="error"
          message={displayError}
          testId="pr-mode-status-banner"
        />
      ) : null}

      {!isOnline && (
        <p className="text-xs text-amber-400 font-semibold" data-testid="offline-helper-text">
          Available when online
        </p>
      )}

      <div ref={containerRef} className={!isOnline ? 'opacity-60 cursor-not-allowed' : ''}>
        <SegmentedTabs<PrMode>
          ariaLabel="Personal record mode"
          tabs={tabs}
          activeTab={mode}
          onChange={(tabId) => void handleTabChange(tabId)}
          className="[&_button]:normal-case [&_button]:tracking-normal"
        />
      </div>
    </div>
  );
};
