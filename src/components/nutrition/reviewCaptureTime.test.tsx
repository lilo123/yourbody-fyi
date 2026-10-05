import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NutritionEngine } from './NutritionEngine';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';
import { AuthProvider } from '../../context/AuthContext';
import { CoachProvider } from '../../context/CoachContext';
import { supabase } from '../../lib/supabase';
import { createSupabaseBuilder, clearMockHistory, getRecordedSelects, getRecordedTables } from '../../test/supabaseBuilderMock';
import { getLocalDateStr, formatLocalTimestamp, localCivilToUtcMs } from '../../utils/date';
import {
  getOfflineDb,
  listAiItems,
  notifyAiQueueChanged,
  deleteOfflineDb,
  closeAllOfflineDbs,
  type AiQueueItem,
  type NutritionLogPayload,
} from '../../offline';
import * as offlineModule from '../../offline';

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    user: { id: 'user-review-capture-test', email: 'athlete@example.com' },
    access_token: 'mock-jwt-token-review',
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

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('../../offline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../offline')>();
  return {
    ...actual,
    enqueueAndAwait: vi.fn(),
  };
});

describe('reviewCaptureTime - O2 capture date and original timestamp preservation (§N6, §D-OFF-7, §D-O2-2)', () => {
  const mockUserId = 'user-review-capture-test';
  let queryClient: QueryClient;

  function setupUserWithTimezone(timeZone: string) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        'yourbody_user',
        JSON.stringify({
          id: mockUserId,
          email: 'athlete@example.com',
          username: 'athlete',
          role: 'athlete',
          timezone: timeZone,
        })
      );
      localStorage.setItem(`yourbody_user_timezone_${mockUserId}`, timeZone);
    }

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'users') {
        return createSupabaseBuilder(table, {
          data: {
            id: mockUserId,
            email: 'athlete@example.com',
            username: 'athlete',
            role: 'athlete',
            timezone: timeZone,
            pr_mode: 'weight',
          },
          error: null,
        });
      }
      return createSupabaseBuilder(table, { data: [], error: null });
    });
  }

  async function seedReadyAiItem(options: {
    capturedAt: string;
    captureDate: string;
    mealName?: string;
  }): Promise<AiQueueItem> {
    const db = await getOfflineDb(mockUserId);
    const item: AiQueueItem = {
      id: 'aiq-ready-' + Math.random().toString(36).slice(2, 9),
      userId: mockUserId,
      kind: 'photo',
      capturedAt: options.capturedAt,
      captureDate: options.captureDate,
      mealType: 'Dinner',
      status: 'ready',
      result: {
        name: options.mealName || 'Tokyo Salmon Bento',
        calories: 650,
        protein: 45,
        carbs: 70,
        fat: 18,
        fiber: 5,
        servingSize: 1,
        servingUnit: 'bento',
        explanation: '650 kcal (Tokyo Salmon Bento)',
        items: [
          {
            name: 'Salmon Fillet',
            portion: '1 fillet',
            quantity: 1,
            unit: 'fillet',
            calories: 350,
            protein: 38,
            carbs: 0,
            fat: 16,
            fiber: 0,
          },
          {
            name: 'Steamed Rice',
            portion: '1 cup',
            quantity: 1,
            unit: 'cup',
            calories: 300,
            protein: 7,
            carbs: 70,
            fat: 2,
            fiber: 5,
          },
        ],
      },
      attempts: 1,
      nextAttemptAt: 0,
    };
    await db.put('aiq', item);
    await listAiItems(mockUserId);
    notifyAiQueueChanged(mockUserId);
    return item;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    clearMockHistory();
    await closeAllOfflineDbs();
    await deleteOfflineDb(mockUserId);

    (supabase.auth.getUser as any).mockResolvedValue({ data: { user: { id: mockUserId } } });
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: mockSession } });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeAllOfflineDbs();
    await deleteOfflineDb(mockUserId);
  });

  const renderNutrition = () =>
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

  it('preserves D-1 captureDate and exact capturedAt string for Asia/Tokyo user when logging from Pending review', async () => {
    // 1. Pin vi.setSystemTime to local civil day D at 00:20
    const localNow = new Date(2026, 9, 2, 0, 20, 0, 0); // Oct 2, 2026 00:20 local
    vi.setSystemTime(localNow);

    const todayD = getLocalDateStr(new Date());
    expect(todayD).toBe('2026-10-02');
    const dayDMinus1 = '2026-10-01';

    // User profile in Asia/Tokyo
    setupUserWithTimezone('Asia/Tokyo');

    // Instant on day D-1 at 23:50 in Asia/Tokyo (UTC+9 -> 14:50:00 UTC)
    const capturedAtTokyo = new Date(
      localCivilToUtcMs(2026, 10, 1, 23, 50, 0, 0, 'Asia/Tokyo')
    ).toISOString();

    const seededItem = await seedReadyAiItem({
      capturedAt: capturedAtTokyo,
      captureDate: dayDMinus1,
      mealName: 'Tokyo Salmon Bento',
    });

    const enqueueMock = vi.mocked(offlineModule.enqueueAndAwait);
    enqueueMock.mockImplementation(async (input: any) => {
      const { incrementDishId, ...row } = input.payload;
      await (supabase.from('nutrition_logs') as any).upsert(row);
      return { status: 'synced', opId: 'op-tokyo-1' };
    });

    renderNutrition();

    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection:
        'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection:
        'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });

    // 2. Locate Pending review item and click Review
    const reviewBtn = await screen.findByTestId(`review-aiq-item-${seededItem.id}`);
    expect(reviewBtn).toBeInTheDocument();

    fireEvent.click(reviewBtn);

    // Staged meal card appears with Log button
    const logBtn = await screen.findByRole('button', { name: /Log Meal/i });
    expect(logBtn).toBeInTheDocument();

    // 4a. Zero payloads reaching outbox before confirm
    expect(enqueueMock).not.toHaveBeenCalled();

    // Item remains in IDB before confirm
    const db = await getOfflineDb(mockUserId);
    const itemBeforeConfirm = await db.get('aiq', seededItem.id);
    expect(itemBeforeConfirm).toBeDefined();
    expect(itemBeforeConfirm?.id).toBe(seededItem.id);

    // 2b. Click Log button on staged card
    fireEvent.click(logBtn);

    // 3. Assert outbox/upsert payload has logged_date === D-1 and logged_at === original capturedAt (exact string)
    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    });

    const outboxCall = enqueueMock.mock.calls[0][0];
    expect(outboxCall.kind).toBe('nutrition.log');
    const payload = outboxCall.payload as NutritionLogPayload;

    expect(payload.logged_date).toBe(dayDMinus1); // '2026-10-01'
    expect(payload.logged_at).toBe(capturedAtTokyo); // exact original capturedAt string
    expect(payload.logged_date).not.toBe(todayD); // NOT today D ('2026-10-02')
    expect(payload.logged_at).not.toBe(
      formatLocalTimestamp(todayD, undefined, 'Asia/Tokyo')
    ); // NOT D / now

    // 4b. Assert aiq item is deleted only after log enqueue succeeded
    await waitFor(async () => {
      const itemAfterConfirm = await db.get('aiq', seededItem.id);
      expect(itemAfterConfirm).toBeUndefined();
    });
  });

  it('preserves D-1 captureDate and exact capturedAt string for America/Los_Angeles user', async () => {
    // 1. Pin vi.setSystemTime to local civil day D at 00:20
    const localNow = new Date(2026, 9, 2, 0, 20, 0, 0); // Oct 2, 2026 00:20 local
    vi.setSystemTime(localNow);

    const todayD = getLocalDateStr(new Date());
    expect(todayD).toBe('2026-10-02');
    const dayDMinus1 = '2026-10-01';

    // User profile in America/Los_Angeles
    setupUserWithTimezone('America/Los_Angeles');

    // Instant on day D-1 at 23:50 in America/Los_Angeles (PDT UTC-7 -> 06:50:00 UTC next day)
    const capturedAtLA = new Date(
      localCivilToUtcMs(2026, 10, 1, 23, 50, 0, 0, 'America/Los_Angeles')
    ).toISOString();

    const seededItem = await seedReadyAiItem({
      capturedAt: capturedAtLA,
      captureDate: dayDMinus1,
      mealName: 'West Coast Avocado Toast',
    });

    const enqueueMock = vi.mocked(offlineModule.enqueueAndAwait);
    enqueueMock.mockImplementation(async (input: any) => {
      const { incrementDishId, ...row } = input.payload;
      await (supabase.from('nutrition_logs') as any).upsert(row);
      return { status: 'synced', opId: 'op-la-1' };
    });

    renderNutrition();

    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection:
        'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection:
        'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });

    const reviewBtn = await screen.findByTestId(`review-aiq-item-${seededItem.id}`);
    expect(reviewBtn).toBeInTheDocument();

    fireEvent.click(reviewBtn);

    const logBtn = await screen.findByRole('button', { name: /Log Meal/i });
    expect(logBtn).toBeInTheDocument();

    // Verify nothing is logged before confirm
    expect(enqueueMock).not.toHaveBeenCalled();

    // Confirm log
    fireEvent.click(logBtn);

    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    });

    const payload = enqueueMock.mock.calls[0][0].payload as NutritionLogPayload;
    expect(payload.logged_date).toBe(dayDMinus1);
    expect(payload.logged_at).toBe(capturedAtLA);
    expect(payload.logged_date).not.toBe(todayD);

    const db = await getOfflineDb(mockUserId);
    await waitFor(async () => {
      const itemAfterConfirm = await db.get('aiq', seededItem.id);
      expect(itemAfterConfirm).toBeUndefined();
    });
  });

  it('keeps item in aiq store if log enqueue rejects with an error', async () => {
    const localNow = new Date(2026, 9, 2, 0, 20, 0, 0);
    vi.setSystemTime(localNow);

    setupUserWithTimezone('Asia/Tokyo');

    const capturedAt = new Date(
      localCivilToUtcMs(2026, 10, 1, 23, 50, 0, 0, 'Asia/Tokyo')
    ).toISOString();

    const seededItem = await seedReadyAiItem({
      capturedAt,
      captureDate: '2026-10-01',
      mealName: 'Failing Log Item',
    });

    // Mock enqueue to fail
    const enqueueMock = vi.mocked(offlineModule.enqueueAndAwait);
    enqueueMock.mockRejectedValueOnce(new Error('Outbox write rejection'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderNutrition();

    expect(getRecordedTables()).toContain('custom_dishes');
    expect(getRecordedTables()).toContain('nutrition_logs');
    expect(getRecordedSelects()).toContainEqual({
      table: 'custom_dishes',
      projection:
        'id, user_id, name, calories, protein, carbs, fat, fiber, created_at, kind, use_count, notes',
    });
    expect(getRecordedSelects()).toContainEqual({
      table: 'nutrition_logs',
      projection:
        'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, logged_date, created_at, has_components',
    });

    const reviewBtn = await screen.findByTestId(`review-aiq-item-${seededItem.id}`);
    fireEvent.click(reviewBtn);

    const logBtn = await screen.findByRole('button', { name: /Log Meal/i });
    fireEvent.click(logBtn);

    await waitFor(() => {
      expect(enqueueMock).toHaveBeenCalledTimes(1);
    });

    // Item must be KEPT in IndexedDB store since enqueue failed
    const db = await getOfflineDb(mockUserId);
    const itemInDb = await db.get('aiq', seededItem.id);
    expect(itemInDb).toBeDefined();
    expect(itemInDb?.id).toBe(seededItem.id);
    expect(itemInDb?.status).toBe('ready');

    consoleErrorSpy.mockRestore();
  });
});
