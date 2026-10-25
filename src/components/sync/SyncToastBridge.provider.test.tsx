import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '../../context/ToastContext';
import { useToast } from '../../hooks/useToast';
import { ToastHost } from '../common/ToastHost';
import { SyncToastBridge } from './SyncToastBridge';
import { onSynced } from '../../offline';

vi.mock('../../offline', () => ({
  onSynced: vi.fn(),
}));

const DeleteTrigger: React.FC<{
  onCommit: () => void;
  onUndo: () => void;
}> = ({ onCommit, onUndo }) => {
  const { show } = useToast();
  return (
    <button
      data-testid="delete-btn"
      onClick={() =>
        show({
          kind: 'undo',
          verb: 'Deleted',
          subject: 'Squat Set 1',
          durationMs: 6000,
          onCommit,
          onUndo,
        })
      }
    >
      Delete Set
    </button>
  );
};

describe('SyncToastBridge & ToastProvider interaction', () => {
  let syncCallback: ((count: number) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    syncCallback = null;

    vi.mocked(onSynced).mockImplementation((cb: (count: number) => void) => {
      syncCallback = cb;
      return () => {
        syncCallback = null;
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Order 1: Undo toast is active -> sync event arrives -> keeps Undo toast visible, does not commit delete early, queues sync notice after expiry', () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    render(
      <ToastProvider>
        <SyncToastBridge />
        <DeleteTrigger onCommit={onCommit} onUndo={onUndo} />
        <ToastHost />
      </ToastProvider>
    );

    // 1. User deletes set -> shows Undo toast
    act(() => {
      screen.getByTestId('delete-btn').click();
    });

    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Squat Set 1');
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    // 2. Background sync completes and emits onSynced event
    act(() => {
      syncCallback!(2);
    });

    // Undo toast remains available, delete is not committed
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Squat Set 1');

    // 3. Advance to 5999ms: still visible, still not committed
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();

    // 4. Advance 1ms to reach 6000ms: Undo toast expires, commits, and queued sync notice displays
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Synced 2 changes');
    expect(screen.queryByTestId('toast-undo-btn')).toBeNull();

    // 5. Advance 4000ms: sync toast dismisses
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByTestId('toast-dish-text')).toBeNull();
  });

  it('Order 1 with Undo clicked: Undo toast active -> sync arrives -> user clicks Undo -> cancel delete, queued sync notice appears', () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    render(
      <ToastProvider>
        <SyncToastBridge />
        <DeleteTrigger onCommit={onCommit} onUndo={onUndo} />
        <ToastHost />
      </ToastProvider>
    );

    // 1. User deletes set -> shows Undo toast
    act(() => {
      screen.getByTestId('delete-btn').click();
    });

    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Squat Set 1');
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();

    // 2. Sync arrives moments later
    act(() => {
      syncCallback!(1);
    });

    // Undo toast still active
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    // 3. User clicks Undo button before window expires
    act(() => {
      screen.getByTestId('toast-undo-btn').click();
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    // Queued sync notice now shows
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Synced 1 change');
    expect(screen.queryByTestId('toast-undo-btn')).toBeNull();

    // Timers advance: onCommit is NEVER called
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Order 2: Sync toast is active -> user deletes set -> Undo toast immediately replaces sync notice', () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    render(
      <ToastProvider>
        <SyncToastBridge />
        <DeleteTrigger onCommit={onCommit} onUndo={onUndo} />
        <ToastHost />
      </ToastProvider>
    );

    // 1. Sync event arrives first
    act(() => {
      syncCallback!(3);
    });

    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Synced 3 changes');
    expect(screen.queryByTestId('toast-undo-btn')).toBeNull();

    // 2. User deletes set while sync toast is visible
    act(() => {
      screen.getByTestId('delete-btn').click();
    });

    // Undo toast replaces sync toast immediately
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Squat Set 1');
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    // 3. Undo window expires normally after 6000ms
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('accumulates multiple sync events that arrive while an Undo toast is active', () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    render(
      <ToastProvider>
        <SyncToastBridge />
        <DeleteTrigger onCommit={onCommit} onUndo={onUndo} />
        <ToastHost />
      </ToastProvider>
    );

    // 1. User deletes set
    act(() => {
      screen.getByTestId('delete-btn').click();
    });

    // 2. Multiple sync flushes arrive while Undo toast is visible
    act(() => {
      syncCallback!(1);
    });
    act(() => {
      syncCallback!(4);
    });

    // Still showing Undo toast, delete not committed
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Squat Set 1');
    expect(screen.getByTestId('toast-undo-btn')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    // 3. Window expires: accumulated total (1 + 4 = 5) is displayed
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Synced 5 changes');
  });
});
