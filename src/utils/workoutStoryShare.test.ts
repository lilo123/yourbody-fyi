import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shareWorkoutStory } from './workoutStoryShare';
import type { HistorySession } from '../components/history/useWorkoutHistory';

describe('shareWorkoutStory utility', () => {
  const sampleSession: HistorySession = {
    id: 'test-session-123',
    name: 'Upper Body Blast',
    date: '2026-10-12T10:00:00Z',
    workout_date: '2026-10-12',
    civil_date: '2026-10-12',
    set_count: 5,
    total_volume: 3500,
    sets: [
      {
        id: 'set-1',
        workout_id: 'test-session-123',
        exercise_id: 'ex-bench-1',
        exercise_name: 'Bench Press',
        weight: 225,
        reps: 5,
        set_index: 1,
        set_type: 'working',
        workout_date: '2026-10-12',
        workout_name: 'Upper Body Blast',
        created_at: '2026-10-12T10:00:00Z',
      },
    ],
  };

  const mockBlob = new Blob(['mock-png-binary'], { type: 'image/png' });
  const mockRenderToBlob = vi.fn().mockResolvedValue(mockBlob);
  const mockShowToast = vi.fn();

  let originalNavigatorShare: typeof navigator.share;
  let originalNavigatorCanShare: typeof navigator.canShare;

  beforeEach(() => {
    vi.clearAllMocks();
    originalNavigatorShare = navigator.share;
    originalNavigatorCanShare = navigator.canShare;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', {
      value: originalNavigatorShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: originalNavigatorCanShare,
      configurable: true,
      writable: true,
    });
  });

  it('calls navigator.share with a File of type image/png when canShare is true', async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);

    Object.defineProperty(navigator, 'share', {
      value: mockShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: mockCanShare,
      configurable: true,
      writable: true,
    });

    await shareWorkoutStory(
      sampleSession,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: mockRenderToBlob }
    );

    expect(mockRenderToBlob).toHaveBeenCalledTimes(1);
    expect(mockCanShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);

    const shareCallArgs = mockShare.mock.calls[0][0];
    expect(shareCallArgs.title).toBe('Upper Body Blast');
    expect(shareCallArgs.files).toHaveLength(1);
    const sharedFile = shareCallArgs.files[0];
    expect(sharedFile).toBeInstanceOf(File);
    expect(sharedFile.type).toBe('image/png');
    expect(sharedFile.name).toBe('workout-2026-10-12.png');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('falls back to creating a download anchor when canShare returns false', async () => {
    const mockShare = vi.fn();
    const mockCanShare = vi.fn().mockReturnValue(false);

    Object.defineProperty(navigator, 'share', {
      value: mockShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: mockCanShare,
      configurable: true,
      writable: true,
    });

    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-uuid');
    const mockRevokeObjectURL = vi.fn();
    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await shareWorkoutStory(
      sampleSession,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: mockRenderToBlob }
    );

    expect(mockRenderToBlob).toHaveBeenCalledTimes(1);
    expect(mockCanShare).toHaveBeenCalledTimes(1);
    expect(mockShare).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');

    clickSpy.mockRestore();
  });

  it('handles user cancellation (AbortError) silently with zero error toast', async () => {
    const abortError = new Error('The user dismissed the share dialog.');
    abortError.name = 'AbortError';

    const mockShare = vi.fn().mockRejectedValue(abortError);
    const mockCanShare = vi.fn().mockReturnValue(true);

    Object.defineProperty(navigator, 'share', {
      value: mockShare,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: mockCanShare,
      configurable: true,
      writable: true,
    });

    await shareWorkoutStory(
      sampleSession,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: mockRenderToBlob }
    );

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows error toast when rendering or sharing fails with an unexpected error', async () => {
    const errorRenderer = vi.fn().mockRejectedValue(new Error('Canvas render failure'));

    await shareWorkoutStory(
      sampleSession,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: errorRenderer }
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Failed to share workout',
      kind: 'info',
    });
  });

  it('passes e1rm prMode to story builder when specified via param or deps', async () => {
    const sessionWithSets: HistorySession = {
      ...sampleSession,
      sets: [
        {
          id: 'set-1',
          workout_id: 'test-session-123',
          exercise_id: 'ex-bench-1',
          exercise_name: 'Bench Press',
          weight: 220,
          reps: 1,
          set_index: 1,
          set_type: 'working',
          workout_date: '2026-10-12',
          workout_name: 'Upper Body Blast',
          created_at: '2026-10-12T10:00:00Z',
        },
        {
          id: 'set-2',
          workout_id: 'test-session-123',
          exercise_id: 'ex-bench-1',
          exercise_name: 'Bench Press',
          weight: 200,
          reps: 8,
          set_index: 2,
          set_type: 'working',
          workout_date: '2026-10-12',
          workout_name: 'Upper Body Blast',
          created_at: '2026-10-12T10:05:00Z',
        },
      ],
    };

    let capturedStoryData: any = null;
    const capturingRenderer = vi.fn().mockImplementation((data) => {
      capturedStoryData = data;
      return Promise.resolve(mockBlob);
    });

    // Test with prMode as 6th param
    await shareWorkoutStory(
      sessionWithSets,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: capturingRenderer },
      'e1rm'
    );
    expect(capturedStoryData.exercises[0].bestSetFormatted).toBe('200 lbs × 8');

    // Test with prMode in deps
    capturedStoryData = null;
    await shareWorkoutStory(
      sessionWithSets,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: capturingRenderer, prMode: 'e1rm' }
    );
    expect(capturedStoryData.exercises[0].bestSetFormatted).toBe('200 lbs × 8');

    // Test default weight mode
    capturedStoryData = null;
    await shareWorkoutStory(
      sessionWithSets,
      [],
      'lb',
      mockShowToast,
      { renderToBlob: capturingRenderer }
    );
    expect(capturedStoryData.exercises[0].bestSetFormatted).toBe('220 lbs × 1');
  });
});
