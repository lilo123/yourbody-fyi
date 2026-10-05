import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GlobalRestTimerPill } from './GlobalRestTimerPill';
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
});
