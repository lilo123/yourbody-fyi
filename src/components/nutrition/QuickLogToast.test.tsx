import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QuickLogToast } from './QuickLogToast';
import { ToastProvider } from '../../context/ToastContext';
import { ToastHost } from '../common/ToastHost';

const renderComponent = (ui: React.ReactElement) =>
  render(
    <ToastProvider>
      {ui}
      <ToastHost />
    </ToastProvider>
  );

describe('QuickLogToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Logged" variant with check icon, 12px muted verb, 14px dish · +kcal with title, and 44px Undo button', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
          onUndo,
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toast = screen.getByTestId('quick-log-toast');
    expect(toast).toBeInTheDocument();

    // Check icon
    expect(toast.querySelector('svg')).toBeInTheDocument();

    // Line 1: 12px muted verb ('Logged')
    const verb = screen.getByText('Logged');
    expect(verb).toBeInTheDocument();
    expect(verb.className).toContain('text-xs');

    // Line 2: 14px white '<dish> · +<kcal> kcal' truncated with title attr
    const line2 = screen.getByTestId('toast-dish-text');
    expect(line2).toBeInTheDocument();
    expect(line2.textContent).toBe('Power Bowl · +550 kcal');
    expect(line2.getAttribute('title')).toBe('Power Bowl · +550 kcal');
    expect(line2.className).toContain('text-sm');
    expect(line2.className).toContain('truncate');

    // Undo button: 44px tall, min-w 48px, text >= 12px
    const undoBtn = screen.getByTestId('toast-undo-btn');
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn.className).toMatch(/h-11|min-h-\[44px\]/);
    expect(undoBtn.className).toContain('min-w-[48px]');
    expect(undoBtn.className).toContain('text-xs');
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo log Power Bowl');
  });

  it('renders "Added to meal" variant with check icon, 12px muted verb, 14px dish · +kcal with title, and 44px Undo button', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'added',
          dishName: 'Roasted Almonds',
          calories: 160,
          onUndo,
        }}
        onDismiss={onDismiss}
        isStaged={true}
        isTimerActive={false}
      />
    );

    const toast = screen.getByTestId('quick-log-toast');
    expect(toast).toBeInTheDocument();

    // Line 1: 12px muted verb ('Added to meal')
    const verb = screen.getByText('Added to meal');
    expect(verb).toBeInTheDocument();
    expect(verb.className).toContain('text-xs');

    // Line 2: 14px white '<dish> · +<kcal> kcal' truncated with title attr
    const line2 = screen.getByTestId('toast-dish-text');
    expect(line2).toBeInTheDocument();
    expect(line2.textContent).toBe('Roasted Almonds · +160 kcal');
    expect(line2.getAttribute('title')).toBe('Roasted Almonds · +160 kcal');
    expect(line2.className).toContain('text-sm');

    // Undo button
    const undoBtn = screen.getByTestId('toast-undo-btn');
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo add Roasted Almonds');
  });

  it('does not dismiss when the toast body is clicked (no tap-anywhere dismiss)', () => {
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Protein Shake',
          calories: 220,
          onUndo: vi.fn(),
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toast = screen.getByTestId('quick-log-toast');
    fireEvent.click(toast);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('auto-hides after >= 5000ms when Undo is not focused', () => {
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
          onUndo: vi.fn(),
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    expect(onDismiss).not.toHaveBeenCalled();

    // Advance 4900ms - still visible
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Advance to 5000ms - dismisses
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-hide while Undo has focus and hides on blur if expired', () => {
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
          onUndo: vi.fn(),
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const undoBtn = screen.getByTestId('toast-undo-btn');

    // Focus Undo button at 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.focus(undoBtn);

    // Advance past 5000ms (to 6000ms)
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // Should NOT hide because Undo has focus!
    expect(onDismiss).not.toHaveBeenCalled();

    // Now blur Undo button -> should hide immediately since expired
    fireEvent.blur(undoBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onUndo and dismisses when Undo button is clicked', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'logged',
          dishName: 'Power Bowl',
          calories: 550,
          onUndo,
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const undoBtn = screen.getByTestId('toast-undo-btn');
    fireEvent.click(undoBtn);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

  it('renders "Updated" variant with check icon, 12px muted verb, 14px dish · kcal (no +), and 44px Undo button', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    renderComponent(
      <QuickLogToast
        toast={{
          variant: 'updated',
          dishName: 'Updated Salmon Bowl',
          calories: 620,
          onUndo,
        }}
        onDismiss={onDismiss}
        isStaged={false}
        isTimerActive={false}
      />
    );

    const toast = screen.getByTestId('quick-log-toast');
    expect(toast).toBeInTheDocument();

    // Line 1: 'Updated'
    const verb = screen.getByText('Updated');
    expect(verb).toBeInTheDocument();
    expect(verb.className).toContain('text-xs');

    // Line 2: 'Updated Salmon Bowl · 620 kcal' (no leading '+')
    const line2 = screen.getByTestId('toast-dish-text');
    expect(line2).toBeInTheDocument();
    expect(line2.textContent).toBe('Updated Salmon Bowl · 620 kcal');
    expect(line2.getAttribute('title')).toBe('Updated Salmon Bowl · 620 kcal');

    // Undo button
    const undoBtn = screen.getByTestId('toast-undo-btn');
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo update Updated Salmon Bowl');
  });
