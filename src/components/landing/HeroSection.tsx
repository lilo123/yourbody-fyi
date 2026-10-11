import React from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, Sparkles, Shield, Check, Clock } from 'lucide-react';

export const HeroSection: React.FC = () => {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 text-center">
      {/* Offline Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold mb-6">
        <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0" aria-hidden="true" />
        <span>Offline Ready</span>
      </div>

      {/* Main Headline */}
      <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-zinc-50 max-w-3xl mx-auto leading-tight sm:leading-tight">
        Track workouts and meals. Even without signal.
      </h1>

      {/* Subhead */}
      <p className="mt-6 text-sm sm:text-base md:text-lg text-zinc-300 max-w-2xl mx-auto leading-relaxed">
        A fast workout and nutrition tracker that keeps working when your gym has no signal. Log sets in seconds, log meals with AI when you&apos;re online, and coach your athletes if you want to.
      </p>

      {/* CTA Button */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
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
        No credit card required. Free tier includes workout & meal tracking.
      </p>

      {/* Live Logger Mockup Card */}
      <div className="mt-12 max-w-md mx-auto bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl text-left backdrop-blur-xl">
        {/* Mock Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
          <div>
            <div className="text-sm font-bold text-zinc-100">Bench Press & Arms</div>
            <div className="text-xs text-zinc-400">Underground Gym · Offline Mode</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Offline Ready
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
          <span className="text-xs text-zinc-400">Instant on-device save</span>
        </div>
      </div>

      {/* Three Quick Facts */}
      <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
        <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3">
            <WifiOff className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-bold text-zinc-100">Works without Wi-Fi</h2>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            Workout logging, quick log, and on-device parsing save directly on your phone and sync automatically when you&apos;re back online.
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-bold text-zinc-100">AI photo meal logging</h2>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            Snap a photo or describe what you ate in natural words when connected to break down calories and macros automatically.
          </p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-2xl p-5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3">
            <Shield className="w-5 h-5 text-cyan-400" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-bold text-zinc-100">Private & ad-free</h2>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            No third-party advertising trackers and no sold user data. Your workouts and nutrition numbers belong strictly to you.
          </p>
        </div>
      </div>
    </section>
  );
};
