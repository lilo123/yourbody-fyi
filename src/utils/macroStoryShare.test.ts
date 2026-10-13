import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shareMacroStory } from './macroStoryShare';
import type { NutritionDaySummary } from '../components/history/NutritionHistoryTimeline';

describe('shareMacroStory utility', () => {
  const sampleDay: NutritionDaySummary = {
    date: '2026-10-12',
    meals: [
      {
        id: 'meal-1',
        user_id: 'user-123',
        food_name: 'Grilled Salmon Bowl',
        calories: 650,
        protein: 45,
        carbs: 55,
        fat: 22,
        fiber: 8,
        logged_at: '2026-10-12T12:00:00Z',
      },
    ],
    totals: { calories: 650, protein: 45, carbs: 55, fat: 22, fiber: 8 },
    macroCalories: { protein: 180, carbs: 220, fat: 198, total: 598 },
    percentages: { protein: 30, carbs: 37, fat: 33 },
  };

  const sampleProfile = {
    target_calories: 2200,
    target_protein: 160,
    target_carbs: 220,
    target_fat: 70,
    target_fiber: 30,
  };

  const mockBlob = new Blob(['mock-macro-png-binary'], { type: 'image/png' });
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

    await shareMacroStory(
      sampleDay,
      sampleProfile,
      mockShowToast,
      { renderToBlob: mockRenderToBlob }
    );

    expect(mockRenderToBlob).toHaveBeenCalledTimes(1);
    expect(mockCanShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);

    const shareCallArgs = mockShare.mock.calls[0][0];
    expect(shareCallArgs.title).toBe('Daily Nutrition');
    expect(shareCallArgs.files).toHaveLength(1);
    const sharedFile = shareCallArgs.files[0];
    expect(sharedFile).toBeInstanceOf(File);
    expect(sharedFile.type).toBe('image/png');
    expect(sharedFile.name).toBe('nutrition-2026-10-12.png');
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

    await shareMacroStory(
      sampleDay,
      sampleProfile,
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

    await shareMacroStory(
      sampleDay,
      sampleProfile,
      mockShowToast,
      { renderToBlob: mockRenderToBlob }
    );

    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows error toast when rendering or sharing fails with an unexpected error', async () => {
    const errorRenderer = vi.fn().mockRejectedValue(new Error('Canvas render failure'));

    await shareMacroStory(
      sampleDay,
      sampleProfile,
      mockShowToast,
      { renderToBlob: errorRenderer }
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'Failed to share day',
      kind: 'info',
    });
  });
});
