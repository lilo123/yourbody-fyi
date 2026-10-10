import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NutritionAiInput, type NutritionAiInputProps } from './NutritionAiInput';

let mockPaywallEnabled = false;
vi.mock('../../hooks/useFeatureFlag', () => ({
  useFeatureFlag: vi.fn((key: string) => {
    if (key === 'paywall_enabled') return mockPaywallEnabled;
    return false;
  }),
}));

function defaultProps(overrides: Partial<NutritionAiInputProps> = {}): NutritionAiInputProps {
  return {
    nlInput: '',
    onNlInputChange: vi.fn(),
    selectedPhoto: null,
    onRemovePhoto: vi.fn(),
    onFileChange: vi.fn(),
    onPickPhoto: vi.fn(),
    isAnalyzing: false,
    onAnalyze: vi.fn(),
    showManualForm: false,
    onToggleManualForm: vi.fn(),
    isRateLimited: false,
    onSwitchToManual: vi.fn(),
    status: '',
    isError: false,
    fileInputRef: { current: null },
    hasCustomDishes: false,
    ...overrides,
  };
}

describe('NutritionAiInput live regions and accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaywallEnabled = false;
  });
  it('mounts persistent idle live regions from the start', () => {
    const { container } = render(<NutritionAiInput {...defaultProps()} />);

    const politeRegions = container.querySelectorAll('[role="status"]');
    const alertRegions = container.querySelectorAll('[role="alert"]');

    expect(politeRegions.length).toBeGreaterThan(0);
    expect(alertRegions.length).toBeGreaterThan(0);

    politeRegions.forEach((r) => expect(r).toHaveTextContent(''));
    alertRegions.forEach((r) => expect(r).toHaveTextContent(''));

    expect(screen.queryByTestId('rate-limit-banner')).toBeNull();
    expect(screen.queryByTestId('status-message')).toBeNull();
  });

  it('populates polite live region when status message is informational', () => {
    const { container } = render(
      <NutritionAiInput {...defaultProps({ status: 'Analyzing...', isError: false })} />
    );

    const politeRegions = container.querySelectorAll('[role="status"]');
    const speaking = Array.from(politeRegions).find((r) => r.textContent === 'Analyzing...');
    expect(speaking).toBeDefined();

    const banner = screen.getByTestId('status-message');
    expect(banner).toBeDefined();
  });

  it('populates assertive live region when status message is an error', () => {
    const { container } = render(
      <NutritionAiInput {...defaultProps({ status: 'AI service unavailable', isError: true })} />
    );

    const alertRegions = container.querySelectorAll('[role="alert"]');
    const speaking = Array.from(alertRegions).find((r) => r.textContent === 'AI service unavailable');
    expect(speaking).toBeDefined();

    const banner = screen.getByTestId('status-message');
    expect(banner).toBeDefined();
    expect(screen.getByTestId('retry-analysis-button')).toBeDefined();
  });

  it('populates assertive live region when rate limited', () => {
    const { container } = render(
      <NutritionAiInput {...defaultProps({ isRateLimited: true })} />
    );

    const alertRegions = container.querySelectorAll('[role="alert"]');
    const speaking = Array.from(alertRegions).find((r) =>
      r.textContent?.includes('Rate Limit Exceeded (15 RPM)')
    );
    expect(speaking).toBeDefined();

    expect(screen.getByTestId('rate-limit-banner')).toBeDefined();
    expect(screen.getByTestId('switch-to-manual-btn')).toBeDefined();
  });

  it('indicates busy state with aria-busy on the analyze button when analyzing', () => {
    const { rerender } = render(<NutritionAiInput {...defaultProps({ isAnalyzing: false })} />);
    const btn = screen.getByTestId('analyze-meal-button');
    expect(btn.getAttribute('aria-busy')).toBeNull();

    rerender(<NutritionAiInput {...defaultProps({ isAnalyzing: true })} />);
    expect(screen.getByTestId('analyze-meal-button').getAttribute('aria-busy')).toBe('true');
  });

  describe('Online-only AI constraints and connectivity state', () => {
    it('offline: disables AI submit and photo actions, displays connection hint with role=status and aria-describedby', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: 'Steak and eggs with toast',
          })}
        />
      );

      // Hint must be visible with exact wording
      const hint = screen.getByTestId('ai-offline-hint');
      expect(hint).toBeDefined();
      expect(hint.getAttribute('role')).toBe('status');
      expect(hint.textContent).toContain('AI needs a connection: use quick log');
      expect(screen.getByText('AI needs a connection: use quick log')).toBeDefined();

      // Accessible aria-describedby linkage
      const textarea = screen.getByRole('textbox');
      expect(textarea.getAttribute('aria-describedby')).toBe('ai-offline-hint');

      const cameraBtn = screen.getByTestId('camera-trigger');
      expect(cameraBtn).toBeDisabled();
      expect(cameraBtn.getAttribute('aria-describedby')).toBe('ai-offline-hint');

      const galleryBtn = screen.getByTestId('gallery-trigger');
      expect(galleryBtn).toBeDisabled();
      expect(galleryBtn.getAttribute('aria-describedby')).toBe('ai-offline-hint');

      const fileInput = screen.getByTestId('hidden-file-input');
      expect(fileInput).toBeDisabled();

      // Prose text cannot be parsed locally -> analyze button is disabled
      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).toBeDisabled();
      expect(analyzeBtn.getAttribute('aria-describedby')).toBe('ai-offline-hint');
    });

    it('offline: local parser input remains usable and enables submit button', () => {
      const onAnalyze = vi.fn();
      const validBlock = [
        'Chicken Breast',
        'Serving: 200 g',
        'Calories: 330',
        'Protein: 62 g',
        'Carbs: 0 g',
        'Fat: 7.2 g',
      ].join('\n');

      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: validBlock,
            onAnalyze,
          })}
        />
      );

      // Hint is still shown to notify that AI features need a connection
      expect(screen.getByText('AI needs a connection: use quick log')).toBeDefined();

      // Since the input matches the strict local nutrition block grammar, submit is enabled
      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).not.toBeDisabled();

      analyzeBtn.click();
      expect(onAnalyze).toHaveBeenCalledTimes(1);
    });

    it('online: enables AI submit and photo triggers, hides connection hint', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: true,
            nlInput: 'Steak and eggs with toast',
          })}
        />
      );

      expect(screen.queryByTestId('ai-offline-hint')).toBeNull();
      expect(screen.queryByText('AI needs a connection: use quick log')).toBeNull();

      expect(screen.getByTestId('camera-trigger')).not.toBeDisabled();
      expect(screen.getByTestId('gallery-trigger')).not.toBeDisabled();
      expect(screen.getByTestId('hidden-file-input')).not.toBeDisabled();

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).not.toBeDisabled();
      expect(analyzeBtn.getAttribute('aria-describedby')).toBeNull();
    });

    it('toggling connectivity restores inputs without reload', () => {
      const { rerender } = render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: 'Salmon with rice and asparagus',
          })}
        />
      );

      // Offline: disabled + hint visible
      expect(screen.getByText('AI needs a connection: use quick log')).toBeDefined();
      expect(screen.getByTestId('analyze-meal-button')).toBeDisabled();
      expect(screen.getByTestId('camera-trigger')).toBeDisabled();
      expect(screen.getByTestId('gallery-trigger')).toBeDisabled();

      // Reconnect online: enabled + hint disappears without reload
      rerender(
        <NutritionAiInput
          {...defaultProps({
            isOnline: true,
            nlInput: 'Salmon with rice and asparagus',
          })}
        />
      );

      expect(screen.queryByTestId('ai-offline-hint')).toBeNull();
      expect(screen.queryByText('AI needs a connection: use quick log')).toBeNull();
      expect(screen.getByTestId('analyze-meal-button')).not.toBeDisabled();
      expect(screen.getByTestId('camera-trigger')).not.toBeDisabled();
      expect(screen.getByTestId('gallery-trigger')).not.toBeDisabled();

      // Go offline again: re-disables
      rerender(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: 'Salmon with rice and asparagus',
          })}
        />
      );

      expect(screen.getByText('AI needs a connection: use quick log')).toBeDefined();
      expect(screen.getByTestId('analyze-meal-button')).toBeDisabled();
    });
  });

  describe('Quota exceeded and paywall flag integration', () => {
    it('flag off: does not render Upgrade button on quota_exceeded, shows retry', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            status: "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free.",
            isError: true,
            isQuotaExceeded: true,
          })}
        />
      );

      expect(screen.queryByTestId('ai-upgrade-btn')).toBeNull();
      expect(screen.getByTestId('retry-analysis-button')).toBeDefined();
    });

    it('flag on: renders Upgrade button via isQuotaExceeded prop and opens UpgradeSheet', async () => {
      mockPaywallEnabled = true;

      render(
        <NutritionAiInput
          {...defaultProps({
            status: "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free.",
            isError: true,
            isQuotaExceeded: true,
          })}
        />
      );

      const upgradeBtn = screen.getByTestId('ai-upgrade-btn');
      expect(upgradeBtn).toBeDefined();
      expect(upgradeBtn.className).toContain('min-h-[44px]');
      expect(screen.queryByTestId('retry-analysis-button')).toBeNull();

      fireEvent.click(upgradeBtn);
      expect(await screen.findByTestId('upgrade-sheet')).toBeDefined();
    });

    it('flag on but isQuotaExceeded is false: does not render Upgrade button even if status mentions quota', () => {
      mockPaywallEnabled = true;

      render(
        <NutritionAiInput
          {...defaultProps({
            status: "AI parsing isn't included in the free plan. Quick log and on-device parsing stay free.",
            isError: true,
            isQuotaExceeded: false,
          })}
        />
      );

      expect(screen.queryByTestId('ai-upgrade-btn')).toBeNull();
      expect(screen.getByTestId('retry-analysis-button')).toBeDefined();
    });
  });
});
