import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UndoToast } from './UndoToast';
import { expectNoA11yViolations } from '../../test/a11y';

describe('UndoToast', () => {
  it('renders generic toast and passes accessibility audit', async () => {
    const handleUndo = vi.fn();
    const handleDismiss = vi.fn();

    const { container } = render(
      <UndoToast
        toast={{
          verb: 'Set deleted',
          subject: 'Bench Press',
          detail: '135 lb × 8',
          onUndo: handleUndo,
          undoAriaLabel: 'Undo delete Bench Press',
        }}
        onDismiss={handleDismiss}
      />
    );

    expect(screen.getByText('Set deleted')).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('135 lb × 8')).toBeInTheDocument();

    const undoBtn = screen.getByRole('button', { name: 'Undo delete Bench Press' });
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn.className).toContain('min-h-[44px]');

    fireEvent.click(undoBtn);
    expect(handleUndo).toHaveBeenCalledTimes(1);
    expect(handleDismiss).toHaveBeenCalledTimes(1);

    await expectNoA11yViolations(container);
  });

  describe('timer and interaction behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('omits Undo button when onUndo is not provided and showUndo is false', () => {
      render(
        <UndoToast
          toast={{
            verb: 'Exercise archived',
            subject: 'Incline Bench',
          }}
          onDismiss={vi.fn()}
        />
      );

      expect(screen.getByText('Exercise archived')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('pauses auto-hide timer on hover and resumes on mouse leave', () => {
      const handleDismiss = vi.fn();

      render(
        <UndoToast
          toast={{
            verb: 'Logged',
            subject: 'Power Bowl',
            onUndo: vi.fn(),
          }}
          durationMs={6000}
          onDismiss={handleDismiss}
        />
      );

      const undoBtn = screen.getByRole('button');

      // Advance 4000ms
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(handleDismiss).not.toHaveBeenCalled();

      // Hover button at 4000ms
      fireEvent.mouseEnter(undoBtn);

      // Advance past 6000ms (to 7000ms)
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(handleDismiss).not.toHaveBeenCalled();

      // Mouse leave -> should dismiss immediately since expired
      fireEvent.mouseLeave(undoBtn);
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });

    it('auto-dismisses after 6000ms by default', () => {
      const handleDismiss = vi.fn();

      render(
        <UndoToast
          toast={{
            verb: 'Logged',
            subject: 'Snack',
          }}
          onDismiss={handleDismiss}
        />
      );

      act(() => {
        vi.advanceTimersByTime(5900);
      });
      expect(handleDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(handleDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('layering and safe lane positioning (D-YB5-T1..T4, D-YB6-1)', () => {
    it('uses z-[65] layering tier to sit above modal overlays and below inner pickers', () => {
      render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.className).toContain('z-[65]');
    });

    it('positions toast in bottom lane when no modal is open (isModalOpen=false)', () => {
      render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          isModalOpen={false}
          bottom={80}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.style.bottom).toBe('80px');
      expect(toastBanner.style.top).toBe('');
      expect(toastBanner.className).toContain('slide-in-from-bottom-3');
    });

    it('positions toast in bottom lane even when isModalOpen=true (D-YB6-1)', () => {
      render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          isModalOpen={true}
          bottom={80}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.style.bottom).toBe('80px');
      expect(toastBanner.style.top).toBe('');
      expect(toastBanner.className).toContain('slide-in-from-bottom-3');
      expect(toastBanner.className).not.toContain('slide-in-from-top-3');
    });

    it('adjusts bottom offset for stacked toasts when isModalOpen is passed', () => {
      render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          isModalOpen={true}
          stackIndex={1}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.style.bottom).toBe('142px');
      expect(toastBanner.style.top).toBe('');
      expect(toastBanner.className).toContain('slide-in-from-bottom-3');
    });

    it('remains bottom-anchored when modal dialog is present in DOM', async () => {
      let modalEl: HTMLDivElement | null = null;
      await act(async () => {
        modalEl = document.createElement('div');
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(modalEl);
      });

      try {
        await act(async () => {
          render(
            <UndoToast
              toast={{
                verb: 'Saved',
                subject: 'Custom Dish',
              }}
              onDismiss={vi.fn()}
            />
          );
        });

        const toastBanner = screen.getByTestId('quick-log-toast');
        expect(toastBanner.style.bottom).toBe('74px');
        expect(toastBanner.style.top).toBe('');
        expect(toastBanner.className).toContain('slide-in-from-bottom-3');
      } finally {
        if (modalEl && (modalEl as HTMLElement).parentNode) {
          await act(async () => {
            document.body.removeChild(modalEl!);
          });
        }
      }
    });

    it('passes accessibility audit when modal is open (bottom-anchored)', async () => {
      const { container } = render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          isModalOpen={true}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.style.bottom).toBe('74px');
      expect(toastBanner.style.top).toBe('');
      await expectNoA11yViolations(container);
    });

    it('does not attach any MutationObserver when toast is null', () => {
      const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
      render(<UndoToast toast={null} onDismiss={vi.fn()} />);
      expect(observeSpy).not.toHaveBeenCalled();
      observeSpy.mockRestore();
    });

    it('remains bottom-anchored when a dialog with aria-modal is added or removed while toast is visible', async () => {
      render(
        <UndoToast
          toast={{
            verb: 'Saved',
            subject: 'Custom Dish',
          }}
          onDismiss={vi.fn()}
        />
      );

      const toastBanner = screen.getByTestId('quick-log-toast');
      expect(toastBanner.style.bottom).toBe('74px');
      expect(toastBanner.style.top).toBe('');

      // Add modal dialog with aria-modal to DOM
      let modalEl: HTMLDivElement | null = null;
      await act(async () => {
        modalEl = document.createElement('div');
        modalEl.setAttribute('role', 'dialog');
        modalEl.setAttribute('aria-modal', 'true');
        document.body.appendChild(modalEl);
      });

      expect(toastBanner.style.bottom).toBe('74px');
      expect(toastBanner.style.top).toBe('');
      expect(toastBanner.className).toContain('slide-in-from-bottom-3');

      // Remove modal dialog from DOM
      await act(async () => {
        document.body.removeChild(modalEl!);
      });

      expect(toastBanner.style.bottom).toBe('74px');
      expect(toastBanner.style.top).toBe('');
    });
  });
});
