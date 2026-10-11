import React from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

export const LandingHeader: React.FC = () => {
  return (
    <header className="bg-zinc-900/90 backdrop-blur-xl border-b border-zinc-800/80 sticky top-0 z-30 pt-[max(env(safe-area-inset-top),12px)] pb-3 shadow-lg">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between">
        {/* Brand */}
        <Link
          to="/"
          aria-label="Yourbody.fyi Home"
          className="flex items-center gap-2 min-w-[44px] min-h-[44px] group"
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-neon-cyan">
            <Zap className="w-4 h-4 text-zinc-950 fill-zinc-950" />
          </div>
          <div className="min-w-0">
            <span className="font-bold tracking-tight text-base sm:text-lg text-zinc-50 leading-none block">
              Yourbody.fyi
            </span>
            <span className="text-xs font-semibold text-cyan-400/80 mt-0.5 block">
              Fitness & Nutrition
            </span>
          </div>
        </Link>

        {/* Quick Links & CTA */}
        <div className="flex items-center gap-1 sm:gap-3">
          <a
            href="#features"
            className="min-h-[44px] min-w-[44px] px-3 hidden sm:inline-flex items-center justify-center text-xs font-semibold text-zinc-300 hover:text-white transition"
          >
            Features
          </a>
          <a
            href="#pricing"
            className="min-h-[44px] min-w-[44px] px-3 hidden sm:inline-flex items-center justify-center text-xs font-semibold text-zinc-300 hover:text-white transition"
          >
            Pricing
          </a>
          <Link
            to="/login"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-zinc-300 hover:text-white transition"
          >
            Sign in
          </Link>
          <Link
            to="/login?mode=signup"
            className="min-h-[44px] min-w-[44px] px-4 py-2 inline-flex items-center justify-center rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-neon-cyan transition active:scale-95 touch-manipulation"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
};
