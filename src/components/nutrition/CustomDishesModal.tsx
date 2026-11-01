import React, { memo, useId } from 'react';
import type { CustomDish, CustomDishKind } from '../../types/database';
import { getCustomDishPortion, type NutritionItem } from '../../utils/itemModel';
import { formatCalories, formatMacro } from '../../utils/nutrition';
import { getDishIcon } from '../../utils/dishIcons';
import { Star, X, Trash2, Edit2 } from 'lucide-react';
import { CustomDishEditor } from './CustomDishEditor';
import { NotesField } from './NotesField';
import { AccessibleModal } from '../common/AccessibleModal';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { StatusBanner } from '../common/StatusBanner';

export interface CustomDishesModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingDish: CustomDish | null;
  dishModalKind?: CustomDishKind;
  setDishModalKind?: (val: CustomDishKind) => void;
  dishModalName: string;
  setDishModalName: (val: string) => void;
  dishModalQuantity?: number | '';
  setDishModalQuantity?: (val: number | '') => void;
  dishModalUnit?: string;
  setDishModalUnit?: (val: string) => void;
  onQuantityChange?: (val: number | '', scale?: boolean) => void;
  onUnitChange?: (val: string) => void;
  scaleNutritionWithAmount?: boolean;
  setScaleNutritionWithAmount?: (val: boolean) => void;
  onScaleNutritionChange?: (val: boolean) => void;
  dishModalCalories?: number | '';
  setDishModalCalories?: (val: number | '') => void;
  dishModalProtein?: number | '';
  setDishModalProtein?: (val: number | '') => void;
  dishModalCarbs?: number | '';
  setDishModalCarbs?: (val: number | '') => void;
  dishModalFat?: number | '';
  setDishModalFat?: (val: number | '') => void;
  dishModalFiber?: number | '';
  setDishModalFiber?: (val: number | '') => void;
  dishModalNotes?: string;
  setDishModalNotes?: (val: string) => void;
  dishModalItems: NutritionItem[];
  setDishModalItems: React.Dispatch<React.SetStateAction<NutritionItem[]>>;
  onSaveDish: (e: React.FormEvent) => void;
  onDeleteDish: (dishId: string) => void;
  isSaving: boolean;
  isDeleting: boolean;
  customDishes: CustomDish[];
  onOpenEditDishModal: (dish: CustomDish) => void;
  saveError?: string | null;
}

export const CustomDishesModal: React.FC<CustomDishesModalProps> = memo(({
  isOpen,
  onClose,
  editingDish,
  dishModalName,
  setDishModalName,
  dishModalNotes = '',
  setDishModalNotes = () => {},
  dishModalItems,
  setDishModalItems,
  onSaveDish,
  onDeleteDish,
  isSaving,
  isDeleting,
  customDishes,
  onOpenEditDishModal,
  saveError,
}) => {
  const baseId = useId();
  const nameId = `${baseId}-dish-name`;

  const isOnline = useOnlineStatus();

  const recipeNeedsIngredient = dishModalItems.length === 0;

  const handleClose = () => {
    if (isSaving) {
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="dish-modal-title"
      testId="custom-dish-modal"
      dismissible={!isSaving}
      closeOnBackdropClick={!isSaving}
      className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] max-w-md w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <h3 id="dish-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-400" />
          {editingDish ? 'Edit Custom Dish' : 'New Custom Dish'}
        </h3>
        <button
          type="button"
          onClick={handleClose}
          disabled={isSaving}
          aria-label="Close dialog"
          className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

        {saveError && (
          <StatusBanner
            message={saveError}
            tone="error"
            testId="custom-dish-save-error"
          />
        )}

        <form onSubmit={onSaveDish} className="space-y-3">
          <div>
            <label
              htmlFor={nameId}
              className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
            >
              Dish Name
            </label>
            <input
              id={nameId}
              type="text"
              value={dishModalName}
              onChange={(e) => setDishModalName(e.target.value)}
              placeholder="e.g. Protein Oatmeal"
              className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none min-h-[44px]"
              required
            />
          </div>

          <CustomDishEditor
            key={editingDish?.id ?? 'new'}
            items={dishModalItems}
            onChange={setDishModalItems}
            isEditing={Boolean(editingDish)}
          />

          {recipeNeedsIngredient && (
            <p
              data-testid="recipe-needs-ingredient"
              className="text-xs font-bold text-amber-400"
            >
              Add at least one component.
            </p>
          )}

          <NotesField
            value={dishModalNotes}
            onChange={setDishModalNotes}
          />

          <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
            {editingDish ? (
              <button
                type="button"
                onClick={() => {
                  if (!isOnline) return;
                  onDeleteDish(editingDish.id);
                }}
                data-testid="modal-delete-dish-btn"
                disabled={isDeleting || !isOnline}
                title={!isOnline ? 'Available when online' : undefined}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition flex items-center gap-1.5 touch-manipulation disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                <span>{isDeleting ? 'Deleting...' : 'Delete Dish'}</span>
              </button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              {!isOnline && (
                <span data-testid="offline-helper-text" className="text-xs text-amber-400 font-medium">
                  Available when online
                </span>
              )}
              <button
                type="button"
                onClick={handleClose}
                disabled={isSaving}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition touch-manipulation disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || recipeNeedsIngredient || !isOnline}
                title={!isOnline ? 'Available when online' : undefined}
                className="px-5 py-2 min-h-[44px] rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-black shadow-neon-cyan transition disabled:opacity-50 touch-manipulation"
              >
                {isSaving ? 'Saving...' : 'Save Dish'}
              </button>
            </div>
          </div>
        </form>

        {/* List of existing custom dishes */}
        {customDishes.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-2">
            <span className="text-xs font-bold uppercase text-zinc-400 tracking-wider block">
              Saved Dishes ({customDishes.length})
            </span>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {customDishes.map((dish) => {
                const portion = getCustomDishPortion(dish);
                return (
                  <div
                    key={dish.id}
                    className="bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-white truncate flex items-center gap-2">
                        <div className="w-5 h-5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                          {getDishIcon(dish.name)}
                        </div>
                        <span>{dish.name}</span>
                      </div>
                      <div className="text-xs tabular-nums text-zinc-400 mt-0.5">
                        {portion && (
                          <>
                            <span className="text-zinc-300 font-medium">{portion}</span>
                            <span> • </span>
                          </>
                        )}
                        <span className="text-amber-400 font-bold">{formatCalories(dish.calories)} kcal</span>
                        <span> • </span>
                        <span className="text-cyan-400">P: {formatMacro(dish.protein)}g</span>
                        <span> • </span>
                        <span className="text-emerald-400">C: {formatMacro(dish.carbs)}g</span>
                        <span> • </span>
                        <span className="text-violet-400">F: {formatMacro(dish.fat)}g</span>
                        <span> • </span>
                        <span className="text-teal-400">Fib: {formatMacro(dish.fiber)}g</span>
                      </div>
                    {dish.notes && dish.notes.trim().length > 0 && (
                      <p
                        className="text-xs text-zinc-400 italic line-clamp-1 mt-1"
                        data-testid={`dish-row-note-${dish.id}`}
                      >
                        {dish.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() => {
                        if (!isOnline) return;
                        onOpenEditDishModal(dish);
                      }}
                      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800 rounded-lg transition touch-manipulation disabled:opacity-50"
                      title={!isOnline ? 'Available when online' : 'Edit'}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={!isOnline}
                      onClick={() => {
                        if (!isOnline) return;
                        onDeleteDish(dish.id);
                      }}
                      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition touch-manipulation disabled:opacity-50"
                      title={!isOnline ? 'Available when online' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}
    </AccessibleModal>
  );
});

CustomDishesModal.displayName = 'CustomDishesModal';
