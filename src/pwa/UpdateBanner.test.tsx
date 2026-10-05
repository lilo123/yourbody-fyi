import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpdateBanner } from './UpdateBanner';
import {
  setUpdateAvailableForTesting,
  setUpdateSWFnForTesting,
  resetAppUpdateForTesting,
} from './useAppUpdate';
import {
  markFormDirty,
  resetUpdateSafetyForTesting,
} from './updateSafety';
import { workoutSessionStore, type ActiveWorkoutSession } from '../utils/workoutSessionStore';
import * as outboxModule from '../offline/outbox';
import { AuthContext } from '../context/AuthContextTypes';
import type { User } from '@supabase/supabase-js';

const mockUserId = '00000000-0000-4000-8000-000000000001';

const mockAuthContext = {
  user: { id: mockUserId, email: 'test@yourbody.fyi' } as User,
  profile: null,
  role: 'athlete' as const,
  isCoach: false,
  isCoachMode: false,
  loading: false,
  authRequired: false,
  pendingCount: 0,
  attentionCount: 0,
  isSyncing: false,
  needsAttentionOps: [],
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
  setCoachMode: vi.fn(),
  refreshAttentionOps: vi.fn(),
};

function renderWithProviders(ui: React.ReactElement, authOverride = mockAuthContext) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authOverride as any}>
        {ui}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

describe('UpdateBanner Component per D-YB2-3', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAppUpdateForTesting();
    resetUpdateSafetyForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    resetAppUpdateForTesting();
    resetUpdateSafetyForTesting();
    vi.restoreAllMocks();
  });

  it('renders nothing when no update is available', () => {
    const { container } = renderWithProviders(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders persistent update banner when update is available', () => {
    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    expect(screen.getByText(/Update available/i)).toBeInTheDocument();
    expect(screen.getByText(/Reload/i)).toBeInTheDocument();
  });

  it('when clear: calls applyUpdate and flushes pending writes', async () => {
    const mockApplyUpdate = vi.fn().mockResolvedValue(undefined);
    setUpdateSWFnForTesting(mockApplyUpdate);
    const flushSpy = vi.spyOn(workoutSessionStore, 'flushPendingWrites');

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    expect(flushSpy).toHaveBeenCalled();
    expect(mockApplyUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('update-confirm-dialog')).toBeNull();
  });

  it('when hard blocked: button is disabled with reason text and does not apply update', async () => {
    const mockApplyUpdate = vi.fn().mockResolvedValue(undefined);
    setUpdateSWFnForTesting(mockApplyUpdate);
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(true);

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    expect(reloadBtn).toBeDisabled();

    const reasonEl = screen.getByTestId('update-block-reason');
    expect(reasonEl).toHaveTextContent('Syncing changes in progress');

    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    expect(mockApplyUpdate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('update-confirm-dialog')).toBeNull();
  });

  it('when hard blocker clears: button re-enables automatically', async () => {
    let isSyncing = true;
    vi.spyOn(outboxModule, 'getSyncingStatus').mockImplementation(() => isSyncing);

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    expect(reloadBtn).toBeDisabled();

    // Replay finishes
    isSyncing = false;
    act(() => {
      outboxModule.notifyOutboxChanged();
    });

    expect(reloadBtn).not.toBeDisabled();
    expect(screen.queryByTestId('update-block-reason')).toBeNull();
  });

  it('when soft blocked by workout draft: opens ConfirmDialog and Keep logging keeps draft & banner', async () => {
    const activeSession: ActiveWorkoutSession = {
      schemaVersion: 1,
      sessionId: 'sess_active',
      userId: mockUserId,
      workoutDate: '2026-10-02',
      routineName: 'Chest Day',
      exercises: ['Bench Press'],
      targetSetCounts: { 'Bench Press': 3 },
      targetRepCounts: { 'Bench Press': 10 },
      expandedExercises: ['Bench Press'],
      inputDrafts: { 'Bench Press_0': { weight: '135', reps: '10' } },
      startedAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString(),
      completedAt: null,
    };
    workoutSessionStore.saveSession(activeSession, true);

    const mockApplyUpdate = vi.fn().mockResolvedValue(undefined);
    setUpdateSWFnForTesting(mockApplyUpdate);

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    expect(reloadBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    // Confirm dialog opened
    expect(screen.getByTestId('update-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByText('Update now?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your open workout and the values you typed will still be here after the update.'
      )
    ).toBeInTheDocument();

    // Secondary button: Keep logging
    const cancelBtn = screen.getByTestId('update-confirm-dialog-cancel');
    expect(cancelBtn).toHaveTextContent('Keep logging');

    await act(async () => {
      fireEvent.click(cancelBtn);
    });

    // Dialog closed, banner stays, update not applied
    expect(screen.queryByTestId('update-confirm-dialog')).toBeNull();
    expect(screen.getByTestId('update-banner')).toBeInTheDocument();
    expect(mockApplyUpdate).not.toHaveBeenCalled();
  });

  it('when soft blocked: Reload now in dialog flushes writes and calls applyUpdate', async () => {
    const activeSession: ActiveWorkoutSession = {
      schemaVersion: 1,
      sessionId: 'sess_active',
      userId: mockUserId,
      workoutDate: '2026-10-02',
      routineName: 'Chest Day',
      exercises: ['Bench Press'],
      targetSetCounts: { 'Bench Press': 3 },
      targetRepCounts: { 'Bench Press': 10 },
      expandedExercises: ['Bench Press'],
      inputDrafts: { 'Bench Press_0': { weight: '135', reps: '10' } },
      startedAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString(),
      completedAt: null,
    };
    workoutSessionStore.saveSession(activeSession, true);

    const mockApplyUpdate = vi.fn().mockResolvedValue(undefined);
    setUpdateSWFnForTesting(mockApplyUpdate);
    const flushSpy = vi.spyOn(workoutSessionStore, 'flushPendingWrites');

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    const confirmBtn = screen.getByTestId('update-confirm-dialog-confirm');
    expect(confirmBtn).toHaveTextContent('Reload now');

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(flushSpy).toHaveBeenCalled();
    expect(mockApplyUpdate).toHaveBeenCalledTimes(1);
  });

  it('renders exact consequence strings for outbox (singular and plural), meal, and form', async () => {
    // 1. Single pending change
    vi.spyOn(outboxModule, 'getSyncingStatus').mockReturnValue(false);
    vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
      pending: 1,
      attention: 0,
      syncing: false,
      authRequired: false,
      lastSyncedCount: 0,
      needsAttentionOps: [],
    });

    markFormDirty('staged-meal', true);
    markFormDirty('custom-profile-form', true);

    renderWithProviders(<UpdateBanner />);

    act(() => {
      setUpdateAvailableForTesting(true);
    });

    const reloadBtn = screen.getByTestId('update-reload-btn');
    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    expect(
      screen.getByText('1 change waiting to sync will sync after the update.')
    ).toBeInTheDocument();
    expect(screen.getByText("The meal you're editing will be lost.")).toBeInTheDocument();
    expect(screen.getByText('Unsaved form changes will be lost.')).toBeInTheDocument();

    // Close dialog
    fireEvent.click(screen.getByTestId('update-confirm-dialog-cancel'));

    // 2. Plural pending changes (e.g. 3 changes)
    vi.spyOn(outboxModule, 'getCachedOutboxSummary').mockReturnValue({
      pending: 3,
      attention: 0,
      syncing: false,
      authRequired: false,
      lastSyncedCount: 0,
      needsAttentionOps: [],
    });

    await act(async () => {
      fireEvent.click(reloadBtn);
    });

    expect(
      screen.getByText('3 changes waiting to sync will sync after the update.')
    ).toBeInTheDocument();
  });
});
