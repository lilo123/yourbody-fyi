import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';

export const PricingSection: React.FC = () => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

  return (
    <section id="pricing" className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-zinc-800/80">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
          Simple, honest pricing
        </h2>
        <p className="mt-4 text-xs sm:text-sm text-zinc-400">
          Base features are free for everyone. Paid tiers add higher AI meal quotas and expanded coach rosters.
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Tier 1: Free */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-100">Free</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                Forever
              </span>
            </div>
            <div className="mb-4">
              <span className="text-3xl font-bold text-zinc-50">$0</span>
            </div>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              Full offline workout and meal tracking for personal lifters.
            </p>

            <ul className="space-y-3 text-xs text-zinc-300 border-t border-zinc-800/80 pt-4">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>AI Meal Logging:</strong> 14-day trial (30/day)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Coach Mode:</strong> Up to 3 athletes</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>Unlimited workout & meal tracking</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>Quick log & on-device parsing</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4">
            <Link
              to="/login?mode=signup"
              className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation"
            >
              Start free
            </Link>
          </div>
        </div>

        {/* Tier 2: Personal */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-100">Personal</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                Coming soon
              </span>
            </div>
            <div className="mb-4">
              <span className="text-3xl font-bold text-zinc-50">
                {billingPeriod === 'yearly' ? '$10' : '$2'}
              </span>
              <span className="text-xs text-zinc-400 ml-1">
                {billingPeriod === 'yearly' ? '/year' : '/month'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              For everyday lifters who want continuous daily AI meal logging.
            </p>

            <ul className="space-y-3 text-xs text-zinc-300 border-t border-zinc-800/80 pt-4">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>AI Meal Logging:</strong> 5 / day (photo = 2)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Coach Mode:</strong> Up to 3 athletes</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>All Free tier features included</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>{billingPeriod === 'yearly' ? 'Save ~58% vs monthly' : '$10/yr when billed yearly'}</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4">
            <button
              type="button"
              disabled
              className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-semibold bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 cursor-not-allowed select-none"
            >
              Coming soon
            </button>
          </div>
        </div>

        {/* Tier 3: Coach */}
        <div className="bg-zinc-900/60 border border-cyan-500/30 rounded-3xl p-6 flex flex-col justify-between relative shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-100">Coach</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                Coming soon
              </span>
            </div>
            <div className="mb-4">
              <span className="text-3xl font-bold text-zinc-50">
                {billingPeriod === 'yearly' ? '$40' : '$5'}
              </span>
              <span className="text-xs text-zinc-400 ml-1">
                {billingPeriod === 'yearly' ? '/year' : '/month'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              For trainers managing up to 10 athletes with client AI benefits.
            </p>

            <ul className="space-y-3 text-xs text-zinc-300 border-t border-zinc-800/80 pt-4">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>AI Meal Logging:</strong> 30 / day</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Coach Mode:</strong> Up to 10 athletes</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Athlete AI:</strong> 5 / day each</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>Coach dashboard (activity, macros & routines)</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4">
            <button
              type="button"
              disabled
              className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-semibold bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 cursor-not-allowed select-none"
            >
              Coming soon
            </button>
          </div>
        </div>

        {/* Tier 4: Coach Pro */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-zinc-100">Coach Pro</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                Coming soon
              </span>
            </div>
            <div className="mb-4">
              <span className="text-3xl font-bold text-zinc-50">
                {billingPeriod === 'yearly' ? '$80' : '$10'}
              </span>
              <span className="text-xs text-zinc-400 ml-1">
                {billingPeriod === 'yearly' ? '/year' : '/month'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              For active coaching practices managing up to 25 athletes.
            </p>

            <ul className="space-y-3 text-xs text-zinc-300 border-t border-zinc-800/80 pt-4">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>AI Meal Logging:</strong> 30 / day</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Coach Mode:</strong> Up to 25 athletes</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><strong>Athlete AI:</strong> 5 / day each</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>Coach dashboard (activity, macros & routines)</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4">
            <button
              type="button"
              disabled
              className="min-h-[44px] min-w-[44px] w-full px-4 py-2.5 inline-flex items-center justify-center rounded-xl text-xs font-semibold bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 cursor-not-allowed select-none"
            >
              Coming soon
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 text-center text-xs text-zinc-400">
        Base features included in all plans: unlimited workout & meal tracking, quick log, on-device parsing.
        Paid plans will become active when billing launches.
      </div>
    </section>
  );
};
