import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GlobalRestTimerPill, getStagedActionsAvoidanceOffset } from './GlobalRestTimerPill';
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
    fireEvent.click(pauseBtn);

    expect(screen.getByTitle('Resume timer')).toBeDefined();
    expect(restTimerStore.getSnapshot().isPaused).toBe(true);

    const resumeBtn = screen.getByTitle('Resume timer');
    fireEvent.click(resumeBtn);

    expect(screen.getByTitle('Pause timer')).toBeDefined();
    expect(restTimerStore.getSnapshot().isRunning).toBe(true);
  });

  it('extends duration by 90s on +90s button click', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(30);
    });

    const add90Btn = screen.getByTitle('Add 90 seconds');
    fireEvent.click(add90Btn);

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
    fireEvent.click(stopBtn);

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
    // The container must not pulse (it faded page content through the pill);
    // only the timer icon pulses, and it honours reduced motion.
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

  it('applies mobile 6rem bottom clearance with safe-area and preserves desktop 4.5rem baseline', () => {
    render(<GlobalRestTimerPill />);

    act(() => {
      restTimerStore.start(90);
    });

    const pill = screen.getByTestId('rest-timer-pill');
    expect(pill.className).toContain('bottom-[calc(6rem+env(safe-area-inset-bottom,0px))]');
    expect(pill.className).toContain('sm:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]');
  });

  describe('staged actions avoidance', () => {
    it('returns null when no staged actions element is in DOM', () => {
      expect(getStagedActionsAvoidanceOffset()).toBeNull();
    });

    it('returns null on desktop viewports (innerWidth >= 640)', () => {
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

      const originalInnerWidth = window.innerWidth;
      try {
        Object.defineProperty(window, 'innerWidth', { value: 768, configurable: true });
        expect(getStagedActionsAvoidanceOffset()).toBeNull();
      } finally {
        Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
        document.body.removeChild(staged);
      }
    });

    it('calculates offset 8px above staged-card-actions on mobile viewports', () => {
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

      const originalInnerWidth = window.innerWidth;
      const originalInnerHeight = window.innerHeight;
      try {
        Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
        // 844 - 700 + 8 = 152px
        expect(getStagedActionsAvoidanceOffset()).toBe(152);
      } finally {
        Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
        document.body.removeChild(staged);
      }
    });

    it('dynamically sets inline bottom style when staged actions is present', () => {
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

      const originalInnerWidth = window.innerWidth;
      const originalInnerHeight = window.innerHeight;
      try {
        Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });

        act(() => {
          restTimerStore.start(90);
        });

        render(<GlobalRestTimerPill />);
        const pill = screen.getByTestId('rest-timer-pill');
        expect(pill.style.bottom).toBe('152px');
      } finally {
        Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
        document.body.removeChild(staged);
      }
    });
  });
});
