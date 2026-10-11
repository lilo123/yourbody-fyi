import React, { useState, useId } from 'react';
import { Sparkles, Check, AlertCircle, X, Shield, Users } from 'lucide-react';
import { AccessibleModal } from '../common/AccessibleModal';
import { StatusBanner } from '../common/StatusBanner';
import { startCheckout, type CheckoutPlan, type CheckoutInterval } from '../../lib/billing';

export interface UpgradeSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PlanDetails {
  plan: CheckoutPlan;
  name: string;
  badge: string;
  monthlyPrice: string;
  yearlyPrice: string;
  bullets: string[];
  testIdCard: string;
  testIdBtn: string;
}

const PLANS: PlanDetails[] = [
  {
    plan: 'personal',
    name: 'Personal',
    badge: 'Essential',
    monthlyPrice: '$2/mo',
    yearlyPrice: '$10/yr',
    bullets: [
      'AI meal logging, 5 a day',
      'Coach up to 3 athletes',
    ],
    testIdCard: 'plan-card-personal',
    testIdBtn: 'upgrade-plan-personal-btn',
  },
  {
    plan: 'coach',
    name: 'Coach',
    badge: 'Recommended',
    monthlyPrice: '$5/mo',
    yearlyPrice: '$40/yr',
    bullets: [
      'AI meal logging, 30 a day',
      'Coach up to 10 athletes',
      'Each athlete gets AI meal logging, 5 a day',
    ],
    testIdCard: 'plan-card-coach',
    testIdBtn: 'upgrade-plan-coach-btn',
  },
  {
    plan: 'coach_pro',
    name: 'Coach Pro',
    badge: 'Pro Roster',
    monthlyPrice: '$10/mo',
    yearlyPrice: '$80/yr',
    bullets: [
      'AI meal logging, 30 a day',
      'Coach up to 25 athletes',
      'Each athlete gets AI meal logging, 5 a day',
    ],
    testIdCard: 'plan-card-coach_pro',
    testIdBtn: 'upgrade-plan-coach_pro-btn',
  },
];

export const UpgradeSheet: React.FC<UpgradeSheetProps> = ({ isOpen, onClose }) => {
  const [interval, setInterval] = useState<CheckoutInterval>('year');
  const [loadingPlan, setLoadingPlan] = useState<CheckoutPlan | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const titleId = useId();

  const handleSelectPlan = async (plan: CheckoutPlan) => {
    if (loadingPlan) return;
    setLoadingPlan(plan);
    setErrorMessage(null);

    const result = await startCheckout({ plan, interval });
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
          Workout and meal tracking, quick log and on-device parsing are free for everyone.
        </p>

        {/* Monthly / Yearly Toggle */}
        <div
          role="radiogroup"
          aria-label="Billing interval"
          className="flex items-center justify-center p-1 bg-zinc-950 border border-zinc-800 rounded-2xl gap-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={interval === 'month'}
            data-testid="interval-toggle-month"
            onClick={() => setInterval('month')}
            disabled={loadingPlan !== null}
            className={`flex-1 min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer touch-manipulation flex items-center justify-center gap-1.5 ${
              interval === 'month'
                ? 'bg-zinc-800 text-white shadow'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
            }`}
          >
            <span>Monthly</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={interval === 'year'}
            data-testid="interval-toggle-year"
            onClick={() => setInterval('year')}
            disabled={loadingPlan !== null}
            className={`flex-1 min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer touch-manipulation flex items-center justify-center gap-1.5 ${
              interval === 'year'
                ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-neon-cyan'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
            }`}
          >
            <span>Yearly</span>
            <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Save ~60%
            </span>
          </button>
        </div>

        {errorMessage && (
          <StatusBanner
            message={errorMessage}
            tone="error"
            testId="upgrade-sheet-error"
            icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
          />
        )}

        {/* Plan Cards */}
        <div className="space-y-3">
          {PLANS.map((planItem) => {
            const isSelectedLoading = loadingPlan === planItem.plan;
            const price = interval === 'year' ? planItem.yearlyPrice : planItem.monthlyPrice;
            const isProOrCoachPro = planItem.plan === 'coach' || planItem.plan === 'coach_pro';

            return (
              <div
                key={planItem.plan}
                data-testid={planItem.testIdCard}
                className={`bg-zinc-950 border rounded-2xl p-4 space-y-3 relative overflow-hidden ${
                  planItem.plan === 'coach_pro'
                    ? 'border-purple-500/40 shadow-lg'
                    : planItem.plan === 'coach'
                    ? 'border-cyan-500/40 shadow-lg'
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {planItem.plan === 'coach_pro' ? (
                      <Shield className="w-4 h-4 text-purple-400" aria-hidden="true" />
                    ) : planItem.plan === 'coach' ? (
                      <Sparkles className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                    ) : (
                      <Users className="w-4 h-4 text-zinc-400" aria-hidden="true" />
                    )}
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      {planItem.name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white tabular-nums">{price}</span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        planItem.plan === 'coach_pro'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : planItem.plan === 'coach'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {planItem.badge}
                    </span>
                  </div>
                </div>

                <ul className="space-y-1.5 text-xs text-zinc-300">
                  {planItem.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <Check
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          planItem.plan === 'coach_pro'
                            ? 'text-purple-400'
                            : planItem.plan === 'coach'
                            ? 'text-cyan-400'
                            : 'text-zinc-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  data-testid={planItem.testIdBtn}
                  onClick={() => handleSelectPlan(planItem.plan)}
                  disabled={loadingPlan !== null}
                  aria-busy={isSelectedLoading ? 'true' : undefined}
                  className={`w-full font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-xl transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation cursor-pointer ${
                    planItem.plan === 'coach_pro'
                      ? 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white shadow-md'
                      : planItem.plan === 'coach'
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-neon-cyan'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                  }`}
                >
                  {isSelectedLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>Redirecting...</span>
                    </>
                  ) : (
                    <>
                      {isProOrCoachPro && <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                      <span>Select {planItem.name}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </AccessibleModal>
  );
};

export default UpgradeSheet;
