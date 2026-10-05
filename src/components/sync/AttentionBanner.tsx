import React, { useState } from 'react';
import { StatusBanner } from '../common/StatusBanner';
import { useOutboxStatus } from './useOutboxStatus';
import { useAuth } from '../../hooks/useAuth';
import { SyncStatusSheet } from './SyncStatusSheet';
import { AlertTriangle } from 'lucide-react';

export interface AttentionBannerProps {
  className?: string;
}

/**
 * Banner displayed on the Workout tab when one or more outbox operations require user attention.
 * A10: 'N changes need attention · Review', opening SyncStatusSheet.
 */
export const AttentionBanner: React.FC<AttentionBannerProps> = ({ className = '' }) => {
  const { user } = useAuth();
  const { attention } = useOutboxStatus(user?.id);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  if (attention <= 0) return null;

  const countText = `${attention} ${attention === 1 ? 'change needs' : 'changes need'} attention`;

  return (
    <>
      <div className={`mb-3 ${className}`} data-testid="attention-banner-container">
        <StatusBanner
          tone="error"
          testId="attention-banner"
          icon={<AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />}
          message={`${countText} · `}
          action={
            <button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              data-testid="review-attention-btn"
              className="text-xs font-bold text-rose-200 hover:text-white underline underline-offset-2 min-h-[44px] px-2 flex items-center touch-manipulation cursor-pointer"
            >
              Review
            </button>
          }
        />
      </div>

      <SyncStatusSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
      />
    </>
  );
};

export default AttentionBanner;
