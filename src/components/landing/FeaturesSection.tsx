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
              Fast set and rep logging with an optional automatic rest timer. Sets save on your phone first, so logging doesn&apos;t wait for the network. Works without signal when your gym has zero cellular reception, and syncs automatically once you&apos;re back online.
            </p>

            {/* Stylized UI Pattern */}
            <div className="mt-5 bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">Barbell Back Squat</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                  Saved on this phone
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Set 2 · 275 lbs × 5 reps</span>
                <span className="text-cyan-400 font-semibold">Rest: 2:00</span>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Saves on your phone first · Rest timer</span>
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

            {/* Stylized UI Pattern */}
            <div className="mt-5 bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">&quot;Grilled chicken, rice & avocado&quot;</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-semibold">
                  AI Macro Split
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>520 kcal · 48g Protein</span>
                <span>45g Carbs · 14g Fat</span>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Photo & text analysis when online · Macro breakdown</span>
          </div>
        </div>

        {/* Feature 3: Coach Mode */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Users className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              Coach Mode (Optional Power)
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              Built for personal trainers and strength coaches. Manage 3 to 25 athletes from one dashboard, review athlete workout history and daily nutrition macros, and provide your athletes with AI meal logging directly from your coach plan.
            </p>

            {/* Stylized UI Pattern */}
            <div className="mt-5 bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">Trainer Roster (8/10 Athletes)</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-semibold">
                  Active
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Review workout activity & macros</span>
                <span>5 AI meal logs / day each</span>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Roster management · Shared athlete AI allocation</span>
          </div>
        </div>

        {/* Feature 4: Why a web app you can install */}
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
              <Smartphone className="w-6 h-6 text-cyan-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-zinc-100">
              Why a web app you can install
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              A Progressive Web App installs from the browser to your home screen and opens like an app, using minimal device storage. No app store downloads, no large updates, and works seamlessly across iOS and Android.
            </p>

            {/* Stylized UI Pattern */}
            <div className="mt-5 bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">iPhone (Safari)</span>
                <span>Tap Share → &quot;Add to Home Screen&quot;</span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400 border-t border-zinc-800/60 pt-2">
                <span className="font-semibold text-zinc-200">Android (Chrome)</span>
                <span>Tap Menu → &quot;Add to Home screen&quot;</span>
              </div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-zinc-800/60 flex items-center gap-2 text-xs font-semibold text-cyan-300">
            <span>Home screen install · Saves on your phone first</span>
          </div>
        </div>
      </div>
    </section>
  );
};

