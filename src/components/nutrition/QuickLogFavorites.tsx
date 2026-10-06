import React, { useState, useMemo, useRef } from 'react';
import type { CustomDish } from '../../types/database';
import { QuickLogDishCard } from './QuickLogDishCard';
import { Star, Plus, Search, X, ChevronDown, ChevronUp } from 'lucide-react';

export interface QuickLogFavoritesProps {
  customDishes: (CustomDish & { notes?: string | null })[];
  onOpenNewDishModal: () => void;
  onStageCustomDish: (dish: CustomDish) => void;
  onOpenEditDishModal: (dish: CustomDish) => void;
  onQuickLogCustomDishDirect: (dish: CustomDish, e: React.MouseEvent) => void;
  onDismissToast: () => void;
  isStaged?: boolean;
  onAddCustomDishToStaged?: (dish: CustomDish) => void;
}

export const QuickLogFavorites: React.FC<QuickLogFavoritesProps> = ({
  customDishes,
  onOpenNewDishModal,
  onStageCustomDish,
  onOpenEditDishModal,
  onQuickLogCustomDishDirect,
  onDismissToast,
  isStaged = false,
  onAddCustomDishToStaged,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sort dishes: use_count desc, created_at desc
  const sortedDishes = useMemo(() => {
    return [...customDishes].sort((a, b) => {
      const countA = a.use_count ?? 0;
      const countB = b.use_count ?? 0;
      if (countB !== countA) {
        return countB - countA;
      }
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [customDishes]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;

  // Search queries the FULL sorted set, never the visible slice (matches name or notes)
  const filteredDishes = useMemo(() => {
    if (!isSearching) return sortedDishes;
    return sortedDishes.filter(
      (dish) =>
        dish.name.toLowerCase().includes(trimmedQuery) ||
        Boolean(dish.notes && dish.notes.toLowerCase().includes(trimmedQuery))
    );
  }, [sortedDishes, isSearching, trimmedQuery]);

  // Determine which dishes to render:
  // - When searching: all matching dishes rendered (bypasses cap)
  // - When expanded: all dishes rendered
  // - When collapsed: top 3 rendered
  const dishesToRender = useMemo(() => {
    if (isSearching) {
      return filteredDishes;
    }
    if (isExpanded) {
      return sortedDishes;
    }
    return sortedDishes.slice(0, 3);
  }, [isSearching, isExpanded, filteredDishes, sortedDishes]);

  // Expander visibility:
  // - > 3 dishes: render expander to toggle between top 3 and full list
  // - <= 3 dishes: no expander needed
  const hasOverflow = sortedDishes.length > 3;

  return (
    <section className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-4 sm:p-5 shadow-2xl space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400 fill-amber-400/20" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            {isStaged ? 'Add to staged meal' : 'Quick Log Favorites'}
          </h3>
          <output
            aria-live="polite"
            className="text-xs font-normal tabular-nums text-zinc-400"
          >
            {isSearching
              ? `(${filteredDishes.length} of ${sortedDishes.length})`
              : `(${sortedDishes.length})`}
          </output>
        </div>

        <button
          type="button"
          onClick={onOpenNewDishModal}
          data-testid="create-custom-dish-btn"
          className="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition px-2 rounded-lg hover:bg-zinc-800/50 touch-manipulation min-h-[44px] min-w-[44px]"
          title="Create New Custom Dish"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Dish</span>
        </button>
      </div>

      {/* Empty State when no custom dishes exist */}
      {sortedDishes.length === 0 ? (
        <p className="text-xs text-zinc-400 py-1">
          No saved custom dishes yet. Create a custom dish or save a logged meal to quick-log it later.
        </p>
      ) : (
        <>
          {/* Controlled Inline Search Input - always visible when dishes exist */}
          <div className="relative shrink-0">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search favorites (e.g. oats, shake, bowl)..."
              aria-label="Search favorite dishes"
              data-testid="search-favorites-input"
              className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl pl-10 pr-12 py-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none transition min-h-[44px]"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-zinc-300 touch-manipulation"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Dish List Container */}
          {isSearching && filteredDishes.length === 0 ? (
            <output
              aria-live="polite"
              className="block py-8 text-center text-zinc-400 text-xs"
            >
              No dishes found matching &quot;{searchQuery}&quot;
            </output>
          ) : (
            <div
              className={`flex flex-col gap-2 pt-1 ${
                isExpanded || isSearching
                  ? 'max-h-[50vh] overflow-y-auto overscroll-contain pr-1'
                  : ''
              }`}
            >
              {dishesToRender.map((dish, index) => {
                return (
                  <div
                    key={dish.id}
                    data-testid={`favorite-row-${index}`}
                  >
                    <QuickLogDishCard
                      dish={dish}
                      onStageCustomDish={onStageCustomDish}
                      onOpenEditDishModal={onOpenEditDishModal}
                      onQuickLogCustomDishDirect={onQuickLogCustomDishDirect}
                      onDismissToast={onDismissToast}
                      isStaged={isStaged}
                      onAddCustomDishToStaged={onAddCustomDishToStaged}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Progressive Disclosure Expander Button - only when > 3 dishes and not searching */}
          {hasOverflow && !isSearching && (
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
              /* Preserved verbatim: data-testid="open-favorites-sheet-btn" for test backwards compatibility */
              data-testid="open-favorites-sheet-btn"
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-zinc-950 hover:bg-zinc-850 border border-border-interactive text-xs font-semibold tabular-nums text-zinc-300 hover:text-white transition touch-manipulation min-h-[44px] group shadow-sm"
            >
              <span className="text-zinc-300 group-hover:text-white">
                {isExpanded
                  ? 'Collapse to top favorites'
                  : `Show all ${sortedDishes.length} favorites`}
              </span>
              <div className="flex items-center gap-1 text-xs font-normal text-zinc-400 group-hover:text-cyan-300">
                <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </div>
            </button>
          )}
        </>
      )}
    </section>
  );
};
