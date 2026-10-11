import React from 'react';
import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

export const LandingFooter: React.FC = () => {
  return (
    <footer className="border-t border-zinc-800/80 bg-zinc-950 py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Brand / Copyright */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left gap-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-zinc-950 fill-zinc-950" />
            </div>
            <span className="font-bold text-sm text-zinc-100">Yourbody.fyi</span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Fast workout and nutrition logging for personal lifters and coaches.
          </p>
          <p className="text-xs text-zinc-400">
            © {new Date().getFullYear()} Yourbody.fyi. All rights reserved.
          </p>
        </div>

        {/* Links */}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2">
          <Link
            to="/terms"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-zinc-400 hover:text-cyan-300 transition"
          >
            Terms of Service
          </Link>
          <Link
            to="/privacy"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-zinc-400 hover:text-cyan-300 transition"
          >
            Privacy Policy
          </Link>
          <Link
            to="/refunds"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-zinc-400 hover:text-cyan-300 transition"
          >
            Refund Policy
          </Link>
          <Link
            to="/login"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-zinc-400 hover:text-cyan-300 transition"
          >
            Sign in
          </Link>
          <a
            href="mailto:support@yourbody.fyi"
            className="min-h-[44px] min-w-[44px] px-3 inline-flex items-center justify-center text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition"
          >
            support@yourbody.fyi
          </a>
        </div>
      </div>
    </footer>
  );
};
