import React, { useState, useEffect, Suspense } from 'react';
import { CreditCard, Sparkles, ExternalLink, AlertCircle } from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useEntitlement, getEntitlementQueryKey } from '../../hooks/useEntitlement';
import { StatusBanner } from '../common/StatusBanner';
import { openBillingPortal } from '../../lib/billing';

const UpgradeSheet = React.lazy(() => import('../billing/UpgradeSheet'));

export const SubscriptionCard: React.FC = () => {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const entitlement = useEntitlement();
  const queryClient = useQueryClient();
  const { show: showToast } = useToast();

  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isManagingBilling, setIsManagingBilling] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const [billingStatus] = useState<'cancelled' | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const param = params.get('billing');
    if (param === 'cancelled') return param;
    return null;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const billingParam = params.get('billing');
    if (!billingParam) return;

    if (billingParam === 'success') {
      showToast({
        message: 'Subscription updated successfully!',
        kind: 'success',
      });
      if (userId) {
        void queryClient.invalidateQueries({ queryKey: getEntitlementQueryKey(userId) });
      }
    }
    params.delete('billing');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }, [userId, queryClient, showToast]);

  const getBadgeLabel = (): 'Coach Pro' | 'Coach' | 'Personal' | 'Trial' | 'Free' => {
    // Pro tier check (paid pro plan)
    if (entitlement.isPro || (entitlement.isPaid && entitlement.plan?.toLowerCase() === 'pro')) {
      if (profile?.coach_tier === 'enterprise') return 'Coach Pro';
      return 'Coach';
    }

    // Personal tier check (paid basic or personal plan)
    if (
      (entitlement.isPaid && entitlement.plan?.toLowerCase() === 'basic') ||
      (entitlement.isPaid && entitlement.plan?.toLowerCase() === 'personal')
    ) {
      return 'Personal';
    }

    // Trial check (unpaid, within trial window)
    if (
      !entitlement.isPaid &&
      entitlement.trialEndsAt &&
      new Date(entitlement.trialEndsAt).getTime() > now
    ) {
      return 'Trial';
    }

    const planLower = entitlement.plan?.toLowerCase() || '';
    if (planLower === 'coach_pro' || planLower === 'enterprise') return 'Coach Pro';
    if (planLower === 'coach') return 'Coach';
    if (planLower === 'pro') {
      return profile?.coach_tier === 'enterprise' ? 'Coach Pro' : 'Coach';
    }
    if (planLower === 'personal' || planLower === 'basic') return 'Personal';
    if (planLower === 'trial') return 'Trial';

    return 'Free';
  };

  const badgeLabel = getBadgeLabel();
  const isCoach = badgeLabel === 'Coach' || badgeLabel === 'Coach Pro';
  const defaultAthleteLimit = badgeLabel === 'Coach Pro' ? 25 : 10;

  // Active athlete count and limit for coaches
  const { data: athleteCount = 0 } = useQuery({
    queryKey: ['coach_active_athletes_count', userId],
    enabled: Boolean(userId && isCoach),
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc('my_coach_limits');
        if (!error && data) {
          const row = Array.isArray(data) ? data[0] : data;
          if (row && typeof row.athlete_count === 'number') {
            return row.athlete_count;
          }
        }
      } catch {
        // fallback
      }
      return 0;
    },
    staleTime: 60 * 1000,
  });

  const athleteLimit = defaultAthleteLimit;

  const handleManageBilling = async () => {
    if (isManagingBilling) return;
    setIsManagingBilling(true);
    setPortalError(null);

    const result = await openBillingPortal();
    if (!result.ok) {
      setPortalError(result.error || 'Unable to open billing portal. Please try again.');
      setIsManagingBilling(false);
    }
  };

  return (
    <div
      data-testid="subscription-card"
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Subscription
          </h3>
        </div>
        <span
          data-testid="subscription-plan-badge"
          className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
            badgeLabel === 'Coach Pro'
              ? 'bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-neon-cyan'
              : badgeLabel === 'Coach'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-neon-cyan'
              : badgeLabel === 'Personal'
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
              : badgeLabel === 'Trial'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
          }`}
        >
          {badgeLabel}
        </span>
      </div>

      {billingStatus === 'cancelled' && (
        <StatusBanner
          message="Checkout was cancelled."
          tone="info"
          testId="billing-status-banner"
        />
      )}

      {portalError && (
        <StatusBanner
          message={portalError}
          tone="error"
          testId="subscription-error-banner"
          icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-white">
            Current plan: <span className="capitalize text-zinc-200">{badgeLabel}</span>
          </div>
          {isCoach && (
            <p
              data-testid="subscription-athletes-count"
              className="text-xs text-zinc-400"
            >
              {athleteCount} / {athleteLimit} athletes
            </p>
          )}
          {entitlement.paidUntil && (
            <p
              data-testid="subscription-active-until"
              className="text-xs text-zinc-400"
            >
              Active until {new Date(entitlement.paidUntil).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!entitlement.isPro && badgeLabel !== 'Coach Pro' && (
            <button
              type="button"
              data-testid="subscription-upgrade-btn"
              onClick={() => setIsUpgradeOpen(true)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-xl shadow-neon-cyan active:scale-95 transition flex items-center justify-center gap-1.5 touch-manipulation cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upgrade</span>
            </button>
          )}

          {entitlement.isPaid && (
            <button
              type="button"
              data-testid="subscription-manage-billing-btn"
              onClick={handleManageBilling}
              disabled={isManagingBilling}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white font-bold text-xs px-4 py-2.5 min-h-[44px] rounded-xl border border-zinc-700 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isManagingBilling ? 'Opening...' : 'Manage billing'}</span>
            </button>
          )}
        </div>
      </div>

      {isUpgradeOpen && (
        <Suspense fallback={null}>
          <UpgradeSheet
            isOpen={isUpgradeOpen}
            onClose={() => setIsUpgradeOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SubscriptionCard;
