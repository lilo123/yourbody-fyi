import React, { useContext } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AuthContext } from '../context/AuthContextTypes';

interface LegalLayoutProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({ title, description, children }) => {
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;

  return (
    <div className="max-w-xl w-full mx-auto py-4">
      {/* Top Navigation */}
      <nav aria-label="Legal navigation" className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs">
        <Link
          to={user ? '/settings' : '/login'}
          className="inline-flex items-center gap-1.5 font-semibold text-cyan-400 hover:text-cyan-300 transition py-1"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back to {user ? 'Settings' : 'Sign In'}</span>
        </Link>
        <div className="flex items-center gap-2 font-semibold text-zinc-400">
          <NavLink
            to="/terms"
            className={({ isActive }) =>
              isActive ? 'text-cyan-400 font-bold' : 'hover:text-zinc-200 transition'
            }
          >
            Terms
          </NavLink>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          <NavLink
            to="/privacy"
            className={({ isActive }) =>
              isActive ? 'text-cyan-400 font-bold' : 'hover:text-zinc-200 transition'
            }
          >
            Privacy
          </NavLink>
          <span aria-hidden="true" className="text-zinc-600">·</span>
          <NavLink
            to="/refunds"
            className={({ isActive }) =>
              isActive ? 'text-cyan-400 font-bold' : 'hover:text-zinc-200 transition'
            }
          >
            Refunds
          </NavLink>
        </div>
      </nav>

      {/* Main Legal Content Article */}
      <article className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <header className="border-b border-zinc-800 pb-6 mb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          <p className="text-xs text-zinc-400 mt-2 font-medium">Last updated: 2026-10-10</p>
          {description && (
            <p className="text-sm text-zinc-300 mt-3 leading-relaxed">{description}</p>
          )}
        </header>

        <div className="space-y-8 text-sm text-zinc-300 leading-relaxed">
          {children}
        </div>

        {/* Attribution Footer */}
        <footer className="mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-400 space-y-2">
          <p>
            Adapted from the{' '}
            <a
              href="https://github.com/basecamp/policies"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
            >
              Basecamp open-source policies
            </a>
            , licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
            >
              CC BY 4.0
            </a>
            . Modifications were made to adapt these policies for Yourbody.
          </p>
        </footer>
      </article>
    </div>
  );
};
