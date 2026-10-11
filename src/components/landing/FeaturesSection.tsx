import React from 'react';
import { Dumbbell, Utensils, Users, Smartphone } from 'lucide-react';

export const FeaturesSection: React.FC = () => {
  return (
    <section id="features" className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 border-t border-zinc-800/80">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
          Built for lifters. Ready for coaches.
        </h2>
        <p className="mt-4 text-xs sm:text-sm text-zinc-400">
          Everything you need for daily training and nutrition tracking, designed for speed and reliability.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Feature 1: The Offline Gym Logger */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Dumbbell className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              The Offline Gym Logger
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Fast set and rep logging with zero loading spinners and an automatic rest timer. Works seamlessly in basements and underground gyms with zero cellular service. Sets save instantly to your phone and sync automatically once you&apos;re back online.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Instant on-device saving · Automatic rest timer</span>
          </div>
        </div>

        {/* Feature 2: AI Meal & Macro Logging */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Utensils className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              AI Meal & Macro Logging
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Snap a photo or type naturally like &quot;2 eggs and an apple&quot; when connected. AI automatically breaks down calories, protein, carbs, and fat so you can log nutrition in seconds without tedious manual entry.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Photo & text analysis when online · Macro breakdown</span>
          </div>
        </div>

        {/* Feature 3: Coach Mode (Optional Power) */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Users className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              Coach Mode (Optional Power)
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Built for personal trainers and strength coaches. Manage 3 to 25 athletes from one clean dashboard, check training adherence, and provide your athletes with AI meal logging directly from your coach plan.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Roster management · Shared athlete AI allocation</span>
          </div>
        </div>

        {/* Feature 4: Why PWA (Progressive Web App)? */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Smartphone className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              Why PWA (Progressive Web App)?
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              A Progressive Web App installs directly from your web browser to your home screen like an app, but takes less storage and opens instantly. No app store downloads, no large updates, and works seamlessly across iOS and Android.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Home screen install · Lightweight & instant</span>
          </div>
        </div>
      </div>
    </section>
  );
};
