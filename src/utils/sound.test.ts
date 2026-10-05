import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { playTimerCompletionChime, getAudioContext, resetAudioContextForTesting } from './sound';

describe('playTimerCompletionChime', () => {
  let originalAudioContext: typeof window.AudioContext;

  beforeEach(() => {
    resetAudioContextForTesting();
    originalAudioContext = window.AudioContext;
  });

  afterEach(() => {
    resetAudioContextForTesting();
    window.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it('runs silently and does not throw when AudioContext is unavailable', () => {
    // @ts-expect-error test unavailable AudioContext
    window.AudioContext = undefined;
    expect(() => playTimerCompletionChime()).not.toThrow();
  });

  it('constructs oscillator and gain nodes, sets ramp frequencies, and plays chime', () => {
    const mockSetValueAtTime = vi.fn();
    const mockExponentialRampToValueAtTime = vi.fn();
    const mockConnect = vi.fn();
    const mockStart = vi.fn();
    const mockStop = vi.fn();
    const mockResume = vi.fn().mockResolvedValue(undefined);

    const mockOsc = {
      type: 'sine',
      frequency: {
        setValueAtTime: mockSetValueAtTime,
        exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
      },
      connect: mockConnect,
      start: mockStart,
      stop: mockStop,
    };

    const mockGain = {
      gain: {
        setValueAtTime: mockSetValueAtTime,
        exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
      },
      connect: mockConnect,
    };

    const mockCtx = {
      currentTime: 10,
      state: 'suspended',
      destination: {},
      createOscillator: vi.fn().mockReturnValue(mockOsc),
      createGain: vi.fn().mockReturnValue(mockGain),
      resume: mockResume,
      close: vi.fn().mockResolvedValue(undefined),
    };

    function MockAudioContext(this: any) {
      return mockCtx;
    }
    const mockAudioContextConstructor = vi.fn(MockAudioContext);
    window.AudioContext = mockAudioContextConstructor as unknown as typeof AudioContext;

    playTimerCompletionChime();

    expect(mockAudioContextConstructor).toHaveBeenCalledTimes(1);
    expect(mockResume).toHaveBeenCalled();
    expect(mockCtx.createOscillator).toHaveBeenCalled();
    expect(mockCtx.createGain).toHaveBeenCalled();

    // 880Hz -> 1760Hz
    expect(mockSetValueAtTime).toHaveBeenCalledWith(880, 10);
    expect(mockExponentialRampToValueAtTime).toHaveBeenCalledWith(1760, 10.15);

    // Gain envelope
    expect(mockSetValueAtTime).toHaveBeenCalledWith(0.15, 10);
    expect(mockExponentialRampToValueAtTime).toHaveBeenCalledWith(0.01, 10.35);

    expect(mockStart).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalledWith(10.35);
  });

  it('reuses the same AudioContext instance across consecutive plays without leaking hardware contexts', () => {
    const mockCtx = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createOscillator: vi.fn().mockReturnValue({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    function MockAudioContext(this: any) {
      return mockCtx;
    }
    const mockAudioContextConstructor = vi.fn(MockAudioContext);
    window.AudioContext = mockAudioContextConstructor as unknown as typeof AudioContext;

    // Play 5 times
    for (let i = 0; i < 5; i++) {
      playTimerCompletionChime();
    }

    // AudioContext constructor must be called ONLY ONCE, reusing the shared instance
    expect(mockAudioContextConstructor).toHaveBeenCalledTimes(1);
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(5);
  });

  it('re-creates context if previous context was closed', () => {
    const mockCtxClosed = {
      currentTime: 0,
      state: 'closed',
      destination: {},
      createOscillator: vi.fn(),
      createGain: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
    };

    const mockCtxRunning = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createOscillator: vi.fn().mockReturnValue({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    let callCount = 0;
    function MockAudioContext(this: any) {
      callCount++;
      return callCount === 1 ? mockCtxClosed : mockCtxRunning;
    }
    const mockAudioContextConstructor = vi.fn(MockAudioContext);
    window.AudioContext = mockAudioContextConstructor as unknown as typeof AudioContext;

    // First call creates closed context
    getAudioContext();
    expect(mockAudioContextConstructor).toHaveBeenCalledTimes(1);

    // Second call sees state === 'closed' and creates fresh context
    playTimerCompletionChime();
    expect(mockAudioContextConstructor).toHaveBeenCalledTimes(2);
  });
});
