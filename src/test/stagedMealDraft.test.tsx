import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NutritionEngine } from '../components/nutrition/NutritionEngine';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from '../components/common/ToastHost';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { getLocalDateStr } from '../utils/date';
import { createSupabaseBuilder, clearMockHistory } from './supabaseBuilderMock';
import {
  loadStagedMealDraft,
  saveStagedMealDraft,
  clearStagedMealDraft,
  clearAllStagedMealDrafts,
  getStagedMealStorageKey,
} from '../components/nutrition/stagedMealDraft';
import type { StagedMeal } from '../components/nutrition/nutritionEngineHelpers';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-user-id', email: 'athlete@example.com' },
    access_token: 'mock-jwt-token-123',
  },
}));

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: vi.fn(),
  },
  CameraResultType: {
    Base64: 'base64',
  },
  CameraSource: {
    Camera: 'CAMERA',
    Photos: 'PHOTOS',
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('../offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../offline')>();
  return {
    ...actual,
    enqueueAndAwait: vi.fn().mockImplementation(async () => {
      return { status: 'synced', opId: 'mock-op-1' };
    }),
  };
});

function SignOutButton(): React.JSX.Element {
  const { signOut } = useAuth();
  return (
    <button
      type="button"
      data-testid="test-sign-out-btn"
      onClick={() => {
        void signOut();
      }}
    >
      Sign Out
    </button>
  );
}

describe('Staged Meal Persistence Across Tab Switches & Mounts (Run 13 Item 0c)', () => {
  let queryClient: QueryClient;
  const todayStr = getLocalDateStr(new Date());

  const sampleAiMeal: StagedMeal = {
    name: 'Eggs & Toast',
    mealType: 'Breakfast',
    explanation: '210 kcal (Eggs) + 160 kcal (Toast) = 370 kcal',
    items: [
      {
        id: 'item-eggs-1',
        name: 'Eggs',
        portion: '3 large',
        quantity: 3,
        unit: 'unit',
        calories: 210,
        protein: 18,
        carbs: 2,
        fat: 15,
        fiber: 0,
        baseQuantity: 3,
        baseCalories: 210,
        baseProtein: 18,
        baseCarbs: 2,
        baseFat: 15,
        baseFiber: 0,
        portionMultiplier: 1,
        userOverridden: false,
      },
      {
        id: 'item-toast-1',
        name: 'Toast',
        portion: '2 slices',
        quantity: 2,
        unit: 'unit',
        calories: 160,
        protein: 6,
        carbs: 30,
        fat: 2,
        fiber: 2,
        baseQuantity: 2,
        baseCalories: 160,
        baseProtein: 6,
        baseCarbs: 30,
        baseFat: 2,
        baseFiber: 2,
        portionMultiplier: 1,
        userOverridden: false,
      },
    ],
    calories: 370,
    protein: 24,
    carbs: 32,
    fat: 17,
    fiber: 2,
    servingSize: 1,
    servingUnit: 'serving',
    source: 'ai',
  };

  const sampleDeviceMeal: StagedMeal = {
    name: 'Greek Yogurt',
    mealType: 'Breakfast',
    explanation: 'Greek Yogurt: 130 kcal | 15g P | 9g C | 2g F | 0g Fiber',
    items: [
      {
        id: 'item-yogurt-1',
        name: 'Greek Yogurt',
        portion: '1 cup',
        quantity: 1,
        unit: 'unit',
        calories: 130,
        protein: 15,
        carbs: 9,
        fat: 2,
        fiber: 0,
        baseQuantity: 1,
        baseCalories: 130,
        baseProtein: 15,
        baseCarbs: 9,
        baseFat: 2,
        baseFiber: 0,
        portionMultiplier: 1,
        userOverridden: false,
      },
    ],
    calories: 130,
    protein: 15,
    carbs: 9,
    fat: 2,
    fiber: 0,
    servingSize: 1,
    servingUnit: 'unit',
    source: 'local',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearMockHistory();
    sessionStorage.clear();
    localStorage.clear();

    localStorage.setItem(
      'yourbody_user',
      JSON.stringify({
        id: 'test-user-id',
        email: 'athlete@example.com',
        username: 'athlete',
        role: 'athlete',
      })
    );

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: 'test-user-id' } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    (supabase.from as any).mockImplementation((table: string) =>
      createSupabaseBuilder(table, { data: [], error: null })
    );

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.useRealTimers();
  });

  const renderComponent = (customQueryClient?: QueryClient) =>
    render(
      <QueryClientProvider client={customQueryClient ?? queryClient}>
        <AuthProvider>
          <CoachProvider>
            <ToastProvider>
              <NutritionEngine />
              <SignOutButton />
              <ToastHost />
            </ToastProvider>
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  it('1. stage (AI source) -> unmount -> remount restores the card with the same items/source/edits', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        name: 'Eggs & Toast',
        calories: 370,
        protein: 24,
        carbs: 32,
        fat: 17,
        fiber: 2,
        explanation: '210 kcal + 160 kcal',
        items: [
          { name: 'Eggs', portion: '3 large', quantity: 3, unit: 'unit', calories: 210, protein: 18, carbs: 2, fat: 15, fiber: 0 },
          { name: 'Toast', portion: '2 slices', quantity: 2, unit: 'unit', calories: 160, protein: 6, carbs: 30, fat: 2, fiber: 2 },
        ],
      },
      error: null,
    });

    const { unmount } = renderComponent();

    const input = screen.getByPlaceholderText(/describe what you ate/i);
    fireEvent.change(input, { target: { value: '3 eggs and 2 slices toast' } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    const nameInput = screen.getByTestId('dish-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Organic Eggs & Toast' } });

    await waitFor(() => {
      const stored = loadStagedMealDraft('test-user-id', todayStr);
      expect(stored?.name).toBe('Organic Eggs & Toast');
      expect(stored?.source).toBe('ai');
    });

    unmount();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    const restoredNameInput = screen.getByTestId('dish-name-input') as HTMLInputElement;
    expect(restoredNameInput.value).toBe('Organic Eggs & Toast');
    expect(screen.getByText('AI')).toBeDefined();
    expect(screen.getByText('Eggs')).toBeDefined();
    expect(screen.getByText('Toast')).toBeDefined();
  });

  it('2. stage (device source) -> unmount -> remount restores the card with the same items and device source', async () => {
    const { unmount } = renderComponent();

    const validBlock = `Greek Yogurt
Serving size: 1 cup
Calories 130
Protein 15g
Total Carbohydrate 9g
Total Fat 2g
Dietary Fiber 0g`;

    const input = screen.getByPlaceholderText(/describe what you ate/i);
    fireEvent.change(input, { target: { value: validBlock } });
    fireEvent.click(screen.getByText('Analyze Meal'));

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      expect(screen.getByText('Device')).toBeDefined();
    });

    await waitFor(() => {
      const stored = loadStagedMealDraft('test-user-id', todayStr);
      expect(stored).not.toBeNull();
      expect(stored?.source).toBe('local');
      expect(stored?.name).toBe('Greek Yogurt');
    });

    unmount();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    expect(screen.getByText('Device')).toBeDefined();
    const dishName = screen.getByTestId('dish-name-input') as HTMLInputElement;
    expect(dishName.value).toBe('Greek Yogurt');
  });

  it('3. Log Meal clears it (remount shows the empty input)', async () => {
    saveStagedMealDraft('test-user-id', todayStr, sampleAiMeal);

    const { unmount } = renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    const logButton = screen.getByRole('button', { name: /log meal/i });
    fireEvent.click(logButton);

    await waitFor(() => {
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    });

    expect(loadStagedMealDraft('test-user-id', todayStr)).toBeNull();

    unmount();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe what you ate/i)).toBeDefined();
    });
    expect(screen.queryByTestId('staged-meal-card')).toBeNull();
  });

  it('4. dismiss X clears it', async () => {
    saveStagedMealDraft('test-user-id', todayStr, sampleAiMeal);

    const { unmount } = renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    const discardBtn = screen.getByLabelText('Discard staged meal');
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    });

    expect(loadStagedMealDraft('test-user-id', todayStr)).toBeNull();

    unmount();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe what you ate/i)).toBeDefined();
    });
    expect(screen.queryByTestId('staged-meal-card')).toBeNull();
  });

  it("5. another user's draft is never shown (draft saved for user A; mount as user B -> no card)", async () => {
    saveStagedMealDraft('user-athlete-a', todayStr, sampleAiMeal);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe what you ate/i)).toBeDefined();
    });

    expect(screen.queryByTestId('staged-meal-card')).toBeNull();

    // Verify user A's draft was isolated and remains untouched
    const draftUserA = loadStagedMealDraft('user-athlete-a', todayStr);
    expect(draftUserA).not.toBeNull();
    expect(draftUserA?.name).toBe('Eggs & Toast');

    // Verify user B's draft is strictly null
    expect(loadStagedMealDraft('test-user-id', todayStr)).toBeNull();
  });

  it('6. stale-day draft is dropped (stored date != today -> no card, key removed)', async () => {
    const yesterdayDateStr = '2020-01-01';
    saveStagedMealDraft('test-user-id', yesterdayDateStr, sampleAiMeal);

    const storageKey = getStagedMealStorageKey('test-user-id');
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe what you ate/i)).toBeDefined();
    });

    expect(screen.queryByTestId('staged-meal-card')).toBeNull();

    // Key must have been removed from sessionStorage
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(loadStagedMealDraft('test-user-id', todayStr)).toBeNull();
  });

  it('7. sign-out removes the draft key', async () => {
    saveStagedMealDraft('test-user-id', todayStr, sampleAiMeal);
    const storageKey = getStagedMealStorageKey('test-user-id');
    const workoutMirrorKey = 'yourbody_active_exercises_test-user-id';
    sessionStorage.setItem(workoutMirrorKey, JSON.stringify({ active: true }));
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(sessionStorage.getItem(workoutMirrorKey)).not.toBeNull();

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    const signOutBtn = screen.getByTestId('test-sign-out-btn');
    await act(async () => {
      fireEvent.click(signOutBtn);
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    expect(sessionStorage.getItem(storageKey)).toBeNull();
    // Invariant: Unrelated sessionStorage keys (e.g. workout session mirrors) must remain untouched
    expect(sessionStorage.getItem(workoutMirrorKey)).not.toBeNull();
  });

  it('8. restored-after-auth draft shows its quota warning', async () => {
    const mealWithQuota: StagedMeal = {
      ...sampleAiMeal,
      quota: {
        used: 8,
        remaining: 2,
        limit: 10,
        period: 'day',
        resetsAt: '2026-10-15T00:00:00Z',
      },
    };

    saveStagedMealDraft('test-user-id', todayStr, mealWithQuota);
    expect(sessionStorage.getItem(getStagedMealStorageKey('test-user-id'))).not.toBeNull();

    renderComponent();

    // 1. Staged meal card is restored after auth resolves
    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
    });

    // 2. Discard staged meal to reveal the input and verify aiQuota was restored
    const discardBtn = screen.getByLabelText('Discard staged meal');
    await act(async () => {
      fireEvent.click(discardBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('staged-meal-card')).toBeNull();
    });

    // 3. Quota warning is displayed with restored draft's quota details
    await waitFor(() => {
      const warning = screen.getByTestId('ai-quota-warning');
      expect(warning).toBeDefined();
      expect(warning.textContent).toContain('2 of 10 left today');
    });
  });

  describe('stagedMealDraft utility robustness & boundary rejections', () => {
    it('setItem throws on first call -> stored draft has no photoUrl', () => {
      const storageKey = getStagedMealStorageKey('test-user-id');
      const mealWithPhoto: StagedMeal = {
        ...sampleAiMeal,
        photoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
      };

      const originalSetItem = Storage.prototype.setItem;
      let callCount = 0;
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === storageKey) {
          callCount += 1;
          if (callCount === 1) {
            const quotaErr = new Error('QuotaExceededError');
            quotaErr.name = 'QuotaExceededError';
            throw quotaErr;
          }
        }
        return originalSetItem.call(this, k, v);
      });

      try {
        saveStagedMealDraft('test-user-id', todayStr, mealWithPhoto);
        expect(callCount).toBe(2);
        const restored = loadStagedMealDraft('test-user-id', todayStr);
        expect(restored).not.toBeNull();
        expect(restored?.name).toBe(mealWithPhoto.name);
        expect(restored?.items).toEqual(mealWithPhoto.items);
        expect(restored?.photoUrl).toBeUndefined();
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it('throws always -> key removed (old draft gone)', () => {
      const storageKey = getStagedMealStorageKey('test-user-id');
      // Pre-seed an existing draft
      saveStagedMealDraft('test-user-id', todayStr, sampleAiMeal);
      expect(sessionStorage.getItem(storageKey)).not.toBeNull();

      const originalSetItem = Storage.prototype.setItem;
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === storageKey) {
          const quotaErr = new Error('QuotaExceededError');
          quotaErr.name = 'QuotaExceededError';
          throw quotaErr;
        }
        return originalSetItem.call(this, k, v);
      });

      try {
        const newMeal: StagedMeal = {
          ...sampleAiMeal,
          name: 'New Failing Meal',
          photoUrl: 'data:image/jpeg;base64,large...',
        };
        saveStagedMealDraft('test-user-id', todayStr, newMeal);
        // Key must be removed so stale draft does not resurrect
        expect(sessionStorage.getItem(storageKey)).toBeNull();
        expect(loadStagedMealDraft('test-user-id', todayStr)).toBeNull();
      } finally {
        setItemSpy.mockRestore();
      }
    });
    it('swallows corrupted JSON without crashing and cleans up the key', () => {
      const storageKey = getStagedMealStorageKey('test-user-id');
      sessionStorage.setItem(storageKey, '{ invalid: json }');

      const restored = loadStagedMealDraft('test-user-id', todayStr);
      expect(restored).toBeNull();
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('clears storage key when empty meal or zero-items meal is saved', () => {
      const storageKey = getStagedMealStorageKey('test-user-id');
      saveStagedMealDraft('test-user-id', todayStr, sampleAiMeal);
      expect(sessionStorage.getItem(storageKey)).not.toBeNull();

      saveStagedMealDraft('test-user-id', todayStr, { ...sampleAiMeal, items: [] });
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('clearAllStagedMealDrafts removes all staged meal drafts across users', () => {
      saveStagedMealDraft('user-1', todayStr, sampleAiMeal);
      saveStagedMealDraft('user-2', todayStr, sampleDeviceMeal);
      sessionStorage.setItem('other_app_key', 'keep-me');

      clearAllStagedMealDrafts();

      expect(sessionStorage.getItem(getStagedMealStorageKey('user-1'))).toBeNull();
      expect(sessionStorage.getItem(getStagedMealStorageKey('user-2'))).toBeNull();
      expect(sessionStorage.getItem('other_app_key')).toBe('keep-me');
    });

    it('handles undefined or null userId safely without throwing', () => {
      expect(loadStagedMealDraft(null, todayStr)).toBeNull();
      expect(loadStagedMealDraft(undefined, todayStr)).toBeNull();
      saveStagedMealDraft(null, todayStr, sampleAiMeal);
      clearStagedMealDraft(null);
    });
  });
});
