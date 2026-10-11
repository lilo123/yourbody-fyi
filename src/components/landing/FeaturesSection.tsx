import React from 'react';
import { Zap, Dumbbell, Users, Shield } from 'lucide-react';

export const FeaturesSection: React.FC = () => {
  return (
    <section id="features" className="w-full border-t border-zinc-800/80 py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50">
            Built for your training.
          </h2>
          <p className="mt-4 text-xs sm:text-sm text-zinc-400">
            Simple, honest tracking designed around how you actually lift and eat.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* Pillar 1: No frills */}
          <div
            data-testid="pillar-card-0"
            className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
                <Zap className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100 mb-2">
                No frills.
              </h3>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                No programs to buy, no streaks, no feed. Log sets and meals in seconds and get back to training.
              </p>
            </div>
          </div>

          {/* Pillar 2: Free forever */}
          <div
            data-testid="pillar-card-1"
            className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
                <Dumbbell className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100 mb-2">
                Free forever.
              </h3>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                Workout and meal tracking, quick log and coach mode for up to 3 athletes cost nothing, now and later. Paid plans only add AI meal logging and bigger coach rosters.
              </p>
            </div>
          </div>

          {/* Pillar 3: Coach mode */}
          <div
            data-testid="pillar-card-2"
            className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
                <Users className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100 mb-2">
                Coach mode.
              </h3>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                Coach up to 3 athletes free, 10 on Coach, 25 on Coach Pro. See their workouts and macros in one place, and give them AI meal logging on a paid coach plan.
              </p>
            </div>
          </div>

          {/* Pillar 4: Your body, your data */}
          <div
            data-testid="pillar-card-3"
            className="bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5">
                <Shield className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100 mb-2">
                Your body, your data.
              </h3>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                No ads. Your workouts and meals are never sold. Export everything any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
