import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomDishesModal } from './CustomDishesModal';
import { expectNoA11yViolations, expectNoA11yViolationsForRules } from '../../test/a11y';

const mockItem = {
  id: 'item-1',
  name: 'Rolled oats',
  quantity: 80,
  unit: 'g' as const,
  displayPortion: '1 cup',
  calories: 300,
  protein: 10,
  carbs: 54,
  fat: 5,
  fiber: 8,
};

function renderModal(items = [mockItem]) {
  return render(
    <CustomDishesModal
      isOpen={true}
      onClose={vi.fn()}
      editingDish={null}
      dishModalName="Protein Oatmeal"
      setDishModalName={vi.fn()}
      dishModalCalories={300}
      setDishModalCalories={vi.fn()}
      dishModalProtein={10}
      setDishModalProtein={vi.fn()}
      dishModalCarbs={54}
      setDishModalCarbs={vi.fn()}
      dishModalFat={5}
      setDishModalFat={vi.fn()}
      dishModalFiber={8}
      setDishModalFiber={vi.fn()}
      dishModalItems={items}
      setDishModalItems={vi.fn()}
      onSaveDish={vi.fn()}
      onDeleteDish={vi.fn()}
      isSaving={false}
      isDeleting={false}
      customDishes={[]}
      onOpenEditDishModal={vi.fn()}
    />
  );
}

describe('CustomDishesModal', () => {
  it('has no accessibility violations', async () => {
    const { container } = renderModal();
    await expectNoA11yViolations(container);
  });

  it('associates all form labels with their controls', () => {
    renderModal();
    expect(screen.getByLabelText('Dish Name')).toBeDefined();
    expect(screen.getByLabelText(/Component 1 name/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 quantity/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 Calories/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 Protein/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 Carbs/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 Fat/)).toBeDefined();
    expect(screen.getByLabelText(/Component 1 Fiber/)).toBeDefined();
  });

  it('renders two modals simultaneously without duplicate id violations', async () => {
    const { container } = render(
      <div>
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={null}
          dishModalName="Dish 1"
          setDishModalName={vi.fn()}
          dishModalCalories={400}
          setDishModalCalories={vi.fn()}
          dishModalProtein={30}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={50}
          setDishModalCarbs={vi.fn()}
          dishModalFat={8}
          setDishModalFat={vi.fn()}
          dishModalFiber={6}
          setDishModalFiber={vi.fn()}
          dishModalItems={[]}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[]}
          onOpenEditDishModal={vi.fn()}
        />
        <CustomDishesModal
          isOpen={true}
          onClose={vi.fn()}
          editingDish={null}
          dishModalName="Dish 2"
          setDishModalName={vi.fn()}
          dishModalCalories={300}
          setDishModalCalories={vi.fn()}
          dishModalProtein={20}
          setDishModalProtein={vi.fn()}
          dishModalCarbs={40}
          setDishModalCarbs={vi.fn()}
          dishModalFat={6}
          setDishModalFat={vi.fn()}
          dishModalFiber={4}
          setDishModalFiber={vi.fn()}
          dishModalItems={[]}
          setDishModalItems={vi.fn()}
          onSaveDish={vi.fn()}
          onDeleteDish={vi.fn()}
          isSaving={false}
          isDeleting={false}
          customDishes={[]}
          onOpenEditDishModal={vi.fn()}
        />
      </div>
    );
    await expectNoA11yViolationsForRules(container, ['duplicate-id', 'label']);
  });

  it('direct parent macros are never rendered regardless of item count', () => {
    const mockItems = [
      { id: '1', name: 'Item 1', quantity: 100, unit: 'g' as const, calories: 100, protein: 10, carbs: 10, fat: 2, fiber: 1 },
      { id: '2', name: 'Item 2', quantity: 100, unit: 'g' as const, calories: 150, protein: 15, carbs: 15, fat: 3, fiber: 2 },
    ];

    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName="Multi Item Dish"
        setDishModalName={vi.fn()}
        dishModalCalories={250}
        setDishModalCalories={vi.fn()}
        dishModalProtein={25}
        setDishModalProtein={vi.fn()}
        dishModalCarbs={25}
        setDishModalCarbs={vi.fn()}
        dishModalFat={5}
        setDishModalFat={vi.fn()}
        dishModalFiber={3}
        setDishModalFiber={vi.fn()}
        dishModalItems={mockItems}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={[]}
        onOpenEditDishModal={vi.fn()}
      />
    );

    expect(screen.queryByTestId('parent-macros')).toBeNull();
  });

  it('renders CustomDishEditor unconditionally', () => {
    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName="Single Food"
        setDishModalName={vi.fn()}
        dishModalCalories={200}
        setDishModalCalories={vi.fn()}
        dishModalProtein={10}
        setDishModalProtein={vi.fn()}
        dishModalCarbs={20}
        setDishModalCarbs={vi.fn()}
        dishModalFat={5}
        setDishModalFat={vi.fn()}
        dishModalFiber={2}
        setDishModalFiber={vi.fn()}
        dishModalItems={[]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={[]}
        onOpenEditDishModal={vi.fn()}
      />
    );

    expect(screen.getByTestId('custom-dish-editor')).toBeDefined();
  });

  it('renders line-clamp-1 preview of dish notes in the saved dishes list', () => {
    const dishes = [
      {
        id: 'dish-1',
        user_id: 'user-1',
        name: 'Avocado Toast',
        calories: 320,
        protein: 8,
        carbs: 25,
        fat: 18,
        fiber: 6,
        kind: 'food' as const,
        use_count: 2,
        notes: 'Toasted whole wheat sourdough with red pepper flakes',
        created_at: '2026-09-01T12:00:00Z',
      },
      {
        id: 'dish-2',
        user_id: 'user-1',
        name: 'Plain Rice',
        calories: 200,
        protein: 4,
        carbs: 45,
        fat: 0,
        fiber: 1,
        kind: 'food' as const,
        use_count: 1,
        notes: null,
        created_at: '2026-09-01T12:00:00Z',
      },
    ];

    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName=""
        setDishModalName={vi.fn()}
        dishModalCalories=""
        setDishModalCalories={vi.fn()}
        dishModalProtein=""
        setDishModalProtein={vi.fn()}
        dishModalCarbs=""
        setDishModalCarbs={vi.fn()}
        dishModalFat=""
        setDishModalFat={vi.fn()}
        dishModalFiber=""
        setDishModalFiber={vi.fn()}
        dishModalItems={[]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={dishes}
        onOpenEditDishModal={vi.fn()}
      />
    );

    const noteEl = screen.getByTestId('dish-row-note-dish-1');
    expect(noteEl).toBeDefined();
    expect(noteEl.textContent).toBe('Toasted whole wheat sourdough with red pepper flakes');
    expect(noteEl.className).toContain('line-clamp-1');

    // dish-2 has null notes, so no preview is rendered
    expect(screen.queryByTestId('dish-row-note-dish-2')).toBeNull();
  });

  it('integrates NotesField with dishModalNotes and setDishModalNotes', () => {
    const setDishModalNotes = vi.fn();
    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName="Testing notes"
        setDishModalName={vi.fn()}
        dishModalCalories={250}
        setDishModalCalories={vi.fn()}
        dishModalProtein={20}
        setDishModalProtein={vi.fn()}
        dishModalCarbs={30}
        setDishModalCarbs={vi.fn()}
        dishModalFat={5}
        setDishModalFat={vi.fn()}
        dishModalFiber={4}
        setDishModalFiber={vi.fn()}
        dishModalNotes="Existing note on dish"
        setDishModalNotes={setDishModalNotes}
        dishModalItems={[]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={[]}
        onOpenEditDishModal={vi.fn()}
      />
    );

    const textarea = screen.getByTestId('dish-notes-textarea') as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe('Existing note on dish');

    fireEvent.change(textarea, { target: { value: 'Updated note on dish' } });
    expect(setDishModalNotes).toHaveBeenCalledWith('Updated note on dish');
  });

  it('RD-7: invokes onDeleteDish on row delete, and when deletion fails in parent, dish remains rendered in saved dishes list', () => {
    const onDeleteDish = vi.fn();
    const dishes = [
      {
        id: 'dish-keep-1',
        user_id: 'user-1',
        name: 'Protein Bowl',
        calories: 400,
        protein: 30,
        carbs: 45,
        fat: 10,
        fiber: 5,
        kind: 'food' as const,
        use_count: 1,
        notes: null,
        created_at: '2026-09-01T12:00:00Z',
      },
    ];

    const { rerender } = render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName=""
        setDishModalName={vi.fn()}
        dishModalCalories=""
        setDishModalCalories={vi.fn()}
        dishModalProtein=""
        setDishModalProtein={vi.fn()}
        dishModalCarbs=""
        setDishModalCarbs={vi.fn()}
        dishModalFat=""
        setDishModalFat={vi.fn()}
        dishModalFiber=""
        setDishModalFiber={vi.fn()}
        dishModalItems={[]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={onDeleteDish}
        isSaving={false}
        isDeleting={false}
        customDishes={dishes}
        onOpenEditDishModal={vi.fn()}
      />
    );

    const deleteBtn = screen.getByTitle('Delete');
    fireEvent.click(deleteBtn);
    expect(onDeleteDish).toHaveBeenCalledWith('dish-keep-1');

    rerender(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName=""
        setDishModalName={vi.fn()}
        dishModalCalories=""
        setDishModalCalories={vi.fn()}
        dishModalProtein=""
        setDishModalProtein={vi.fn()}
        dishModalCarbs=""
        setDishModalCarbs={vi.fn()}
        dishModalFat=""
        setDishModalFat={vi.fn()}
        dishModalFiber=""
        setDishModalFiber={vi.fn()}
        dishModalItems={[]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={onDeleteDish}
        isSaving={false}
        isDeleting={false}
        customDishes={dishes}
        onOpenEditDishModal={vi.fn()}
      />
    );

    expect(screen.getByText('Protein Bowl')).toBeDefined();
  });

  it('satisfies the touch-target className contract (min-h-[44px]) on remaining interactive controls', () => {
    const dishes = [
      {
        id: 'dish-1',
        user_id: 'user-1',
        name: 'Avocado Toast',
        calories: 320,
        protein: 8,
        carbs: 25,
        fat: 18,
        fiber: 6,
        kind: 'food' as const,
        use_count: 2,
        notes: null,
        created_at: '2026-09-01T12:00:00Z',
      },
    ];

    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={dishes[0]}
        dishModalName="Avocado Toast"
        setDishModalName={vi.fn()}
        dishModalCalories={320}
        setDishModalCalories={vi.fn()}
        dishModalProtein={8}
        setDishModalProtein={vi.fn()}
        dishModalCarbs={25}
        setDishModalCarbs={vi.fn()}
        dishModalFat={18}
        setDishModalFat={vi.fn()}
        dishModalFiber={6}
        setDishModalFiber={vi.fn()}
        dishModalItems={[mockItem]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={dishes}
        onOpenEditDishModal={vi.fn()}
      />
    );

    // Modal action buttons
    expect(screen.getByLabelText('Close dialog').className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /save dish/i }).className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: /cancel/i }).className).toContain('min-h-[44px]');
    expect(screen.getByTestId('modal-delete-dish-btn').className).toContain('min-h-[44px]');

    // Dish Name input
    expect(screen.getByLabelText('Dish Name').className).toContain('min-h-[44px]');

    // Component controls
    expect(screen.getByTestId('dish-add-item').className).toContain('min-h-[44px]');
    expect(screen.getByTestId('dish-item-name').className).toContain('min-h-[44px]');
    expect(screen.getByTestId('dish-item-remove').className).toContain('min-h-[44px]');
    expect(screen.getByTestId('dish-item-quantity').className).toContain('min-h-[44px]');
    expect(screen.getByTestId('dish-item-calories').className).toContain('min-h-[44px]');

    // Saved dish row buttons
    expect(screen.getByTitle('Edit').className).toContain('min-h-[44px]');
    expect(screen.getByTitle('Delete').className).toContain('min-h-[44px]');
  });

  it('renders save error in StatusBanner when saveError is provided', () => {
    render(
      <CustomDishesModal
        isOpen={true}
        onClose={vi.fn()}
        editingDish={null}
        dishModalName="Protein Oatmeal"
        setDishModalName={vi.fn()}
        dishModalCalories={300}
        setDishModalCalories={vi.fn()}
        dishModalProtein={10}
        setDishModalProtein={vi.fn()}
        dishModalCarbs={54}
        setDishModalCarbs={vi.fn()}
        dishModalFat={5}
        setDishModalFat={vi.fn()}
        dishModalFiber={8}
        setDishModalFiber={vi.fn()}
        dishModalItems={[mockItem]}
        setDishModalItems={vi.fn()}
        onSaveDish={vi.fn()}
        onDeleteDish={vi.fn()}
        isSaving={false}
        isDeleting={false}
        customDishes={[]}
        onOpenEditDishModal={vi.fn()}
        saveError="Failed to save custom dish: Server error"
      />
    );

    const errorBanner = screen.getByTestId('custom-dish-save-error');
    expect(errorBanner).toBeDefined();
    expect(errorBanner.textContent).toContain('Failed to save custom dish: Server error');
  });
});


