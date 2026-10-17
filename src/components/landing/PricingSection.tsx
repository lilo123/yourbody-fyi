import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PRICING_TIERS, type PricingTier } from './pricingData';

export const PricingSection: React.FC = () => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <section id="pricing" className="w-full border-t border-zinc-800/80 py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
            Free to track. Pay only for AI.
          </h2>
          <p className="mt-4 text-xs sm:text-sm text-zinc-400">
            Base features are free for everyone. Paid tiers add continuous AI meal logging and expanded coach rosters.
          </p>

          {/* Monthly / Yearly Toggle */}
          <div className="mt-8 inline-flex items-center p-1 bg-zinc-900 border border-zinc-800 rounded-2xl">
            <button
              type="button"
              onClick={() => setBillingPeriod('monthly')}
              className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold transition touch-manipulation ${
                billingPeriod === 'monthly'
                  ? 'bg-cyan-500 text-zinc-950 shadow-neon-cyan'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingPeriod('yearly')}
              className={`min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold transition touch-manipulation flex items-center gap-1.5 ${
                billingPeriod === 'yearly'
                  ? 'bg-cyan-500 text-zinc-950 shadow-neon-cyan'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Yearly</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                Save up to 58%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {PRICING_TIERS.map((tier: PricingTier) => {
            const isFree = tier.price === 0;
            const cardClass =
              tier.id === 'coach'
                ? 'bg-zinc-900/60 border border-cyan-500/30 rounded-3xl p-6 flex flex-col justify-between relative shadow-lg'
                : 'bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 flex flex-col justify-between';

            return (
              <div
                key={tier.id}
                data-testid="pricing-card"
                className={cardClass}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-zinc-100">{tier.name}</h3>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tier.badgeClass}`}>
                      {tier.badge}
                    </span>
                  </div>
                  <div className="mb-4">
                    {isFree ? (
                      <span className="text-3xl font-bold text-zinc-50">$0</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold text-zinc-50">
                          {billingPeriod === 'yearly' ? tier.yearlyPriceDisplay : tier.monthlyPriceDisplay}
                        </span>
                        <span className="text-xs text-zinc-400 ml-1">
                          {billingPeriod === 'yearly' ? '/year' : '/month'}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                    {tier.description}
                  </p>

                  <ul className="space-y-3 text-xs text-zinc-300 border-t border-zinc-800/80 pt-4">
                    {tier.features.map((feature, featureIndex) => {
                      const featureText = feature.dynamicLabel
                        ? feature.dynamicLabel(billingPeriod)
                        : feature.label;

                      return (
                        <li key={featureIndex} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                          <span>
                            {feature.strongPrefix && <strong>{feature.strongPrefix}</strong>}
                            {featureText}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="mt-8 pt-4">
                  {tier.cta.href ? (
                    <Link
                      to={tier.cta.href}
                      className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation"
                    >
                      {tier.cta.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={tier.cta.disabled}
                      className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-semibold bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 cursor-not-allowed select-none"
                    >
                      {tier.cta.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center text-xs text-zinc-400">
          Base features included in all plans: workout &amp; meal tracking, quick log, on-device parsing.
          Paid plans will become active when billing launches.
        </div>
      </div>
    </section>
  );
};
