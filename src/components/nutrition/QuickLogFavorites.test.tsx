import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickLogFavorites } from './QuickLogFavorites';
import type { CustomDish } from '../../types/database';

function createMockDish(overrides: Partial<CustomDish & { notes?: string | null }> = {}): CustomDish & { notes?: string | null } {
  return {
    id: 'dish-1',
    user_id: 'test-user',
    name: 'Protein Oatmeal',
    calories: 420,
    protein: 35,
    carbs: 55,
    fat: 6,
    fiber: 8,
    created_at: '2026-03-01T10:00:00Z',
    kind: 'recipe',
    use_count: 5,
    notes: 'with blueberries and whey',
    ...overrides,
  };
}
describe('QuickLogFavorites (Horizontal Bar Redesign)', () => {

  // PART A Unit Test (1): 3 shown by default when there are 5
  it('(1) 3 shown by default when there are 5', () => {
    const dishes = Array.from({ length: 5 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: `Dish ${i + 1}`,
        use_count: 10 - i,
      })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Only top 3 dishes should be rendered in collapsed state
    for (let i = 1; i <= 3; i++) {
      expect(screen.getByTestId(`custom-dish-card-dish-${i}`)).toBeDefined();
    }
    // Dishes beyond top 3 must NOT be rendered in collapsed state
    expect(screen.queryByTestId('custom-dish-card-dish-4')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-5')).toBeNull();

    // Expander button is present and indicates 5 total favorites
    const expandBtn = screen.getByTestId('open-favorites-sheet-btn');
    expect(expandBtn).toBeDefined();
    expect(expandBtn.textContent).toContain('Show all 5 favorites');

    // Click expander: renders all 5 dishes
    fireEvent.click(expandBtn);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`custom-dish-card-dish-${i}`)).toBeDefined();
    }
    expect(expandBtn.textContent).toContain('Collapse to top favorites');

    // Click expander again: collapses back to top 3
    fireEvent.click(expandBtn);
    expect(screen.getByTestId('custom-dish-card-dish-1')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-2')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-3')).toBeDefined();
    expect(screen.queryByTestId('custom-dish-card-dish-4')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-5')).toBeNull();
  });

  it('renders clean empty state when no custom dishes exist', () => {
    render(
      <QuickLogFavorites
        customDishes={[]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    expect(screen.getByText(/No saved custom dishes yet/i)).toBeDefined();
    expect(screen.queryByTestId('open-favorites-sheet-btn')).toBeNull();
    expect(screen.queryByTestId('search-favorites-input')).toBeNull();
  });

  it('satisfies touch-target className contract (min-h-[44px] min-w-[44px]) on create-custom-dish-btn and triggers modal', () => {
    const onOpenNewDishModal = vi.fn();
    render(
      <QuickLogFavorites
        customDishes={[]}
        onOpenNewDishModal={onOpenNewDishModal}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const createBtn = screen.getByTestId('create-custom-dish-btn');
    expect(createBtn).toBeDefined();
    expect(createBtn.className).toContain('min-h-[44px]');
    expect(createBtn.className).toContain('min-w-[44px]');

    fireEvent.click(createBtn);
    expect(onOpenNewDishModal).toHaveBeenCalledTimes(1);
  });

  it('resolves NEW-10 defect: primary card button carries staging onClick without nested buttons', () => {
    const onStageCustomDish = vi.fn();
    const dish = createMockDish({ id: 'dish-new-10', name: 'Clean Salmon' });

    render(
      <QuickLogFavorites
        customDishes={[dish]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={onStageCustomDish}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const stagingCardBtn = screen.getByTestId('custom-dish-card-dish-new-10');
    // Staging button is a semantic <button>
    expect(stagingCardBtn.tagName.toLowerCase()).toBe('button');
    // No nested buttons exist inside the staging button
    expect(stagingCardBtn.querySelectorAll('button').length).toBe(0);

    // Clicking stages dish
    fireEvent.click(stagingCardBtn);
    expect(onStageCustomDish).toHaveBeenCalledWith(dish);
  });

  it('renders notes affordance icon and includes note in aria-label when dish has notes', () => {
    const dishWithNotes = createMockDish({
      id: 'dish-notes',
      name: 'Greek Yogurt Bowl',
      notes: 'Contains chia seeds & honey',
    });

    render(
      <QuickLogFavorites
        customDishes={[dishWithNotes]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const card = screen.getByTestId('custom-dish-card-dish-notes');
    const ariaLabel = card.getAttribute('aria-label') || '';
    expect(ariaLabel.includes('note attached')).toBe(true);

    const noteIcons = screen.getAllByLabelText('Has saved note');
    expect(noteIcons.length).toBeGreaterThan(0);
  });

  it('triggers edit modal and 1-tap quick log from dish card action buttons', () => {
    const onOpenEditDishModal = vi.fn();
    const onQuickLogCustomDishDirect = vi.fn();
    const dish = createMockDish({ id: 'dish-actions', name: 'Steak & Rice' });

    render(
      <QuickLogFavorites
        customDishes={[dish]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={onOpenEditDishModal}
        onQuickLogCustomDishDirect={onQuickLogCustomDishDirect}
        onDismissToast={vi.fn()}
      />
    );

    const editBtn = screen.getByTestId('edit-dish-btn-dish-actions');
    fireEvent.click(editBtn);
    expect(onOpenEditDishModal).toHaveBeenCalledWith(dish);

    const quickLogBtn = screen.getByTestId('quick-log-btn-dish-actions');
    fireEvent.click(quickLogBtn);
    expect(onQuickLogCustomDishDirect).toHaveBeenCalled();
  });

  it('sorts dishes strictly by use_count desc, then created_at desc without pin UI', () => {
    const dishA = createMockDish({ id: 'dish-a', name: 'Dish A', use_count: 3, created_at: '2026-03-01T00:00:00Z' });
    const dishB = createMockDish({ id: 'dish-b', name: 'Dish B', use_count: 10, created_at: '2026-02-01T00:00:00Z' });
    const dishC = createMockDish({ id: 'dish-c', name: 'Dish C', use_count: 5, created_at: '2026-03-05T00:00:00Z' });
    const dishD = createMockDish({ id: 'dish-d', name: 'Dish D', use_count: 5, created_at: '2026-03-10T00:00:00Z' }); // newer with tie on use_count
    const dishE = createMockDish({ id: 'dish-e', name: 'Dish E', use_count: 2, created_at: '2026-03-01T00:00:00Z' });
    const dishF = createMockDish({ id: 'dish-f', name: 'Dish F', use_count: 1, created_at: '2026-03-01T00:00:00Z' });

    render(
      <QuickLogFavorites
        customDishes={[dishA, dishB, dishC, dishD, dishE, dishF]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Order should be: Dish B (10), Dish D (5, newer), Dish C (5, older), Dish A (3), Dish E (2), Dish F (1)
    // In collapsed state per D26, top 3 (B, D, C) are rendered; A, E, F are beyond top 3
    const renderedCards = screen.getAllByTestId(/custom-dish-card-/);
    expect(renderedCards.map((card) => card.getAttribute('data-testid'))).toEqual([
      'custom-dish-card-dish-b',
      'custom-dish-card-dish-d',
      'custom-dish-card-dish-c',
    ]);

    const cardB = screen.getByTestId('custom-dish-card-dish-b');
    const cardD = screen.getByTestId('custom-dish-card-dish-d');
    const cardC = screen.getByTestId('custom-dish-card-dish-c');
    expect(cardB.compareDocumentPosition(cardD) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cardD.compareDocumentPosition(cardC) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.queryByTestId('custom-dish-card-dish-a')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-e')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-f')).toBeNull();

    // Verify NO pin UI exists (strictly forbidden by locked decisions)
    expect(screen.queryByLabelText(/pin/i)).toBeNull();
    expect(screen.queryByTestId(/pin/i)).toBeNull();
  });

  // §5 Required Test 1: Search reaches past the visible cap
  it('search reaches past the visible cap (queries full set, not visible slice)', () => {
    const dishes = Array.from({ length: 14 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: i === 8 ? 'Almond Butter Toast' : `Dish ${i + 1}`,
        use_count: 14 - i,
      })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Dish 9 (Almond Butter Toast) is ranked #9, beyond default cap of 5
    expect(screen.queryByTestId('custom-dish-card-dish-9')).toBeNull();

    const searchInput = screen.getByTestId('search-favorites-input');
    fireEvent.change(searchInput, { target: { value: 'almond' } });

    // Dish 9 MUST now be rendered in the DOM
    expect(screen.getByTestId('custom-dish-card-dish-9')).toBeDefined();
    // Non-matching dishes must not be rendered
    expect(screen.queryByTestId('custom-dish-card-dish-1')).toBeNull();
    // Result count reflects 1 of 14
    expect(screen.getByText('(1 of 14)')).toBeDefined();
  });

  // §5 Required Test 2: Clearing the query restores the prior expand state
  it('clearing the query restores the prior expand state', () => {
    const dishes = Array.from({ length: 14 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: i === 8 ? 'Almond Butter Toast' : `Dish ${i + 1}`,
        use_count: 14 - i,
      })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('search-favorites-input');
    const expandBtn = screen.getByTestId('open-favorites-sheet-btn');

    // Scenario A: Collapsed initially -> search -> clear -> still collapsed
    expect(expandBtn.textContent).toContain('Show all 14 favorites');
    expect(screen.queryByTestId('custom-dish-card-dish-9')).toBeNull();

    fireEvent.change(searchInput, { target: { value: 'Almond' } });
    expect(screen.getByTestId('custom-dish-card-dish-9')).toBeDefined();

    // Clear search
    const clearBtn = screen.getByLabelText('Clear search');
    fireEvent.click(clearBtn);

    // Must still be collapsed (Dish 9 is absent, expander still offers Show all 14)
    expect(screen.queryByTestId('custom-dish-card-dish-9')).toBeNull();
    expect(screen.getByTestId('open-favorites-sheet-btn').textContent).toContain('Show all 14 favorites');

    // Scenario B: Expanded initially -> search -> clear -> still expanded
    fireEvent.click(screen.getByTestId('open-favorites-sheet-btn'));
    expect(screen.getByTestId('open-favorites-sheet-btn').textContent).toContain('Collapse to top favorites');
    expect(screen.getByTestId('custom-dish-card-dish-9')).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'Dish 1' } });
    expect(screen.getByTestId('custom-dish-card-dish-1')).toBeDefined();

    // Clear search via input change
    fireEvent.change(searchInput, { target: { value: '' } });

    // Must still be expanded (Dish 9 is present, expander still says Collapse to top favorites)
    expect(screen.getByTestId('custom-dish-card-dish-9')).toBeDefined();
    expect(screen.getByTestId('open-favorites-sheet-btn').textContent).toContain('Collapse to top favorites');
  });

  // §5 Required Test 3: Distinct dishes render distinct rows
  it('distinct dishes render distinct rows even with similar names', () => {
    const dishes = [
      createMockDish({ id: 'dish-shake-choco', name: 'Protein Shake Chocolate' }),
      createMockDish({ id: 'dish-shake-vanilla', name: 'Protein Shake Vanilla' }),
    ];

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const cardChoco = screen.getByTestId('custom-dish-card-dish-shake-choco');
    const cardVanilla = screen.getByTestId('custom-dish-card-dish-shake-vanilla');

    expect(cardChoco).toBeDefined();
    expect(cardVanilla).toBeDefined();
    expect(cardChoco).not.toBe(cardVanilla);
    expect(screen.getByText('Protein Shake Chocolate')).toBeDefined();
    expect(screen.getByText('Protein Shake Vanilla')).toBeDefined();
  });

  // D26: visible rows in collapsed state are strictly 3 without media-query hiding
  it('rendered rows in collapsed state do not carry height hiding variants (superseded by D26 fixed top 3 slice)', () => {
    const dishes = Array.from({ length: 5 }, (_, i) =>
      createMockDish({ id: `dish-${i + 1}`, name: `Dish ${i + 1}` })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Exactly 3 rows rendered in collapsed state
    for (let i = 0; i < 3; i++) {
      const row = screen.getByTestId(`favorite-row-${i}`);
      expect(row.className).not.toContain('max-height');
    }
    expect(screen.queryByTestId('favorite-row-3')).toBeNull();
    expect(screen.queryByTestId('favorite-row-4')).toBeNull();
  });

  // §5 Required Test 5: Bar density contract
  it('bar density contract: QuickLogDishCard root contains p-2 and does NOT contain p-2.5, p-3, or min-h-[92px]', () => {
    const dish = createMockDish({ id: 'dish-density', name: 'Keto Bar' });

    render(
      <QuickLogFavorites
        customDishes={[dish]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const card = screen.getByTestId('custom-dish-card-dish-density');
    const article = card.closest('article')!;
    const classes = article.className.split(/\s+/);

    expect(classes).toContain('p-2');
    expect(classes).not.toContain('p-2.5');
    expect(classes).not.toContain('p-3');
    expect(classes).not.toContain('min-h-[92px]');
    expect(classes).not.toContain('flex-col');
  });

  // §5 Required Test 6: Preserved testids still resolve after regrid
  it('the three preserved testids still resolve after the regrid', () => {
    const dish = createMockDish({ id: 'dish-preserve-testids', name: 'Whey Protein' });

    render(
      <QuickLogFavorites
        customDishes={[dish]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Primary staging button testid
    expect(screen.getByTestId('custom-dish-card-dish-preserve-testids')).toBeDefined();
    // Edit dish button testid
    expect(screen.getByTestId('edit-dish-btn-dish-preserve-testids')).toBeDefined();
    // Quick log button testid
    expect(screen.getByTestId('quick-log-btn-dish-preserve-testids')).toBeDefined();

    // Accessible pairing
    const article = screen.getByTestId('custom-dish-card-dish-preserve-testids').closest('article')!;
    expect(article.getAttribute('aria-labelledby')).toBe('dish-name-dish-preserve-testids');
    const nameEl = article.querySelector('#dish-name-dish-preserve-testids');
    expect(nameEl).toBeDefined();
    expect(nameEl?.textContent).toBe('Whey Protein');
  });

  it('shows no-results message and updates count when search query matches nothing', () => {
    const dishes = [
      createMockDish({ id: 'dish-1', name: 'Avocado Toast' }),
      createMockDish({ id: 'dish-2', name: 'Whey Isolate' }),
    ];

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('search-favorites-input');
    fireEvent.change(searchInput, { target: { value: 'pizza' } });

    expect(screen.getByText(/No dishes found matching "pizza"/i)).toBeDefined();
    expect(screen.getByText('(0 of 2)')).toBeDefined();
    expect(screen.queryByTestId('custom-dish-card-dish-1')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-2')).toBeNull();
  });

  // Attack A & E: Note searching across full set
  it('searches by note as well as dish name across full set', () => {
    const dishes = [
      createMockDish({ id: 'dish-1', name: 'Avocado Toast', notes: 'organic sourdough' }),
      createMockDish({ id: 'dish-2', name: 'Whey Isolate', notes: 'chocolate peanut butter' }),
      createMockDish({ id: 'dish-3', name: 'Chicken Breast', notes: 'air fried with rosemary' }),
    ];

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('search-favorites-input');
    // Search by note keyword
    fireEvent.change(searchInput, { target: { value: 'chocolate' } });
    expect(screen.queryByTestId('custom-dish-card-dish-1')).toBeNull();
    expect(screen.getByTestId('custom-dish-card-dish-2')).toBeDefined();
    expect(screen.queryByTestId('custom-dish-card-dish-3')).toBeNull();
    expect(screen.getByText('(1 of 3)')).toBeDefined();
  });

  // Expander renders for 4-dish list without min-height hiding variant and aria-expanded contract
  it('expander renders for 4-dish list without min-height hiding variant and aria-expanded contract', () => {
    const dishes = Array.from({ length: 4 }, (_, i) =>
      createMockDish({ id: `dish-${i + 1}`, name: `Dish ${i + 1}` })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const expandBtn = screen.getByTestId('open-favorites-sheet-btn');
    expect(expandBtn).toBeDefined();
    expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
    expect(expandBtn.className).not.toContain('min-height');
    expect(expandBtn.textContent).toContain('Show all 4 favorites');

    fireEvent.click(expandBtn);
    expect(expandBtn.getAttribute('aria-expanded')).toBe('true');
    expect(expandBtn.textContent).toContain('Collapse to top favorites');
  });

  // Attack G1: Expander renders for 5-dish list without min-height hiding variant
  it('Attack G1: expander renders for 5-dish list without min-height hiding variant', () => {
    const dishes = Array.from({ length: 5 }, (_, i) =>
      createMockDish({ id: `dish-${i + 1}`, name: `Dish ${i + 1}` })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const expandBtn = screen.getByTestId('open-favorites-sheet-btn');
    expect(expandBtn).toBeDefined();
    expect(expandBtn.className).not.toContain('min-height');
    expect(expandBtn.textContent).toContain('Show all 5 favorites');
  });

  // Attack G3: Live regions for search result count and no-results message
  it('Attack G3: search result count and no-results message have polite live region role', () => {
    const dishes = [
      createMockDish({ id: 'dish-1', name: 'Eggs & Toast' }),
    ];

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const countSpan = screen.getByRole('status');
    expect(countSpan).toBeDefined();
    expect(countSpan.getAttribute('aria-live')).toBe('polite');

    const searchInput = screen.getByTestId('search-favorites-input');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    const statusRegions = screen.getAllByRole('status');
    expect(statusRegions.length).toBe(2);
    const noResults = screen.getByText(/No dishes found matching "nonexistent"/i);
    expect(statusRegions).toContain(noResults);
    expect(noResults.getAttribute('aria-live')).toBe('polite');
  });

  // PART A Unit Test (2): exactly 4 favorites -> expander shows, clicking it reveals the 4th
  it('(2) exactly 4 favorites -> expander shows, clicking it reveals the 4th', () => {
    const dishes = Array.from({ length: 4 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: `Dish ${i + 1}`,
        use_count: 10 - i,
      })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Only top 3 dishes should be rendered in collapsed state
    expect(screen.getByTestId('custom-dish-card-dish-1')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-2')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-3')).toBeDefined();
    expect(screen.queryByTestId('custom-dish-card-dish-4')).toBeNull();

    // Expander button is present and indicates 4 total favorites
    const expandBtn = screen.getByTestId('open-favorites-sheet-btn');
    expect(expandBtn).toBeDefined();
    expect(expandBtn.textContent).toContain('Show all 4 favorites');

    // Click expander: reveals the 4th dish
    fireEvent.click(expandBtn);
    expect(screen.getByTestId('custom-dish-card-dish-4')).toBeDefined();
    expect(expandBtn.textContent).toContain('Collapse to top favorites');
  });

  // PART A Unit Test (3): <=3 favorites (test 3 and 1) -> no expander
  it('(3) <=3 favorites (test 3 and 1) -> no expander', () => {
    // Sub-case 3A: exactly 3 favorites
    const dishes3 = Array.from({ length: 3 }, (_, i) =>
      createMockDish({ id: `dish-3-${i + 1}`, name: `Dish 3-${i + 1}` })
    );

    const { unmount } = render(
      <QuickLogFavorites
        customDishes={dishes3}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    expect(screen.getByTestId('custom-dish-card-dish-3-1')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-3-2')).toBeDefined();
    expect(screen.getByTestId('custom-dish-card-dish-3-3')).toBeDefined();
    expect(screen.queryByTestId('open-favorites-sheet-btn')).toBeNull();

    unmount();

    // Sub-case 3B: exactly 1 favorite
    const dishes1 = [createMockDish({ id: 'dish-1-single', name: 'Single Favorite' })];
    render(
      <QuickLogFavorites
        customDishes={dishes1}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    expect(screen.getByTestId('custom-dish-card-dish-1-single')).toBeDefined();
    expect(screen.queryByTestId('open-favorites-sheet-btn')).toBeNull();
  });

  // PART A Unit Test (4): search filters across ALL favorites (including ones beyond the first 3)
  it('(4) search filters across ALL favorites (including ones beyond the first 3)', () => {
    const dishes = Array.from({ length: 6 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: i === 4 ? 'Target Salmon Bowl' : `Filler Dish ${i + 1}`,
        use_count: 10 - i,
      })
    );

    render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Dish 5 is ranked 5th, beyond default cap of 3
    expect(screen.queryByTestId('custom-dish-card-dish-5')).toBeNull();

    // Perform search matching Dish 5
    const searchInput = screen.getByTestId('search-favorites-input');
    fireEvent.change(searchInput, { target: { value: 'salmon' } });

    // Dish 5 MUST now be rendered in the DOM
    expect(screen.getByTestId('custom-dish-card-dish-5')).toBeDefined();
    // Non-matching dishes must not be rendered
    expect(screen.queryByTestId('custom-dish-card-dish-1')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-2')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-3')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-4')).toBeNull();
    expect(screen.queryByTestId('custom-dish-card-dish-6')).toBeNull();
    // Result count reflects (1 of 6)
    expect(screen.getByText('(1 of 6)')).toBeDefined();
  });

  // D18 Type Scale Contract: NO font-mono anywhere, tabular-nums for numbers, all fonts >= 12px
  it('D18 type scale contract: no font-mono anywhere in Quick Log, tabular-nums on numbers, every font >= 12px', () => {
    const dishes = Array.from({ length: 5 }, (_, i) =>
      createMockDish({
        id: `dish-${i + 1}`,
        name: `Favorite Dish ${i + 1}`,
        calories: 350 + i * 20,
        protein: 30 + i * 5,
        use_count: 10 - i,
      })
    );

    const { container } = render(
      <QuickLogFavorites
        customDishes={dishes}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    // Verify NO font-mono class exists anywhere in Quick Log Favorites container
    const monoElements = container.querySelectorAll('.font-mono, [class*="font-mono"]');
    expect(monoElements.length).toBe(0);

    // Verify tabular-nums exists on numbers (macro subtitle, count, expander)
    const tabularElements = container.querySelectorAll('.tabular-nums');
    expect(tabularElements.length).toBeGreaterThan(0);

    // Verify no text-[10px] or text-[11px] exists anywhere
    const sub12Elements = container.querySelectorAll('[class*="text-[10px]"], [class*="text-[11px]"], [class*="text-[9px]"]');
    expect(sub12Elements.length).toBe(0);

    // Verify no font-black (900) or font-extrabold (800) or font-medium (500)
    const disallowedWeights = container.querySelectorAll('.font-black, .font-extrabold, .font-medium, .font-thin, .font-light');
    expect(disallowedWeights.length).toBe(0);
  });

  // Long dish names: title attribute preservation for accessibility when truncated
  it('preserves full dish name in title attribute and aria-label for truncated names', () => {
    const longName = 'Extra Long Name Grilled Atlantic Salmon Fillet with Garlic Butter Glaze and Rosemary';
    const dish = createMockDish({
      id: 'dish-long-name',
      name: longName,
    });

    render(
      <QuickLogFavorites
        customDishes={[dish]}
        onOpenNewDishModal={vi.fn()}
        onStageCustomDish={vi.fn()}
        onOpenEditDishModal={vi.fn()}
        onQuickLogCustomDishDirect={vi.fn()}
        onDismissToast={vi.fn()}
      />
    );

    const dishNameEl = screen.getByTitle(longName);
    expect(dishNameEl).toBeDefined();
    expect(dishNameEl.className).toContain('truncate');

    const cardBtn = screen.getByTestId('custom-dish-card-dish-long-name');
    expect(cardBtn.getAttribute('aria-label')).toContain(longName);
  });

  describe('D33: Quick Log Favorites staged mode', () => {
    it('switches section title to "Add to staged meal" when isStaged is true, and keeps "Quick Log Favorites" when false', () => {
      const dish = createMockDish({ id: 'dish-1', name: 'Greek Yogurt' });

      // Unstaged (default)
      const { unmount } = render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
          isStaged={false}
        />
      );
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Quick Log Favorites');
      unmount();

      // Staged
      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
          isStaged={true}
        />
      );
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Add to staged meal');
    });

    it('"+" button aria-label is "Add <dish name> to staged meal" when isStaged is true, and "Quick log 1 serving of <dish name>" when false', () => {
      const dish = createMockDish({ id: 'dish-1', name: 'Almonds' });

      // Unstaged
      const { unmount } = render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
          isStaged={false}
        />
      );
      const plusBtnUnstaged = screen.getByTestId('quick-log-btn-dish-1');
      expect(plusBtnUnstaged.getAttribute('aria-label')).toBe('Quick log 1 serving of Almonds');
      unmount();

      // Staged
      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
          isStaged={true}
        />
      );
      const plusBtnStaged = screen.getByTestId('quick-log-btn-dish-1');
      expect(plusBtnStaged.getAttribute('aria-label')).toBe('Add Almonds to staged meal');
    });

    it('"+" button while staged calls onAddCustomDishToStaged and does NOT call onQuickLogCustomDishDirect', () => {
      const dish = createMockDish({ id: 'dish-1', name: 'Almonds' });
      const onAddCustomDishToStaged = vi.fn();
      const onQuickLogCustomDishDirect = vi.fn();

      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={onQuickLogCustomDishDirect}
          onDismissToast={vi.fn()}
          isStaged={true}
          onAddCustomDishToStaged={onAddCustomDishToStaged}
        />
      );

      const plusBtn = screen.getByTestId('quick-log-btn-dish-1');
      fireEvent.click(plusBtn);

      expect(onAddCustomDishToStaged).toHaveBeenCalledTimes(1);
      expect(onAddCustomDishToStaged).toHaveBeenCalledWith(dish);
      expect(onQuickLogCustomDishDirect).not.toHaveBeenCalled();
    });

    it('"+" button with no staged meal still logs directly', () => {
      const dish = createMockDish({ id: 'dish-1', name: 'Almonds' });
      const onAddCustomDishToStaged = vi.fn();
      const onQuickLogCustomDishDirect = vi.fn();

      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={onQuickLogCustomDishDirect}
          onDismissToast={vi.fn()}
          isStaged={false}
          onAddCustomDishToStaged={onAddCustomDishToStaged}
        />
      );

      const plusBtn = screen.getByTestId('quick-log-btn-dish-1');
      fireEvent.click(plusBtn);

      expect(onQuickLogCustomDishDirect).toHaveBeenCalledTimes(1);
      expect(onAddCustomDishToStaged).not.toHaveBeenCalled();
    });

    it('row tap while staged calls onAddCustomDishToStaged instead of onStageCustomDish', () => {
      const dish = createMockDish({ id: 'dish-1', name: 'Almonds' });
      const onAddCustomDishToStaged = vi.fn();
      const onStageCustomDish = vi.fn();

      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={onStageCustomDish}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
          isStaged={true}
          onAddCustomDishToStaged={onAddCustomDishToStaged}
        />
      );

      const rowBtn = screen.getByTestId('custom-dish-card-dish-1');
      fireEvent.click(rowBtn);

      expect(onAddCustomDishToStaged).toHaveBeenCalledTimes(1);
      expect(onAddCustomDishToStaged).toHaveBeenCalledWith(dish);
      expect(onStageCustomDish).not.toHaveBeenCalled();
    });
  });

  describe('D35 type and input consistency', () => {
    it('clear search button moves focus to the search input (D35)', () => {
      render(
        <QuickLogFavorites
          customDishes={[createMockDish()]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
        />
      );

      const searchInput = screen.getByTestId('search-favorites-input');
      fireEvent.change(searchInput, { target: { value: 'test' } });
      const clearBtn = screen.getByLabelText('Clear search');
      clearBtn.focus();
      expect(document.activeElement).toBe(clearBtn);

      fireEvent.click(clearBtn);

      expect(document.activeElement).toBe(searchInput);
    });

    it('dish name uses 14px semibold text-sm font-semibold (D35/D18)', () => {
      render(
        <QuickLogFavorites
          customDishes={[createMockDish({ id: 'dish-1', name: 'Whey Protein' })]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
        />
      );

      const dishName = screen.getByText('Whey Protein');
      expect(dishName.className).toContain('text-sm');
      expect(dishName.className).toContain('font-semibold');
      expect(dishName.className).not.toContain('text-xs');
      expect(dishName.className).not.toContain('font-bold');
    });

    it('search input maintains 16px text-base without sm:text-xs responsive shrink (D35)', () => {
      render(
        <QuickLogFavorites
          customDishes={[createMockDish()]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
        />
      );

      const searchInput = screen.getByTestId('search-favorites-input');
      expect(searchInput.className).toContain('text-base');
      expect(searchInput.className).not.toContain('sm:text-xs');
      expect(searchInput.className).not.toContain('sm:text-sm');
    });

    it('formats dish calories and protein in aria-label without float drift (STD-DAT-2)', () => {
      const dish = createMockDish({
        id: 'dish-drift',
        name: 'Custom Mix',
        calories: 100.1,
        protein: 24.799999999999997,
      });

      render(
        <QuickLogFavorites
          customDishes={[dish]}
          onOpenNewDishModal={vi.fn()}
          onStageCustomDish={vi.fn()}
          onOpenEditDishModal={vi.fn()}
          onQuickLogCustomDishDirect={vi.fn()}
          onDismissToast={vi.fn()}
        />
      );

      const card = screen.getByTestId('custom-dish-card-dish-drift');
      expect(card.getAttribute('aria-label')).toContain('100 calories, 24.8 grams protein');
      expect(card.getAttribute('aria-label')).not.toContain('24.799999999999997');
      expect(card.getAttribute('aria-label')).not.toContain('100.1');
    });
  });
});
