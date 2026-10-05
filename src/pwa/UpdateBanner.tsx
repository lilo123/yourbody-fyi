import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '../context/AuthContextTypes';
import { useAppUpdate } from './useAppUpdate';
import {
  evaluateUpdateSafety,
  type SoftItem,
  type UpdateSafetyResult,
} from './updateSafety';
import { subscribeToOutbox } from '../offline/outbox';
import { subscribeToAiQueue } from '../offline/aiQueue';
import { workoutSessionStore } from '../utils/workoutSessionStore';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

export const UpdateBanner: React.FC = () => {
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const queryClient = useQueryClient();
  const { updateAvailable, applyUpdate } = useAppUpdate();

  const [safety, setSafety] = useState<UpdateSafetyResult>({ status: 'clear' });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingSoftItems, setPendingSoftItems] = useState<SoftItem[]>([]);

  const checkSafety = useCallback(() => {
    const res = evaluateUpdateSafety({ userId, queryClient });
    setSafety(res);
    return res;
  }, [userId, queryClient]);

  useEffect(() => {
    if (!updateAvailable) {
      return;
    }

    checkSafety();

    const unsubOutbox = subscribeToOutbox(() => {
      checkSafety();
    });

    const unsubAi = userId
      ? subscribeToAiQueue(() => {
          checkSafety();
        }, userId)
      : undefined;

    const intervalId = setInterval(() => {
      checkSafety();
    }, 1000);

    return () => {
      unsubOutbox();
      if (unsubAi) unsubAi();
      clearInterval(intervalId);
    };
  }, [updateAvailable, userId, checkSafety]);

  if (!updateAvailable) {
    return null;
  }

  const isHardBlocked = safety.status === 'hard';

  const handleReloadClick = async () => {
    const check = checkSafety();
    if (check.status === 'hard') {
      return;
    }
    if (check.status === 'soft') {
      setPendingSoftItems(check.items);
      setIsConfirmOpen(true);
      return;
    }
    // Status clear: flush pending writes and reload
    workoutSessionStore.flushPendingWrites();
    await applyUpdate();
  };

  const handleConfirmReload = async () => {
    const check = evaluateUpdateSafety({ userId, queryClient });
    if (check.status === 'hard') {
      // Hard aborts and keeps the banner
      setIsConfirmOpen(false);
      setSafety(check);
      return;
    }
    setIsConfirmOpen(false);
    workoutSessionStore.flushPendingWrites();
    await applyUpdate();
  };

  return (
    <>
      <div
        className="w-full max-w-xl mx-auto px-4 pt-2 pb-1"
        data-testid="update-banner"
      >
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-1 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 px-3 py-1.5 text-xs font-bold"
        >
          <button
            type="button"
            onClick={handleReloadClick}
            disabled={isHardBlocked}
            aria-disabled={isHardBlocked}
            className={`w-full min-h-[44px] flex items-center justify-between gap-2 text-left transition touch-manipulation focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded-lg select-none ${
              isHardBlocked
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:opacity-90 active:scale-[0.99]'
            }`}
            data-testid="update-reload-btn"
            aria-label="Update available. Tap to reload."
          >
            <span className="flex-1 min-w-0 break-words">
              Update available · <span className="underline">Reload</span>
            </span>
          </button>
          {isHardBlocked && safety.reason && (
            <div
              className="text-xs font-normal text-amber-300 break-words pb-1"
              data-testid="update-block-reason"
              role="alert"
            >
              {safety.reason}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Update now?"
        confirmLabel="Reload now"
        cancelLabel="Keep logging"
        isDestructive={true}
        testId="update-confirm-dialog"
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmReload}
        consequence={
          <div className="space-y-1.5" data-testid="update-confirm-consequences">
            {pendingSoftItems.map((item, index) => {
              if (item.kind === 'workout') {
                return (
                  <p key={index}>
                    Your open workout and the values you typed will still be here after the update.
                  </p>
                );
              }
              if (item.kind === 'outbox') {
                return (
                  <p key={index}>
                    {item.count === 1
                      ? '1 change waiting to sync will sync after the update.'
                      : `${item.count} changes waiting to sync will sync after the update.`}
                  </p>
                );
              }
              if (item.kind === 'meal') {
                return (
                  <p key={index}>
                    The meal you&apos;re editing will be lost.
                  </p>
                );
              }
              if (item.kind === 'form') {
                return (
                  <p key={index}>
                    Unsaved form changes will be lost.
                  </p>
                );
              }
              return null;
            })}
          </div>
        }
      />
    </>
  );
};
