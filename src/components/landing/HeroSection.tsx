import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock } from 'lucide-react';

export const HeroSection: React.FC = () => {
  return (
    <section className="w-full">
      <div
        data-testid="landing-main-container"
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 lg:pb-24"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Messaging & CTAs */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-zinc-50 leading-tight">
              You know your workout. We just help you track it.
            </h1>

            <p className="mt-5 text-sm sm:text-base lg:text-lg text-zinc-300 leading-relaxed max-w-2xl mx-auto lg:mx-0">
              A no-frills log for your lifts and meals. Free forever, with coach mode built in. Your data stays yours.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
              <Link
                to="/login?mode=signup"
                className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-6 py-3.5 inline-flex items-center justify-center rounded-xl text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation"
              >
                Start free
              </Link>
              <Link
                to="/login"
                className="min-h-[44px] min-w-[44px] w-full sm:w-auto px-5 py-3.5 inline-flex items-center justify-center rounded-xl text-sm font-semibold text-zinc-300 hover:text-white bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800 transition touch-manipulation"
              >
                Sign in
              </Link>
            </div>

            <p className="mt-3 text-xs text-zinc-400">
              No credit card required. Free tier includes workout &amp; meal tracking.
            </p>
          </div>

          {/* Right Column: Inline CSS Set-Row Illustration */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="w-full max-w-md bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 sm:p-6 shadow-2xl text-left backdrop-blur-xl">
              {/* Mock Header */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
                <div>
                  <div className="text-sm font-bold text-zinc-100">Bench Press &amp; Arms</div>
                  <div className="text-xs text-zinc-400">Today&apos;s workout</div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
                  Saved
                </span>
              </div>

              {/* Mock Exercise */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-zinc-200">
                  <span>Barbell Bench Press</span>
                  <span className="text-zinc-400">3 sets completed</span>
                </div>

                <div className="bg-zinc-950/70 border border-zinc-800/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span className="font-semibold text-zinc-400">Set 1</span>
                    <span>185 lbs × 8 reps</span>
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span className="font-semibold text-zinc-400">Set 2</span>
                    <span>205 lbs × 6 reps</span>
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-100 font-semibold bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-1.5">
                    <span className="text-cyan-400">Set 3</span>
                    <span>225 lbs × 4 reps</span>
                    <span className="text-cyan-300">Saved</span>
                  </div>
                </div>
              </div>

              {/* Mock Rest Timer Pill */}
              <div className="mt-4 flex items-center justify-between pt-3 border-t border-zinc-800/80">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Rest: 1:30</span>
                </div>
                <span className="text-xs text-zinc-400">Auto rest timer</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
