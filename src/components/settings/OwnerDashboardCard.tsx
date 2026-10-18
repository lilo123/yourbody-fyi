import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { fetchOwnerStats, type OwnerStatsResponse } from '../../lib/ownerStats';

export const OwnerDashboardCard: React.FC = () => {
  const isEnabled = useFeatureFlag('owner_dashboard_enabled');
  const [loading, setLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<OwnerStatsResponse | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let isMounted = true;

    fetchOwnerStats()
      .then((result) => {
        if (!isMounted) return;

        if (result.isForbidden) {
          setIsForbidden(true);
          setLoading(false);
          return;
        }

        if (result.error) {
          setError(result.error.message || 'Failed to load owner statistics');
          setLoading(false);
          return;
        }

        setStats(result.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        console.warn('[OwnerDashboardCard] Failed to fetch owner stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load owner statistics');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isEnabled]);

  // If feature flag is disabled or caller is forbidden (non-owner / secret unset / flag off), render nothing
  if (!isEnabled || isForbidden) {
    return null;
  }

  return (
    <div
      className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4"
      data-testid="owner-dashboard-card"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Owner Dashboard
          </h3>
        </div>
        <span className="text-xs text-zinc-400">
          Today (UTC)
        </span>
      </div>

      {loading && (
        <div className="text-xs text-zinc-400 py-3" data-testid="owner-dashboard-loading">
          Loading statistics...
        </div>
      )}

      {error && !loading && (
        <div className="text-xs text-rose-400 py-2" data-testid="owner-dashboard-error">
          {error}
        </div>
      )}

      {stats && !loading && (
        <div className="space-y-4">
          {/* Tiers Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Paying Users by Tier
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3">
                <div className="text-xs font-bold text-white mb-1">Personal</div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Paid:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.personal.paying}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Grandfathered:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.personal.grandfathered}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between border-t border-zinc-800/60 mt-1 pt-1">
                  <span>Total:</span>
                  <span className="font-semibold text-cyan-400 tabular-nums">{stats.tiers.personal.total}</span>
                </div>
              </div>

              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3">
                <div className="text-xs font-bold text-white mb-1">Coach</div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Paid:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.coach.paying}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Grandfathered:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.coach.grandfathered}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between border-t border-zinc-800/60 mt-1 pt-1">
                  <span>Total:</span>
                  <span className="font-semibold text-cyan-400 tabular-nums">{stats.tiers.coach.total}</span>
                </div>
              </div>

              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3">
                <div className="text-xs font-bold text-white mb-1">Coach Pro</div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Paid:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.coach_pro.paying}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between">
                  <span>Grandfathered:</span>
                  <span className="font-semibold text-white tabular-nums">{stats.tiers.coach_pro.grandfathered}</span>
                </div>
                <div className="text-xs text-zinc-400 flex justify-between border-t border-zinc-800/60 mt-1 pt-1">
                  <span>Total:</span>
                  <span className="font-semibold text-cyan-400 tabular-nums">{stats.tiers.coach_pro.total}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3 flex justify-between items-center">
                <span className="text-xs text-zinc-400">Trial Users</span>
                <span className="text-xs font-bold text-white tabular-nums">{stats.tiers.trial.total}</span>
              </div>
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3 flex justify-between items-center">
                <span className="text-xs text-zinc-400">Free Accounts</span>
                <span className="text-xs font-bold text-white tabular-nums">{stats.tiers.free.total}</span>
              </div>
            </div>
          </div>

          {/* AI Usage Section */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              AI Usage Today (UTC)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3">
                <div className="text-xs text-zinc-400">Total Uses</div>
                <div className="text-base font-bold text-white tabular-nums mt-0.5">
                  {stats.ai_today.total_uses}
                </div>
              </div>
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3">
                <div className="text-xs text-zinc-400">Distinct Users</div>
                <div className="text-base font-bold text-white tabular-nums mt-0.5">
                  {stats.ai_today.distinct_users}
                </div>
              </div>
            </div>

            {stats.ai_today.by_plan && stats.ai_today.by_plan.length > 0 && (
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-2xl p-3 space-y-1.5">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  Uses by Plan
                </div>
                {stats.ai_today.by_plan.map((item) => (
                  <div key={item.plan} className="flex justify-between items-center text-xs">
                    <span className="text-zinc-300 capitalize">{item.plan}</span>
                    <span className="font-semibold text-cyan-400 tabular-nums">{item.uses}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerDashboardCard;
