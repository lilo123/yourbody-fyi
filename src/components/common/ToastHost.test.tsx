import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from '../../context/ToastContext';
import { useToast } from '../../hooks/useToast';
import { ToastHost } from './ToastHost';

const TestConsumer: React.FC = () => {
  const { show, dismiss } = useToast();
  return (
    <div>
      <button
        data-testid="show-success"
        onClick={() => show({ message: 'Success message', kind: 'success' })}
      >
        Show Success
      </button>
      <button
        data-testid="show-info"
        onClick={() => show({ message: 'Info message', kind: 'info' })}
      >
        Show Info
      </button>
      <button
        data-testid="show-undo"
        onClick={() =>
          show({
            verb: 'Deleted',
            subject: 'Workout Set',
            kind: 'undo',
            onUndo: () => {},
            onCommit: () => {},
          })
        }
      >
        Show Undo
      </button>
      <button data-testid="dismiss-toast" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
};

const renderWithProvider = (ui: React.ReactNode = <TestConsumer />) => {
  return render(
    <ToastProvider>
      {ui}
      <ToastHost />
    </ToastProvider>
  );
};

describe('ToastHost Component & ToastContext (STD-FB-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live regions with role="status" and aria-live="polite" initially idle', () => {
    const { container } = renderWithProvider();
    const liveStatus = container.querySelector('[role="status"]');
    expect(liveStatus).not.toBeNull();
    expect(liveStatus?.getAttribute('aria-live')).toBe('polite');
    expect(liveStatus?.textContent).toBe('');
    expect(screen.queryByTestId('toast-dish-text')).toBeNull();
  });

  it('auto-dismisses success toast after 4000ms default duration', () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId('show-success').click();
    });

    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Success message');

    // Advance 3999ms: still visible
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Success message');

    // Advance 1ms: dismissed
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('toast-dish-text')).toBeNull();
  });

  it('auto-dismisses undo toast after 6000ms default duration', () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId('show-undo').click();
    });

    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Workout Set');

    // Advance 5999ms: still visible
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Workout Set');

    // Advance 1ms: dismissed
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('toast-dish-text')).toBeNull();
  });

  it('enforces maximum ONE visible toast at a time by replacing previous toast', () => {
    renderWithProvider();

    act(() => {
      screen.getByTestId('show-success').click();
    });
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Success message');

    act(() => {
      screen.getByTestId('show-info').click();
    });
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Info message');
    expect(screen.queryByText('Success message')).toBeNull();
  });

  it('immediately commits pending action of an undo toast when replaced by another toast', () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    const TriggerComponent: React.FC = () => {
      const { show } = useToast();
      return (
        <div>
          <button
            data-testid="trigger-undo"
            onClick={() =>
              show({
                kind: 'undo',
                verb: 'Deleted',
                subject: 'Bench Press Set',
                onCommit,
                onUndo,
              })
            }
          >
            Delete Set
          </button>
          <button
            data-testid="trigger-second"
            onClick={() => show({ message: 'Second Toast', kind: 'success' })}
          >
            Second Toast
          </button>
        </div>
      );
    };

    renderWithProvider(<TriggerComponent />);

    act(() => {
      screen.getByTestId('trigger-undo').click();
    });
    expect(onCommit).not.toHaveBeenCalled();

    // Showing second toast must flush and commit the first undo toast immediately
    act(() => {
      screen.getByTestId('trigger-second').click();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast-dish-text')).toHaveTextContent('Second Toast');
  });

  it('triggers onUndo callback when undo button is clicked and does NOT commit', async () => {
    const onCommit = vi.fn();
    const onUndo = vi.fn();

    const TriggerComponent: React.FC = () => {
      const { show } = useToast();
      return (
        <button
          data-testid="trigger-undo"
          onClick={() =>
            show({
              kind: 'undo',
              verb: 'Deleted',
              subject: 'Staged Meal',
              onCommit,
              onUndo,
            })
          }
        >
          Delete Meal
        </button>
      );
    };

    renderWithProvider(<TriggerComponent />);

    act(() => {
      screen.getByTestId('trigger-undo').click();
    });

    const undoBtn = screen.getByTestId('toast-undo-btn');
    expect(undoBtn).toBeDefined();

    act(() => {
      undoBtn.click();
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('toast-dish-text')).toBeNull();

    // Advance timers: onCommit should still NEVER be called
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits pending action exactly once upon timer expiry', () => {
    const onCommit = vi.fn();

    const TriggerComponent: React.FC = () => {
      const { show } = useToast();
      return (
        <button
          data-testid="trigger-undo"
          onClick={() =>
            show({
              kind: 'undo',
              verb: 'Deleted',
              subject: 'Custom Dish',
              onCommit,
            })
          }
        >
          Delete Dish
        </button>
      );
    };

    renderWithProvider(<TriggerComponent />);

    act(() => {
      screen.getByTestId('trigger-undo').click();
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);

    // Further timer advancement should not trigger duplicate commit
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('immediately commits pending action of an undo toast upon unmount', () => {
    const onCommit = vi.fn();

    const TriggerComponent: React.FC = () => {
      const { show } = useToast();
      return (
        <button
          data-testid="trigger-undo"
          onClick={() =>
            show({
              kind: 'undo',
              verb: 'Deleted',
              subject: 'Workout Set',
              onCommit,
            })
          }
        >
          Delete Set
        </button>
      );
    };

    const { unmount } = renderWithProvider(<TriggerComponent />);

    act(() => {
      screen.getByTestId('trigger-undo').click();
    });
    expect(onCommit).not.toHaveBeenCalled();

    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  describe('modal-open vs closed lane positioning (D-YB5-T1..T4, D-YB6-1, D-YB6-2)', () => {
    it('renders toast in bottom lane when no modal is open', () => {
      renderWithProvider();

      act(() => {
        screen.getByTestId('show-success').click();
      });

      const toast = screen.getByTestId('quick-log-toast');
      expect(toast.style.bottom).not.toBe('');
      expect(toast.style.top).toBe('');
      expect(toast.className).toContain('z-[65]');
      expect(toast.className).toContain('slide-in-from-bottom-3');
    });

    it('renders toast in bottom lane with modal avoidance when a modal is open in the DOM (D-YB6-1, D-YB6-2)', async () => {
      let modalEl: HTMLDivElement | null = null;
      await act(async () => {
        modalEl = document.createElement('div');
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(modalEl);
      });

      try {
        renderWithProvider();

        await act(async () => {
          screen.getByTestId('show-success').click();
        });

        const toast = screen.getByTestId('quick-log-toast');
        expect(toast.style.bottom).not.toBe('');
        expect(toast.style.top).toBe('');
        expect(toast.className).toContain('z-[65]');
        expect(toast.className).toContain('slide-in-from-bottom-3');
      } finally {
        if (modalEl && (modalEl as HTMLElement).parentNode) {
          await act(async () => {
            document.body.removeChild(modalEl!);
          });
        }
      }
    });

    it('remains bottom-anchored when modal is mounted or unmounted while toast is visible', async () => {
      renderWithProvider();

      act(() => {
        screen.getByTestId('show-success').click();
      });

      const toast = screen.getByTestId('quick-log-toast');
      expect(toast.style.bottom).not.toBe('');
      expect(toast.style.top).toBe('');

      // Mount modal dialog
      let modalEl: HTMLDivElement | null = null;
      await act(async () => {
        modalEl = document.createElement('div');
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(modalEl);
        await Promise.resolve();
      });

      expect(toast.style.bottom).not.toBe('');
      expect(toast.style.top).toBe('');

      // Unmount modal dialog
      await act(async () => {
        document.body.removeChild(modalEl!);
        await Promise.resolve();
      });

      expect(toast.style.bottom).not.toBe('');
      expect(toast.style.top).toBe('');
    });

    it('raises bottom offset when modal contains action row intersecting bottom lane', async () => {
      let modalEl: HTMLDivElement | null = null;
      let actionsEl: HTMLDivElement | null = null;

      await act(async () => {
        modalEl = document.createElement('div');
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');

        actionsEl = document.createElement('div');
        actionsEl.setAttribute('data-testid', 'staged-card-actions');
        modalEl.appendChild(actionsEl);

        document.body.appendChild(modalEl);
      });

      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(852);
      vi.spyOn(modalEl!, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      // Staged actions at top=750, height=50 in 852px viewport -> lane intersection raises offset to 852-750+8 = 110px
      vi.spyOn(actionsEl!, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 750, width: 393, height: 50, top: 750, bottom: 800, left: 0, right: 393, toJSON: () => {},
      });

      try {
        renderWithProvider();

        await act(async () => {
          screen.getByTestId('show-success').click();
        });

        const toast = screen.getByTestId('quick-log-toast');
        expect(toast.style.bottom).toBe('110px');
        expect(toast.style.top).toBe('');
      } finally {
        if (modalEl && (modalEl as HTMLElement).parentNode) {
          await act(async () => {
            document.body.removeChild(modalEl!);
          });
        }
      }
    });
  });
});
