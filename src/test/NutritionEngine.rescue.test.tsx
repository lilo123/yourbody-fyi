import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NutritionEngine } from '../components/nutrition/NutritionEngine';
import { ToastProvider } from '../context/ToastContext';
import { ToastHost } from '../components/common/ToastHost';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../context/AuthContext';
import { CoachProvider } from '../context/CoachContext';
import { supabase } from '../lib/supabase';
import { createSupabaseBuilder } from './supabaseBuilderMock';
import { getLocalDateStr } from '../utils/date';
import * as aiRescueModule from '../offline/aiRescue';
import {
  getOfflineDb,
  deleteOfflineDb,
  closeAllOfflineDbs,
  enqueue,
  getOutboxOps,
  getLegacyAiQueueItems,
  executeReplayOp,
  type OutboxOpNutritionLog,
} from '../offline';
import type { StagedMeal } from '../components/nutrition/nutritionEngineHelpers';
import { saveStagedMealDraft, clearStagedMealDraft } from '../components/nutrition/stagedMealDraft';

const mockUserId = 'test-rescue-user-42';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'test-rescue-user-42', email: 'rescue-test@example.com' },
    access_token: 'mock-jwt-token-rescue',
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
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-rescue-user-42' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: mockSession } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    functions: {
      invoke: vi.fn(),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

describe('NutritionEngine Legacy AI Queue Leftover Rescue', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem(
      'yourbody_user',
      JSON.stringify({
        id: mockUserId,
        email: 'rescue-test@example.com',
        username: 'athlete',
        role: 'athlete',
      })
    );
    clearStagedMealDraft(mockUserId);
    await closeAllOfflineDbs();
    await deleteOfflineDb(mockUserId);

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: mockUserId } } });
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

  afterEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    clearStagedMealDraft(mockUserId);
    await closeAllOfflineDbs();
    await deleteOfflineDb(mockUserId);
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CoachProvider>
            <ToastProvider>
              <NutritionEngine />
              <ToastHost />
            </ToastProvider>
          </CoachProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

  it('leftover legacy item -> input prefilled with its text + queue emptied of it', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'legacy-meal-1',
      userId: mockUserId,
      kind: 'text',
      text: '2 scrambled eggs and 1 slice toast',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    // Textarea is prefilled with legacy meal text
    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe('2 scrambled eggs and 1 slice toast');
    });

    // Queue is emptied of the legacy item
    await waitFor(async () => {
      const remaining = await getLegacyAiQueueItems(mockUserId);
      expect(remaining).toHaveLength(0);
    });
  });

  it('two leftovers -> joined text with blank line between, both removed', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'legacy-meal-a',
      userId: mockUserId,
      kind: 'text',
      text: 'Salmon bowl with avocado',
      capturedAt: '2026-10-01T12:00:00.000Z',
      status: 'queued',
    });
    await db.put('aiq', {
      id: 'legacy-meal-b',
      userId: mockUserId,
      kind: 'text',
      text: 'Greek yogurt with honey and walnuts',
      capturedAt: '2026-10-01T15:00:00.000Z',
      status: 'queued',
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(
        'Salmon bowl with avocado\n\nGreek yogurt with honey and walnuts'
      );
    });

    await waitFor(async () => {
      const remaining = await getLegacyAiQueueItems(mockUserId);
      expect(remaining).toHaveLength(0);
    });
  });

  it('no leftover -> nothing changes (input empty, outbox untouched)', async () => {
    await enqueue({
      userId: mockUserId,
      kind: 'nutrition.log',
      payload: {
        id: 'outbox-meal-unaffected',
        user_id: mockUserId,
        food_name: 'Existing Log',
        calories: 300,
        logged_at: '2026-10-01T10:00:00.000Z',
        logged_date: '2026-10-01',
      },
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    // Input remains empty
    expect((input as HTMLTextAreaElement).value).toBe('');

    // Outbox untouched
    const outboxOps = await getOutboxOps(mockUserId);
    expect(outboxOps).toHaveLength(1);
    expect(outboxOps[0].kind).toBe('nutrition.log');
    if (outboxOps[0].kind === 'nutrition.log') {
      expect(outboxOps[0].payload.food_name).toBe('Existing Log');
    }
  });

  it('restored staged draft shown -> leftovers kept, staged meal card shown', async () => {
    const today = getLocalDateStr(new Date());
    const staged: StagedMeal = {
      name: 'Restored Draft Oatmeal',
      mealType: 'Breakfast',
      explanation: '300 kcal (Restored Draft Oatmeal)',
      items: [
        {
          id: 'item-1',
          name: 'Oatmeal',
          portion: '1 bowl',
          quantity: 1,
          unit: 'unit',
          calories: 300,
          protein: 10,
          carbs: 50,
          fat: 5,
          fiber: 4,
          baseQuantity: 1,
          baseCalories: 300,
          baseProtein: 10,
          baseCarbs: 50,
          baseFat: 5,
          baseFiber: 4,
          portionMultiplier: 1,
          userOverridden: false,
        },
      ],
      calories: 300,
      protein: 10,
      carbs: 50,
      fat: 5,
      fiber: 4,
      servingSize: 1,
      servingUnit: 'bowl',
      source: 'local',
      confidence: 'exact',
    };
    saveStagedMealDraft(mockUserId, today, staged);

    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'legacy-meal-deferred',
      userId: mockUserId,
      kind: 'text',
      text: 'Deferred leftover text',
      capturedAt: '2026-10-01T09:00:00.000Z',
      status: 'queued',
    });

    renderComponent();

    // Staged meal card is displayed
    await waitFor(() => {
      expect(screen.getByTestId('staged-meal-card')).toBeDefined();
      const nameInput = screen.getByTestId('dish-name-input') as HTMLInputElement;
      expect(nameInput.value).toBe('Restored Draft Oatmeal');
      expect(screen.getByText('Oatmeal')).toBeDefined();
    });

    // Leftovers remain in 'aiq' store for a later load
    const remaining = await getLegacyAiQueueItems(mockUserId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Deferred leftover text');
  });

  it('other outbox ops still replay after the removal', async () => {
    const mockSupabaseClient = {
      from: vi.fn().mockImplementation((table: string) => {
        return createSupabaseBuilder(table, {
          data: [{ id: 'server-confirmed-meal-id' }],
          error: null,
        });
      }),
    } as any;

    const op: OutboxOpNutritionLog = {
      opId: 'outbox-op-test-1',
      userId: mockUserId,
      seq: 1,
      createdAt: new Date().toISOString(),
      attempts: 0,
      state: 'pending',
      kind: 'nutrition.log',
      payload: {
        id: 'client-meal-uuid-1',
        user_id: mockUserId,
        food_name: 'Grilled Steak and Sweet Potato',
        calories: 550,
        protein: 48,
        carbs: 45,
        fat: 18,
        fiber: 5,
        meal_type: 'Dinner',
        logged_at: '2026-10-01T19:00:00.000Z',
        logged_date: '2026-10-01',
        source: 'device',
      },
    };

    const replayResult = await executeReplayOp(op, mockSupabaseClient);
    expect(replayResult.canonicalId).toBe('client-meal-uuid-1');

    expect(mockSupabaseClient.from).toHaveBeenCalledWith('nutrition_logs');
  });

  it('unmount mid-rescue -> nothing deleted from store', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'legacy-meal-unmount',
      userId: mockUserId,
      kind: 'text',
      text: 'Protein pancakes',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    });

    const { unmount } = renderComponent();
    unmount();

    // Allow in-flight read promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));

    const remaining = await getLegacyAiQueueItems(mockUserId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('legacy-meal-unmount');
    expect(remaining[0].text).toBe('Protein pancakes');
  });

  it('user typed before write -> nothing deleted from store', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'legacy-meal-typed-race',
      userId: mockUserId,
      kind: 'text',
      text: 'Rescued salmon wrap',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    });

    // Simulate slower IndexedDB read to allow concurrent user typing
    const origRead = aiRescueModule.readLegacyAiQueueLeftovers;
    const spy = vi.spyOn(aiRescueModule, 'readLegacyAiQueueLeftovers').mockImplementation(async (uid) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return origRead(uid);
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    // User types into input while rescue read is in flight
    fireEvent.change(input, { target: { value: 'User freshly typed lunch' } });

    // Wait for the delayed read to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Input must preserve user's typed text
    expect((input as HTMLTextAreaElement).value).toBe('User freshly typed lunch');

    // Nothing deleted from store
    const remaining = await getLegacyAiQueueItems(mockUserId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('legacy-meal-typed-race');
    expect(remaining[0].text).toBe('Rescued salmon wrap');

    spy.mockRestore();
  });

  it('photo-only item -> kept in store, text items rescued into input', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'photo-only-legacy',
      userId: mockUserId,
      kind: 'photo',
      photo: { dataUrl: 'data:image/jpeg;base64,abcdef' },
      text: '', // photo-only item
      capturedAt: '2026-10-01T07:00:00.000Z',
      status: 'queued',
    });
    await db.put('aiq', {
      id: 'text-legacy',
      userId: mockUserId,
      kind: 'text',
      text: 'Oatmeal with berries',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe('Oatmeal with berries');
    });

    // Photo-only item is preserved in store; text item is deleted
    await waitFor(async () => {
      const remaining = await getLegacyAiQueueItems(mockUserId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('photo-only-legacy');
    });
  });

  it('mismatched userId -> kept in store, not rescued into input', async () => {
    const db = await getOfflineDb(mockUserId);
    await db.put('aiq', {
      id: 'other-user-legacy',
      userId: 'different-user-12345',
      kind: 'text',
      text: 'Other user private meal',
      capturedAt: '2026-10-01T08:00:00.000Z',
      status: 'queued',
    });

    renderComponent();

    const input = await screen.findByPlaceholderText(
      'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
    );

    // Give it a moment to run rescue effect
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Input remains empty
    expect((input as HTMLTextAreaElement).value).toBe('');

    // Other user's item remains untouched in store
    const remaining = await getLegacyAiQueueItems(mockUserId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('other-user-legacy');
  });

  it('handles rejected readLegacyAiQueueLeftovers promise without unhandled rejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandledRejections: any[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);

    const spy = vi.spyOn(aiRescueModule, 'readLegacyAiQueueLeftovers').mockRejectedValue(
      new Error('IndexedDB storage corrupted')
    );

    try {
      renderComponent();

      const input = await screen.findByPlaceholderText(
        'Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)'
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect((input as HTMLTextAreaElement).value).toBe('');
      expect(unhandledRejections).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[aiRescue] Failed to rescue legacy queue leftovers:'),
        expect.any(Error)
      );
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
      window.removeEventListener('unhandledrejection', onUnhandled);
    }
  });
});
