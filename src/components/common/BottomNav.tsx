import React from 'react';
import { NavLink } from 'react-router-dom';
import { Dumbbell, Utensils, History, Settings, BookOpen } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export const BottomNav: React.FC = () => {
  const { user } = useAuth();
  
  if (!user) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/80 px-2 py-2 safe-area-pb">
      <div className="max-w-xl mx-auto flex items-center justify-around">
        <NavLink
          to="/workout"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] py-1 px-2 rounded-xl transition touch-manipulation ${
              isActive
                ? 'text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-zinc-400 hover:text-zinc-200 font-normal'
            }`
          }
          data-testid="nav-workout"
        >
          <Dumbbell className="w-5 h-5 mb-0.5" />
          <span className="text-xs tracking-wider">Workout</span>
        </NavLink>

        <NavLink
          to="/nutrition"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] py-1 px-2 rounded-xl transition touch-manipulation ${
              isActive
                ? 'text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-zinc-400 hover:text-zinc-200 font-normal'
            }`
          }
          data-testid="nav-nutrition"
        >
          <Utensils className="w-5 h-5 mb-0.5" />
          <span className="text-xs tracking-wider">Nutrition</span>
        </NavLink>

        <NavLink
          to="/exercises"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] py-1 px-2 rounded-xl transition touch-manipulation ${
              isActive
                ? 'text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-zinc-400 hover:text-zinc-200 font-normal'
            }`
          }
          data-testid="nav-exercises"
        >
          <BookOpen className="w-5 h-5 mb-0.5" />
          <span className="text-xs tracking-wider">Library</span>
        </NavLink>

        <NavLink
          to="/history"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] py-1 px-2 rounded-xl transition touch-manipulation ${
              isActive
                ? 'text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-zinc-400 hover:text-zinc-200 font-normal'
            }`
          }
          data-testid="nav-history"
        >
          <History className="w-5 h-5 mb-0.5" />
          <span className="text-xs tracking-wider">History</span>
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] py-1 px-2 rounded-xl transition touch-manipulation ${
              isActive
                ? 'text-cyan-400 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-zinc-400 hover:text-zinc-200 font-normal'
            }`
          }
          data-testid="nav-settings"
        >
          <Settings className="w-5 h-5 mb-0.5" />
          <span className="text-xs tracking-wider">Settings</span>
        </NavLink>
      </div>
    </nav>
  );
};
