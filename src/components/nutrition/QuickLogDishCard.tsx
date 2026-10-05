import React, { memo } from 'react';
import type { CustomDish } from '../../types/database';
import { Plus, Edit2, FileText } from 'lucide-react';
import { getDishIcon } from '../../utils/dishIcons';
import { formatCalories, formatMacro } from '../../utils/nutrition';

export interface QuickLogDishCardProps {
  dish: CustomDish & { notes?: string | null };
  onStageCustomDish: (dish: CustomDish) => void;
  onOpenEditDishModal?: (dish: CustomDish) => void;
  onQuickLogCustomDishDirect: (dish: CustomDish, e: React.MouseEvent) => void;
  onDismissToast?: () => void;
  isStaged?: boolean;
  onAddCustomDishToStaged?: (dish: CustomDish) => void;
}

export const QuickLogDishCard: React.FC<QuickLogDishCardProps> = memo(({
  dish,
  onStageCustomDish,
  onOpenEditDishModal,
  onQuickLogCustomDishDirect,
  onDismissToast,
  isStaged,
  onAddCustomDishToStaged,
}) => {
  const hasNote = Boolean(dish.notes && dish.notes.trim().length > 0);

  const handlePrimaryClick = () => {
    if (isStaged && onAddCustomDishToStaged) {
      onAddCustomDishToStaged(dish);
    } else {
      onStageCustomDish(dish);
    }
  };

  const handlePlusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStaged && onAddCustomDishToStaged) {
      onAddCustomDishToStaged(dish);
    } else {
      onQuickLogCustomDishDirect(dish, e);
    }
  };

  return (
    <article
      aria-labelledby={`dish-name-${dish.id}`}
      className="h-14 min-h-[56px] bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 hover:border-cyan-500/40 rounded-2xl p-2 flex items-center justify-between gap-2 transition shadow-sm group select-none"
    >
      {/* Primary Hit Zone: Staging or Appending the Dish (D33) */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        data-testid={`custom-dish-card-${dish.id}`}
        aria-label={
          isStaged
            ? `Add ${dish.name} to staged meal, ${formatCalories(dish.calories)} calories, ${formatMacro(dish.protein)} grams protein${hasNote ? ', note attached' : ''}`
            : `Stage ${dish.name}, ${formatCalories(dish.calories)} calories, ${formatMacro(dish.protein)} grams protein${hasNote ? ', note attached' : ''}`
        }
        className="flex items-center gap-2.5 min-w-0 flex-1 text-left min-h-[40px] h-10 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-xl touch-manipulation relative before:absolute before:right-0 before:bottom-0 before:min-w-[44px] before:min-h-[44px] before:content-['']"
      >
        <div className="w-7 h-7 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-cyan-500/30 transition-colors">
          {getDishIcon(dish.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <span
              id={`dish-name-${dish.id}`}
              title={dish.name}
              className="text-sm font-semibold text-white group-hover:text-cyan-300 transition truncate block"
            >
              {dish.name}
            </span>
            {hasNote && (
              <span
                title="Has saved note"
                aria-label="Has saved note"
                className="shrink-0 text-cyan-400 inline-flex items-center"
              >
                <FileText className="w-3 h-3" />
              </span>
            )}
          </div>

          <div className="text-xs text-zinc-400 tabular-nums whitespace-nowrap mt-0.5 leading-tight flex items-center gap-1.5">
            <span className="text-amber-400 font-bold">{formatCalories(dish.calories)} kcal</span>
            <span className="text-zinc-600 font-normal">•</span>
            <span className="text-cyan-400 font-semibold">{formatMacro(dish.protein)}g P</span>
          </div>
        </div>
      </button>

      {/* Action Zone: Edit & 1-Tap Quick-Log Buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {onOpenEditDishModal && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismissToast?.();
              onOpenEditDishModal(dish);
            }}
            title="Edit Custom Dish"
            aria-label={`Edit ${dish.name}`}
            data-testid={`edit-dish-btn-${dish.id}`}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800 transition flex items-center justify-center touch-manipulation relative before:absolute before:right-0 before:bottom-0 before:min-w-[44px] before:min-h-[44px] before:content-['']"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handlePlusClick}
          title={isStaged ? 'Add to staged meal' : '1-Tap Log Meal'}
          aria-label={isStaged ? `Add ${dish.name} to staged meal` : `Quick log 1 serving of ${dish.name}`}
          data-testid={`quick-log-btn-${dish.id}`}
          className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 flex items-center justify-center transition active:scale-95 touch-manipulation relative before:absolute before:right-0 before:bottom-0 before:min-w-[44px] before:min-h-[44px] before:content-['']"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
});

QuickLogDishCard.displayName = 'QuickLogDishCard';
