import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GlobalRestTimerPill, getObstacleTop } from './GlobalRestTimerPill';
import { restTimerStore } from '../../utils/restTimerStore';
import { expectNoA11yViolations } from '../../test/a11y';

describe('GlobalRestTimerPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    restTimerStore.resetForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders null when timer is stopped/idle', () => {
    render(<GlobalRestTimerPill />);
    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();
  });

  it('renders floating pill with correct formatted time (M:SS) when running', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    expect(screen.getByTestId('rest-timer-pill')).toBeDefined();
    expect(screen.getByTestId('rest-timer-display').textContent).toBe('1:30');
  });

  it('toggles play/pause when toggle button is clicked', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const pauseBtn = screen.getByTitle('Pause timer');
    act(() => {
      fireEvent.click(pauseBtn);
    });

    expect(screen.getByTitle('Resume timer')).toBeDefined();
    expect(restTimerStore.getSnapshot().isPaused).toBe(true);

    const resumeBtn = screen.getByTitle('Resume timer');
    act(() => {
      fireEvent.click(resumeBtn);
    });

    expect(screen.getByTitle('Pause timer')).toBeDefined();
    expect(restTimerStore.getSnapshot().isRunning).toBe(true);
  });

  it('extends duration by 90s on +90s button click', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(30);
    });

    const add90Btn = screen.getByTitle('Add 90 seconds');
    act(() => {
      fireEvent.click(add90Btn);
    });

    expect(screen.getByTestId('rest-timer-display').textContent).toBe('2:00');
    expect(restTimerStore.getSnapshot().remainingSeconds).toBe(120);
  });

  it('stops and unmounts pill on stop button click', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    expect(screen.getByTestId('rest-timer-pill')).toBeDefined();

    const stopBtn = screen.getByTitle('Stop timer');
    act(() => {
      fireEvent.click(stopBtn);
    });

    expect(screen.queryByTestId('rest-timer-pill')).toBeNull();
    expect(restTimerStore.getSnapshot().isRunning).toBe(false);
  });

  it('renders Stop button with Square icon, visible "Stop" label, and 44px hit target', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const stopBtn = screen.getByTitle('Stop timer');
    expect(stopBtn).toBeInTheDocument();
    expect(stopBtn.textContent).toContain('Stop');
    expect(stopBtn.className).toContain('min-h-[44px]');
    expect(stopBtn.className).toContain('min-w-[44px]');
    expect(stopBtn.querySelector('svg')).not.toBeNull();
  });

  it('satisfies STD-TYP rules (12px floor, tabular-nums, no font-mono/font-black)', () => {
    const { container } = render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const display = screen.getByTestId('rest-timer-display');
    expect(display.className).toContain('tabular-nums');
    expect(display.className).toContain('font-bold');
    expect(display.className).not.toContain('font-mono');
    expect(display.className).not.toContain('font-black');

    expect(container.innerHTML).not.toContain('font-mono');
    expect(container.innerHTML).not.toContain('font-black');
    expect(container.innerHTML).not.toContain('text-[10px]');
    expect(container.innerHTML).not.toContain('text-[11px]');
  });

  it('honours motion-reduce on pulse animation', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const pill = screen.getByTestId('rest-timer-pill');
    expect(pill.className).not.toContain('animate-pulse');
    const pulsing = pill.querySelectorAll('.animate-pulse');
    expect(pulsing.length).toBeGreaterThan(0);
    pulsing.forEach((el) => {
      expect(el.getAttribute('class')).toContain('motion-reduce:animate-none');
    });
  });

  it('passes axe accessibility audit with no violations', async () => {
    vi.useRealTimers();
    act(() => {
      restTimerStore.start(90);
    });

    const { container } = render(<GlobalRestTimerPill />);
    await expectNoA11yViolations(container);
  });

  it('applies resting 4.5rem bottom clearance with safe-area on mobile and desktop', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const pill = screen.getByTestId('rest-timer-pill');
    expect(pill.className).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]');
  });

  describe('Option E: Obstacle Avoidance & Collapsible Badge', () => {
    const origWidth = window.innerWidth;
    const origHeight = window.innerHeight;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: origHeight, configurable: true });
      document.querySelectorAll('[data-testid="staged-card-actions"], [role="dialog"], [data-testid="sheet-action-row"], [data-testid="delete-set-btn"]').forEach((el) => {
        el.parentElement?.removeChild(el);
      });
    });

    it('detects obstacle top when staged-card-actions is present', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      expect(getObstacleTop()).toBe(700);
    });

    it('detects obstacle top when modal dialog is present', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
        top: 350,
        bottom: 844,
        left: 0,
        right: 390,
        width: 390,
        height: 494,
        x: 0,
        y: 350,
        toJSON: () => {},
      });
      document.body.appendChild(dialog);

      expect(getObstacleTop()).toBe(350);
    });

    it('detects sheet-action-row as top priority for sheet bottom controls', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        bottom: 844,
        left: 0,
        right: 390,
        width: 390,
        height: 744,
        x: 0,
        y: 100,
        toJSON: () => {},
      });

      const sheetAction = document.createElement('div');
      sheetAction.setAttribute('data-testid', 'sheet-action-row');
      vi.spyOn(sheetAction, 'getBoundingClientRect').mockReturnValue({
        top: 750,
        bottom: 810,
        left: 0,
        right: 390,
        width: 390,
        height: 60,
        x: 0,
        y: 750,
        toJSON: () => {},
      });
      dialog.appendChild(sheetAction);
      document.body.appendChild(dialog);

      expect(getObstacleTop()).toBe(750);
    });

    it('does not collapse on desktop (window.innerWidth >= 640)', () => {
      Object.defineProperty(window, 'innerWidth', { value: 768, configurable: true });

      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 768,
        width: 768,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      expect(getObstacleTop()).toBeNull();
    });

    it('collapses to 44x44 badge docked 8px above obstacle when staged meal bar is present', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(65);
      });

      render(<GlobalRestTimerPill />);

      const badge = screen.getByTestId('rest-timer-pill');
      expect(badge.tagName).toBe('BUTTON');
      expect(badge.className).toContain('w-11');
      expect(badge.className).toContain('h-11');
      expect(badge.className).toContain('rounded-full');
      expect(badge.className).toContain('right-4');
      // 844 - 700 + 8 = 152px
      expect(badge.style.bottom).toBe('152px');
      expect(badge.getAttribute('aria-label')).toBe('Rest timer: 1:05');
      expect(screen.getByText('Rest')).toBeInTheDocument();
      expect(screen.getByTestId('rest-timer-display').textContent).toBe('1:05');
    });

    it('collapses to badge when a modal dialog opens', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
        top: 400,
        bottom: 844,
        left: 0,
        right: 390,
        width: 390,
        height: 444,
        x: 0,
        y: 400,
        toJSON: () => {},
      });
      document.body.appendChild(dialog);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      const badge = screen.getByTestId('rest-timer-pill');
      expect(badge.tagName).toBe('BUTTON');
      // 844 - 400 + 8 = 452px
      expect(badge.style.bottom).toBe('452px');
    });

    it('expands to full pill when badge is tapped', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      const badge = screen.getByTestId('rest-timer-pill');
      expect(badge.tagName).toBe('BUTTON');
      expect(screen.queryByTitle('Pause timer')).toBeNull();

      // Tap badge to expand
      act(() => {
        fireEvent.click(badge);
      });

      const expandedPill = screen.getByTestId('rest-timer-pill');
      expect(expandedPill.tagName).toBe('DIV');
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();
      expect(screen.getByTitle('Add 90 seconds')).toBeInTheDocument();
      expect(screen.getByTestId('stop-timer-btn')).toBeInTheDocument();
      expect(expandedPill.style.bottom).toBe('152px');
    });

    it('auto-collapses back to badge after 5 seconds without interaction', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      // Expand
      act(() => {
        fireEvent.click(screen.getByTestId('rest-timer-pill'));
      });
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();

      // Advance by 4.9s: still expanded
      act(() => {
        vi.advanceTimersByTime(4900);
      });
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();

      // Advance past 5s: collapses back to badge
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByTitle('Pause timer')).toBeNull();
      const badge = screen.getByTestId('rest-timer-pill');
      expect(badge.tagName).toBe('BUTTON');
    });

    it('resets 5s auto-collapse timer upon interaction within expanded pill', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      // Expand
      act(() => {
        fireEvent.click(screen.getByTestId('rest-timer-pill'));
      });

      // Advance 4s
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      // Tap +90s (interaction)
      act(() => {
        fireEvent.click(screen.getByTitle('Add 90 seconds'));
      });

      // Advance 4 more seconds (8s total since expand): should STILL be expanded
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();

      // Advance remaining 1.1s: now collapses
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(screen.queryByTitle('Pause timer')).toBeNull();
    });

    it('collapses expanded pill on outside tap', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      // Expand
      act(() => {
        fireEvent.click(screen.getByTestId('rest-timer-pill'));
      });
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();

      // Advance timer so outside click listener is attached
      act(() => {
        vi.runOnlyPendingTimers();
      });

      // Outside pointerdown
      act(() => {
        fireEvent.pointerDown(document.body);
      });

      expect(screen.queryByTitle('Pause timer')).toBeNull();
      expect(screen.getByTestId('rest-timer-pill').tagName).toBe('BUTTON');
    });

    it('collapses expanded pill on Escape key', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      render(<GlobalRestTimerPill />);

      // Expand
      act(() => {
        fireEvent.click(screen.getByTestId('rest-timer-pill'));
      });
      expect(screen.getByTitle('Pause timer')).toBeInTheDocument();

      // Press Escape
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });

      expect(screen.queryByTitle('Pause timer')).toBeNull();
      expect(screen.getByTestId('rest-timer-pill').tagName).toBe('BUTTON');
    });

    it('returns to resting position full pill when obstacle is removed', () => {
      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        top: 700,
        bottom: 748,
        left: 0,
        right: 390,
        width: 390,
        height: 48,
        x: 0,
        y: 700,
        toJSON: () => {},
      });
      document.body.appendChild(staged);

      act(() => {
        restTimerStore.start(90);
      });

      const { rerender } = render(<GlobalRestTimerPill />);
      expect(screen.getByTestId('rest-timer-pill').tagName).toBe('BUTTON');

      // Remove obstacle from DOM
      document.body.removeChild(staged);

      // Trigger resize or re-render to update obstacle detection
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      rerender(<GlobalRestTimerPill />);

      const pill = screen.getByTestId('rest-timer-pill');
      expect(pill.tagName).toBe('DIV');
      expect(pill.className).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]');
    });
  });
});
