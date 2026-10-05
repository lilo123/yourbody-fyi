import React from 'react';
import { Search, Calendar as CalendarIcon } from 'lucide-react';

const CATEGORIES = ['All', 'Chest', 'Back', 'Arms', 'Shoulders', 'Legs', 'Core'];

export interface HistoryToolbarProps {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  selectedCategory: string;
  onSelectedCategoryChange: (category: string) => void;
  onOpenCalendar: () => void;
}

export const HistoryToolbar: React.FC<HistoryToolbarProps> = ({
  searchQuery,
  onSearchQueryChange,
  selectedCategory,
  onSelectedCategoryChange,
  onOpenCalendar,
}) => {
  return (
    <div className="space-y-2" data-testid="history-session-toolbar">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search sessions or exercises..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            aria-label="Search sessions or exercises"
            data-testid="session-search-input"
            className="w-full bg-zinc-950 border border-border-interactive text-white rounded-2xl pl-10 pr-4 py-2.5 text-base min-h-[44px] font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none"
          />
        </div>

        <button
          type="button"
          onClick={onOpenCalendar}
          aria-label="Open calendar"
          data-testid="open-calendar-btn"
          className="min-h-[44px] min-w-[44px] px-3 rounded-2xl bg-zinc-950 border border-border-interactive hover:border-cyan-500/50 text-cyan-400 hover:text-white flex items-center justify-center transition active:scale-95 touch-manipulation cursor-pointer"
        >
          <CalendarIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onSelectedCategoryChange(cat)}
            aria-pressed={selectedCategory === cat}
            className={`px-3.5 py-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-xs font-bold shrink-0 transition touch-manipulation cursor-pointer ${
              selectedCategory === cat
                ? 'bg-cyan-500 text-black shadow-neon-cyan'
                : 'bg-zinc-900 text-zinc-400 hover:text-white border border-border-interactive'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
    </div>
  );
};
