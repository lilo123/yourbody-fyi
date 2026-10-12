import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkoutSessionShareButton } from './WorkoutSessionShareButton';
import type { HistorySession } from './useWorkoutHistory';

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    show: mockShowToast,
  }),
}));

describe('WorkoutSessionShareButton component', () => {
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

  it('renders a 44px touch target icon button with "Share workout" aria-label', () => {
    render(
      <WorkoutSessionShareButton
        session={sampleSession}
        deps={{ renderToBlob: mockRenderToBlob }}
      />
    );

    const button = screen.getByTestId('share-session-btn-test-session-123');
    expect(button).toBeDefined();
    expect(button.getAttribute('aria-label')).toBe('Share workout');
    expect(button.className).toContain('min-w-[44px]');
    expect(button.className).toContain('min-h-[44px]');
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

    render(
      <WorkoutSessionShareButton
        session={sampleSession}
        unit="lb"
        deps={{ renderToBlob: mockRenderToBlob }}
      />
    );

    const button = screen.getByTestId('share-session-btn-test-session-123');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRenderToBlob).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockCanShare).toHaveBeenCalledTimes(1);
      expect(mockShare).toHaveBeenCalledTimes(1);
    });

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

    render(
      <WorkoutSessionShareButton
        session={sampleSession}
        unit="lb"
        deps={{ renderToBlob: mockRenderToBlob }}
      />
    );

    const button = screen.getByTestId('share-session-btn-test-session-123');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRenderToBlob).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockCanShare).toHaveBeenCalledTimes(1);
      expect(mockShare).not.toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
    });

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

    render(
      <WorkoutSessionShareButton
        session={sampleSession}
        deps={{ renderToBlob: mockRenderToBlob }}
      />
    );

    const button = screen.getByTestId('share-session-btn-test-session-123');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows error toast when rendering or sharing fails with an unexpected error', async () => {
    const errorRenderer = vi.fn().mockRejectedValue(new Error('Canvas render failure'));

    render(
      <WorkoutSessionShareButton
        session={sampleSession}
        deps={{ renderToBlob: errorRenderer }}
      />
    );

    const button = screen.getByTestId('share-session-btn-test-session-123');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith({
        message: 'Failed to share workout',
        kind: 'info',
      });
    });
  });
});
