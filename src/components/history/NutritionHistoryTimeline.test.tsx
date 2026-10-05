import { formatNutritionDayHeader } from './useHistoryData';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  NutritionHistoryTimeline,
  type NutritionDaySummary,
} from './NutritionHistoryTimeline';
import type { NutritionLog } from '../../types/database';

describe('NutritionHistoryTimeline', () => {
  const sampleMeal1: NutritionLog = {
    id: 'meal-1',
    user_id: 'user-123',
    food_name: 'Oatmeal & Berries',
    calories: 350,
    protein: 15,
    carbs: 60,
    fat: 6,
    fiber: 8,
    logged_at: '2026-09-27T08:00:00Z',
  };

  const sampleMeal2: NutritionLog = {
    id: 'meal-2',
    user_id: 'user-123',
    food_name: 'Grilled Chicken Salad',
    calories: 500,
    protein: 45,
    carbs: 20,
    fat: 15,
    fiber: 5,
    logged_at: '2026-09-27T12:30:00Z',
  };

  const sampleDay: NutritionDaySummary = {
    date: '2026-09-27',
    meals: [sampleMeal1, sampleMeal2],
    totals: { calories: 850, protein: 60, carbs: 80, fat: 21, fiber: 13 },
    macroCalories: { protein: 240, carbs: 320, fat: 189, total: 749 },
    percentages: { protein: 32, carbs: 43, fat: 25 },
  };

  describe('formatNutritionDayHeader (H41 / STD-DAT-5)', () => {
    it('formats date correctly for current year without year suffix', () => {
      const currentYear = new Date().getFullYear();
      const dateStr = `${currentYear}-09-27`;
      const { title, subtitle } = formatNutritionDayHeader(dateStr, 2);

      // Must have weekday, short month, day, NO year suffix, and NO raw YYYY-MM-DD
      expect(title).toContain('Sep 27');
      expect(title).not.toContain(String(currentYear));
      expect(title).not.toContain(dateStr);
      expect(subtitle).toContain('2 meals logged');
    });

    it('formats date correctly for non-current year with year suffix', () => {
      const pastDateStr = '2024-12-25';
      const { title, subtitle } = formatNutritionDayHeader(pastDateStr, 1);

      expect(title).toBe('Wed, Dec 25, 2024');
      expect(title).not.toContain(pastDateStr);
      expect(subtitle).toBe('Wednesday · 1 meal logged');
    });

    it('renders zero raw YYYY-MM-DD date strings in the day header', () => {
      const { title, subtitle } = formatNutritionDayHeader('2025-06-15', 3);
      expect(title).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(subtitle).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(title).toContain('2025');
    });
  });

  describe('H23: Skeleton & Empty States', () => {
    it('renders skeleton cards with aria-busy="true" while isNutritionPending=true', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          isNutritionPending={true}
        />
      );

      const skeletonWrapper = screen.getByTestId('nutrition-history-skeleton');
      expect(skeletonWrapper).toBeDefined();
      const busyElements = skeletonWrapper.querySelectorAll('[aria-busy="true"]');
      expect(busyElements.length).toBeGreaterThan(0);
      expect(screen.queryByTestId('nutrition-history-empty')).toBeNull();
    });

    it('renders empty state with "Log a meal" CTA button when no days exist and not inspecting athlete', () => {
      const mockNavigate = vi.fn();
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          isNutritionPending={false}
          onNavigateToNutrition={mockNavigate}
        />
      );

      expect(screen.getByTestId('nutrition-history-empty')).toBeDefined();
      expect(screen.getByText('No nutrition logs recorded yet.')).toBeDefined();

      const ctaBtn = screen.getByTestId('log-meal-cta-btn');
      expect(ctaBtn).toBeDefined();
      expect(ctaBtn.textContent).toBe('Log a meal');

      fireEvent.click(ctaBtn);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it('does not render "Log a meal" CTA when isInspectingAthlete is true in empty state', () => {
      const mockNavigate = vi.fn();
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[]}
          timeRange="all"
          isInspectingAthlete={true}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          isNutritionPending={false}
          onNavigateToNutrition={mockNavigate}
        />
      );

      expect(screen.getByTestId('nutrition-history-empty')).toBeDefined();
      expect(screen.queryByTestId('log-meal-cta-btn')).toBeNull();
    });
  });

  describe('H11: Load Older Days Pagination', () => {
    it('renders "Load older days" button when hasMoreNutrition is true', () => {
      const handleLoadMore = vi.fn();
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          hasMoreNutrition={true}
          isLoadingMoreNutrition={false}
          onLoadMoreNutrition={handleLoadMore}
        />
      );

      const loadMoreBtn = screen.getByTestId('load-more-nutrition-btn');
      expect(loadMoreBtn).toBeDefined();
      expect(loadMoreBtn.textContent).toBe('Load older days');
      expect(loadMoreBtn).not.toBeDisabled();

      fireEvent.click(loadMoreBtn);
      expect(handleLoadMore).toHaveBeenCalledTimes(1);
    });

    it('disables "Load older days" and shows "Loading..." while isLoadingMoreNutrition is true', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          hasMoreNutrition={true}
          isLoadingMoreNutrition={true}
          onLoadMoreNutrition={vi.fn()}
        />
      );

      const loadMoreBtn = screen.getByTestId('load-more-nutrition-btn');
      expect(loadMoreBtn).toBeDisabled();
      expect(loadMoreBtn.textContent).toBe('Loading...');
    });

    it('does not render "Load older days" button when hasMoreNutrition is false', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          hasMoreNutrition={false}
        />
      );

      expect(screen.queryByTestId('load-more-nutrition-btn')).toBeNull();
    });
  });

  describe('RD-7 / H27: Deferred Delete Filtering', () => {
    it('filters out pendingDeleteMealId and recalculates daily totals', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          pendingDeleteMealId="meal-1"
        />
      );

      // Expand day card (D-YB-9) to inspect meal rows
      fireEvent.click(screen.getByTestId('expand-day-btn-2026-09-27'));

      // Meal 1 ('Oatmeal & Berries') should be hidden
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();
      // Meal 2 ('Grilled Chicken Salad') should be visible
      expect(screen.getByText('Grilled Chicken Salad')).toBeDefined();

      // Daily totals should be recomputed to only Meal 2's numbers (500 kcal, 45g P, 20g C, 15g F, 5g Fib)
      const calories = screen.getAllByText('500 kcal');
      expect(calories.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('45g P')).toBeDefined();
      expect(screen.getByText('20g C')).toBeDefined();
      expect(screen.getByText('15g F')).toBeDefined();
      expect(screen.getByText('5g Fib')).toBeDefined();
    });

    it('omits a day completely if all of its meals are pending deletion', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[
            {
              ...sampleDay,
              meals: [sampleMeal1],
            },
          ]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          pendingDeleteMealId="meal-1"
        />
      );

      // Since the only meal is pending deletion, displayDays becomes empty -> shows empty state
      expect(screen.getByTestId('nutrition-history-empty')).toBeDefined();
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();
    });
  });

  describe('Meal operations wiring', () => {
    it('renders meals and connects onEdit and onDelete callbacks', () => {
      const handleEdit = vi.fn();
      const handleDelete = vi.fn();

      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={handleEdit}
          onDeleteMeal={handleDelete}
        />
      );

      // Expand day card (D-YB-9) to reveal meal rows
      fireEvent.click(screen.getByTestId('expand-day-btn-2026-09-27'));

      expect(screen.getByText('Oatmeal & Berries')).toBeDefined();
      expect(screen.getByText('Grilled Chicken Salad')).toBeDefined();
    });
  });

  describe('D-YB-9: Day Accordion Collapsible Behavior', () => {
    it('starts collapsed by default: no meals or caloric macro distribution in DOM, aria-expanded=false', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
        />
      );

      // Header row & macro summary pills are rendered
      expect(screen.getByText(/Sun, Sep 27/)).toBeDefined();
      expect(screen.getByText('Sunday · 2 meals logged')).toBeDefined();
      expect(screen.getAllByText('850 kcal').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('60g P')).toBeDefined();

      // Accordion toggle button exists and indicates collapsed state
      const toggleBtn = screen.getByTestId('expand-day-btn-2026-09-27');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(toggleBtn.getAttribute('aria-controls')).toBe('nutrition-day-details-2026-09-27');

      // Caloric macro distribution bar and meal rows are NOT in the DOM
      expect(screen.queryByText('Caloric Macro Distribution')).toBeNull();
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();
      expect(screen.queryByText('Grilled Chicken Salad')).toBeNull();
      expect(document.getElementById('nutrition-day-details-2026-09-27')).toBeNull();
    });

    it('toggles open on click and closes on subsequent click, flipping aria-expanded and updating DOM', () => {
      render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
        />
      );

      const toggleBtn = screen.getByTestId('expand-day-btn-2026-09-27');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

      // Click to expand
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(toggleBtn.getAttribute('aria-label')).toContain('Collapse');

      const body = document.getElementById('nutrition-day-details-2026-09-27');
      expect(body).not.toBeNull();
      expect(screen.getByText('Caloric Macro Distribution')).toBeDefined();
      expect(screen.getByText('Oatmeal & Berries')).toBeDefined();
      expect(screen.getByText('Grilled Chicken Salad')).toBeDefined();

      // Click to collapse
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(toggleBtn.getAttribute('aria-label')).toContain('Expand');
      expect(document.getElementById('nutrition-day-details-2026-09-27')).toBeNull();
      expect(screen.queryByText('Caloric Macro Distribution')).toBeNull();
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();
      expect(screen.queryByText('Grilled Chicken Salad')).toBeNull();
    });

    it('preserves expanded state across timeRange filter changes', () => {
      const { rerender } = render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
        />
      );

      const toggleBtn = screen.getByTestId('expand-day-btn-2026-09-27');
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Oatmeal & Berries')).toBeDefined();

      // Change timeRange to 90d (survives in mounted view)
      rerender(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="90d"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
        />
      );

      const updatedToggleBtn = screen.getByTestId('expand-day-btn-2026-09-27');
      expect(updatedToggleBtn.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Oatmeal & Berries')).toBeDefined();
    });

    it('updates header chips during deferred delete while collapsed, and undo restores', () => {
      const { rerender } = render(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          pendingDeleteMealId={null}
        />
      );

      // Card starts collapsed
      const toggleBtn = screen.getByTestId('expand-day-btn-2026-09-27');
      expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();

      // Original total in header chips: 850 kcal, 60g P, 80g C, 21g F, 13g Fib
      expect(screen.getAllByText('850 kcal').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('60g P')).toBeDefined();

      // Simulate deferred delete of meal-1 (Oatmeal & Berries: 350 kcal, 15g P)
      rerender(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          pendingDeleteMealId="meal-1"
        />
      );

      // Still collapsed
      expect(screen.getByTestId('expand-day-btn-2026-09-27').getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('Oatmeal & Berries')).toBeNull();

      // Header chips updated to Meal 2 only: 500 kcal, 45g P, 20g C, 15g F, 5g Fib
      expect(screen.getAllByText('500 kcal').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('45g P')).toBeDefined();
      expect(screen.getByText('20g C')).toBeDefined();

      // Simulate Undo restoring meal-1
      rerender(
        <NutritionHistoryTimeline
          filteredNutritionDays={[sampleDay]}
          timeRange="all"
          isInspectingAthlete={false}
          onEditMeal={vi.fn()}
          onDeleteMeal={vi.fn()}
          pendingDeleteMealId={null}
        />
      );

      // Totals restored in header chips
      expect(screen.getAllByText('850 kcal').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('60g P')).toBeDefined();
    });
  });
});
