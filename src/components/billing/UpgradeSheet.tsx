import React, { useState, useId } from 'react';
import { Sparkles, Check, AlertCircle, X } from 'lucide-react';
import { AccessibleModal } from '../common/AccessibleModal';
import { StatusBanner } from '../common/StatusBanner';
import { startCheckout, type CheckoutPlan } from '../../lib/billing';

export interface UpgradeSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpgradeSheet: React.FC<UpgradeSheetProps> = ({ isOpen, onClose }) => {
  const [loadingPlan, setLoadingPlan] = useState<CheckoutPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleId = useId();

  const handleSelectPlan = async (plan: CheckoutPlan) => {
    if (loadingPlan) return;
    setLoadingPlan(plan);
    setErrorMessage(null);

    const result = await startCheckout(plan);
    if (!result.ok) {
      setErrorMessage(result.error || 'Unable to start checkout. Please try again.');
      setLoadingPlan(null);
    }
  };

  const handleClose = () => {
    if (loadingPlan) return;
    setErrorMessage(null);
    onClose();
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId={titleId}
      testId="upgrade-sheet"
      className="w-full sm:max-w-lg max-h-[90vh] sm:rounded-3xl rounded-t-3xl bg-zinc-900 border border-zinc-800 flex flex-col overflow-hidden shadow-2xl safe-area-pb"
    >
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/80 shrink-0">
        <h2 id={titleId} className="text-sm font-bold text-white truncate">
          Choose a Plan
        </h2>
        <button
          type="button"
          aria-label="Close Choose a Plan"
          onClick={handleClose}
          data-testid="upgrade-sheet-close"
          className="inline-flex items-center justify-center rounded-xl transition cursor-pointer select-none active:scale-95 disabled:pointer-events-none disabled:opacity-50 text-zinc-400 hover:text-white hover:bg-zinc-800/60 h-8 w-8 min-h-[44px] min-w-[44px]"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        <p className="text-xs text-zinc-400">
          Upgrade your subscription to unlock additional AI meal parsing and advanced features.
        </p>

        {errorMessage && (
          <StatusBanner
            message={errorMessage}
            tone="error"
            testId="upgrade-sheet-error"
            icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
          />
        )}

        {/* Basic Plan Option */}
        <div
          data-testid="plan-card-basic"
          className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Basic
            </h3>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              Essential
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs text-zinc-300">
            <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Essential AI meal analysis and personal workout tracking.</span>
          </div>
          <button
            type="button"
            data-testid="upgrade-plan-basic-btn"
            onClick={() => handleSelectPlan('basic')}
            disabled={loadingPlan !== null}
            aria-busy={loadingPlan === 'basic' ? 'true' : undefined}
            className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-xl transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation cursor-pointer"
          >
            {loadingPlan === 'basic' ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Redirecting...</span>
              </>
            ) : (
              <span>Select Basic</span>
            )}
          </button>
        </div>

        {/* Pro Plan Option */}
        <div
          data-testid="plan-card-pro"
          className="bg-zinc-950 border border-cyan-500/40 rounded-2xl p-4 space-y-3 relative overflow-hidden"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-cyan-400" aria-hidden="true" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Pro
              </h3>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Recommended
            </span>
          </div>
          <div className="flex items-start gap-2 text-xs text-zinc-300">
            <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span>Full AI meal analysis with higher limits and advanced features.</span>
          </div>
          <button
            type="button"
            data-testid="upgrade-plan-pro-btn"
            onClick={() => handleSelectPlan('pro')}
            disabled={loadingPlan !== null}
            aria-busy={loadingPlan === 'pro' ? 'true' : undefined}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-xl shadow-neon-cyan transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation cursor-pointer"
          >
            {loadingPlan === 'pro' ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                <span>Redirecting...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Select Pro</span>
              </>
            )}
          </button>
        </div>
      </div>
    </AccessibleModal>
  );
};

export default UpgradeSheet;

