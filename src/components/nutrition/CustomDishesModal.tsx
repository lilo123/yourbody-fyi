import React, { memo, useId } from 'react';
import type { CustomDish, CustomDishKind } from '../../types/database';
import type { NutritionItem } from '../../utils/itemModel';
import { roundTo1Decimal, formatCalories, formatMacro } from '../../utils/nutrition';
import { getDishIcon } from '../../utils/dishIcons';
import { Star, X, Trash2, Edit2 } from 'lucide-react';
import { CustomDishEditor } from './CustomDishEditor';
import { NotesField } from './NotesField';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export interface CustomDishesModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingDish: CustomDish | null;
  dishModalKind?: CustomDishKind;
  setDishModalKind?: (val: CustomDishKind) => void;
  dishModalName: string;
  setDishModalName: (val: string) => void;
  dishModalCalories: number | '';
  setDishModalCalories: (val: number | '') => void;
  dishModalProtein: number | '';
  setDishModalProtein: (val: number | '') => void;
  dishModalCarbs: number | '';
  setDishModalCarbs: (val: number | '') => void;
  dishModalFat: number | '';
  setDishModalFat: (val: number | '') => void;
  dishModalFiber: number | '';
  setDishModalFiber: (val: number | '') => void;
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
}

export const CustomDishesModal: React.FC<CustomDishesModalProps> = memo(({
  isOpen,
  onClose,
  editingDish,
  dishModalKind = 'food',
  setDishModalKind = () => {},
  dishModalName,
  setDishModalName,
  dishModalCalories,
  setDishModalCalories,
  dishModalProtein,
  setDishModalProtein,
  dishModalCarbs,
  setDishModalCarbs,
  dishModalFat,
  setDishModalFat,
  dishModalFiber,
  setDishModalFiber,
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
}) => {
  const baseId = useId();
  const nameId = `${baseId}-dish-name`;
  const calId = `${baseId}-calories`;
  const proteinId = `${baseId}-protein`;
  const carbsId = `${baseId}-carbs`;
  const fatId = `${baseId}-fat`;
  const fiberId = `${baseId}-fiber`;

  const dishModalRef = useModalA11y(isOpen, onClose);
  const isOnline = useOnlineStatus();

  const isFoodDisabled = dishModalKind === 'recipe' && dishModalItems.length > 1;
  const showDirectMacros = dishModalKind !== 'recipe' && dishModalItems.length <= 1;
  // A new recipe derives its totals from its components, so it renders none of
  // the `required` parent-macro inputs. With zero components there is nothing to
  // derive from either, and the form would submit a silent all-zero dish. An
  // existing dish already has macros seeded, so it stays editable.
  const recipeNeedsIngredient =
    !editingDish && dishModalKind === 'recipe' && dishModalItems.length === 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        ref={dishModalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dish-modal-title"
        data-testid="custom-dish-modal"
        className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,1.25rem))] max-w-md w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h3 id="dish-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-400" />
            {editingDish ? 'Edit Custom Dish' : 'New Custom Dish'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-zinc-400 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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

          {/* Dish Type toggle: Food vs Recipe */}
          <div>
            <span
              id={`${baseId}-kind-label`}
              className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
            >
              Dish Type
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`${baseId}-kind-label`}
              className="grid grid-cols-2 gap-2"
            >
              <label
                className={`flex items-center justify-center gap-2 p-2.5 min-h-[44px] rounded-xl border text-xs font-bold transition ${
                  isFoodDisabled
                    ? 'opacity-50 cursor-not-allowed bg-zinc-950/50 border-zinc-800 text-zinc-400'
                    : dishModalKind === 'food'
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300 cursor-pointer'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name={`${baseId}-kind`}
                  value="food"
                  checked={dishModalKind === 'food'}
                  disabled={isFoodDisabled}
                  onChange={() => setDishModalKind('food')}
                  className="accent-cyan-500 min-w-[16px] min-h-[16px]"
                />
                <span>Food</span>
              </label>
              <label
                className={`flex items-center justify-center gap-2 p-2.5 min-h-[44px] rounded-xl border text-xs font-bold cursor-pointer transition ${
                  dishModalKind === 'recipe'
                    ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <input
                  type="radio"
                  name={`${baseId}-kind`}
                  value="recipe"
                  checked={dishModalKind === 'recipe'}
                  onChange={() => setDishModalKind('recipe')}
                  className="accent-cyan-500 min-w-[16px] min-h-[16px]"
                />
                <span>Recipe</span>
              </label>
            </div>
            {isFoodDisabled && (
              <p className="text-xs text-zinc-400 mt-1">
                Remove ingredients first to switch to Food.
              </p>
            )}
          </div>

          {/* Once a dish has a real breakdown its totals are Σ(components);
              showing editable parent macros would invite a value the DB
              sum constraint then rejects. */}
          {showDirectMacros && (
            <div data-testid="parent-macros" className="grid grid-cols-6 sm:grid-cols-5 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <label
                  htmlFor={calId}
                  className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-1"
                >
                  Calories
                </label>
                <input
                  id={calId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={dishModalCalories === '' ? '' : roundTo1Decimal(dishModalCalories)}
                  onChange={(e) =>
                    setDishModalCalories(e.target.value === '' ? '' : roundTo1Decimal(Number(e.target.value)))
                  }
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center min-h-[44px]"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label
                  htmlFor={proteinId}
                  className="block text-xs font-bold text-cyan-400 uppercase tracking-wider mb-1"
                >
                  Protein (g)
                </label>
                <input
                  id={proteinId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={dishModalProtein === '' ? '' : roundTo1Decimal(dishModalProtein)}
                  onChange={(e) =>
                    setDishModalProtein(e.target.value === '' ? '' : roundTo1Decimal(Number(e.target.value)))
                  }
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center min-h-[44px]"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label
                  htmlFor={carbsId}
                  className="block text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1"
                >
                  Carbs (g)
                </label>
                <input
                  id={carbsId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={dishModalCarbs === '' ? '' : roundTo1Decimal(dishModalCarbs)}
                  onChange={(e) =>
                    setDishModalCarbs(e.target.value === '' ? '' : roundTo1Decimal(Number(e.target.value)))
                  }
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center min-h-[44px]"
                  required
                />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label
                  htmlFor={fatId}
                  className="block text-xs font-bold text-violet-400 uppercase tracking-wider mb-1"
                >
                  Fat (g)
                </label>
                <input
                  id={fatId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={dishModalFat === '' ? '' : roundTo1Decimal(dishModalFat)}
                  onChange={(e) =>
                    setDishModalFat(e.target.value === '' ? '' : roundTo1Decimal(Number(e.target.value)))
                  }
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center min-h-[44px]"
                  required
                />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label
                  htmlFor={fiberId}
                  className="block text-xs font-bold text-teal-400 uppercase tracking-wider mb-1"
                >
                  Fiber (g)
                </label>
                <input
                  id={fiberId}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={dishModalFiber === '' ? '' : roundTo1Decimal(dishModalFiber)}
                  onChange={(e) =>
                    setDishModalFiber(e.target.value === '' ? '' : roundTo1Decimal(Number(e.target.value)))
                  }
                  placeholder="0"
                  className="w-full bg-zinc-950 border border-border-interactive text-white rounded-xl p-2 text-base tabular-nums font-bold focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 outline-none text-center min-h-[44px]"
                />
              </div>
            </div>
          )}

          {dishModalKind === 'recipe' && (
            <CustomDishEditor items={dishModalItems} onChange={setDishModalItems} />
          )}

          {recipeNeedsIngredient && (
            <p
              data-testid="recipe-needs-ingredient"
              className="text-xs font-bold text-amber-400"
            >
              Add at least one ingredient, or switch to Food to enter macros directly.
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
                onClick={onClose}
                className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-800 transition touch-manipulation"
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
              {customDishes.map((dish) => (
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
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

CustomDishesModal.displayName = 'CustomDishesModal';
