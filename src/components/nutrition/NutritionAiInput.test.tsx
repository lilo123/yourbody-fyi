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

    it('offline: enables submit button for lenient nutrition blocks', () => {
      const onAnalyze = vi.fn();
      const lenientBlock = [
        'Greek Yogurt',
        'Calories: 130 kcal',
        'Protein: 15g',
        'Carbs: 9g',
        'Fat: 2g',
        'extra line to ignore',
      ].join('\n');

      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: lenientBlock,
            onAnalyze,
          })}
        />
      );

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).not.toBeDisabled();
      analyzeBtn.click();
      expect(onAnalyze).toHaveBeenCalledTimes(1);
    });

    it('offline: enables submit button for partial nutrition blocks', () => {
      const onAnalyze = vi.fn();
      const partialBlock = ['Protein Bar', 'Calories: 200 kcal', 'Protein: 20g'].join('\n');

      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: partialBlock,
            onAnalyze,
          })}
        />
      );

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).not.toBeDisabled();
      analyzeBtn.click();
      expect(onAnalyze).toHaveBeenCalledTimes(1);
    });

    it('offline: enables submit button for exact 2-item multi-item breakdowns when navigator.onLine=false', () => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        writable: true,
        value: false,
      });

      const onAnalyze = vi.fn();
      const exactTwoItemBlock = [
        'Food Item: Breakfast Plate',
        '* Scrambled Eggs: 100 g | 140 kcal | 12 g P | 1 g C | 10 g F',
        '* Sourdough Toast: 50 g | 130 kcal | 4 g P | 24 g C | 1 g F',
      ].join('\n');

      render(
        <NutritionAiInput
          {...defaultProps({
            nlInput: exactTwoItemBlock,
            onAnalyze,
          })}
        />
      );

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).not.toBeDisabled();
      analyzeBtn.click();
      expect(onAnalyze).toHaveBeenCalledTimes(1);
    });

    it('offline: keeps submit button disabled for lenient multi-item breakdowns', () => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        writable: true,
        value: false,
      });

      const lenientMultiItemBlock = [
        'Food Item: Breakfast Plate',
        '* Scrambled Eggs: 100 g | 140 kcal | 12 g P | 1 g C | 10 g F',
        '* Sourdough Toast: 50 g | 130 kcal | 4 g P | 24 g C | 1 g F',
        'extra unrecognized note line',
      ].join('\n');

      render(
        <NutritionAiInput
          {...defaultProps({
            nlInput: lenientMultiItemBlock,
          })}
        />
      );

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).toBeDisabled();
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

      await import('../billing/UpgradeSheet');
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

  describe('on_device mode constraints and offline hint suppression', () => {
    it('on_device mode: keeps Analyze button disabled for prose text even when online', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: true,
            nlInput: 'Steak and eggs with toast',
            parserMode: 'on_device',
          } as any)}
        />
      );

      const analyzeBtn = screen.getByTestId('analyze-meal-button');
      expect(analyzeBtn).toBeDisabled();
    });

    it('on_device mode: hides offline connection hint when offline', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            isOnline: false,
            nlInput: 'Steak and eggs with toast',
            parserMode: 'on_device',
          } as any)}
        />
      );

      expect(screen.queryByTestId('ai-offline-hint')).toBeNull();
      expect(screen.queryByText('AI needs a connection: use quick log')).toBeNull();
    });
  });

  describe('mode chip and menu', () => {
    it('renders mode chip and toggles dropdown menu', () => {
      render(<NutritionAiInput {...defaultProps()} />);
      const chip = screen.getByTestId('parser-mode-chip');
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveTextContent('Auto');

      // Menu is closed initially
      expect(screen.queryByTestId('parser-mode-menu')).toBeNull();

      // Click to open menu
      fireEvent.click(chip);
      expect(screen.getByTestId('parser-mode-menu')).toBeInTheDocument();
      expect(screen.getByTestId('parser-mode-option-auto')).toBeInTheDocument();
      expect(screen.getByTestId('parser-mode-option-always_ai')).toBeInTheDocument();
      expect(screen.getByTestId('parser-mode-option-on_device')).toBeInTheDocument();

      // Click an option to select it and close menu
      fireEvent.click(screen.getByTestId('parser-mode-option-on_device'));
      expect(screen.queryByTestId('parser-mode-menu')).toBeNull();
    });
  });

  describe('unparseable feedback container', () => {
    it('shows unparseable reason line and both buttons when online in on_device mode', () => {
      const onAnalyze = vi.fn();
      const onSwitchToManual = vi.fn();

      render(
        <NutritionAiInput
          {...defaultProps({
            nlInput: 'chicken and rice for dinner',
            isOnline: true,
            parserMode: 'on_device',
            onAnalyze,
            onSwitchToManual,
          })}
        />
      );

      const container = screen.getByTestId('unparseable-feedback-container');
      expect(container).toBeInTheDocument();

      const reason = screen.getByTestId('unparseable-reason');
      expect(reason).toHaveTextContent(
        "Can't read this on your device. It needs calories, protein, carbs and fat."
      );

      const aiOnceBtn = screen.getByTestId('use-ai-once-btn');
      expect(aiOnceBtn).toBeInTheDocument();
      expect(aiOnceBtn).toHaveTextContent('Use AI once');

      const quickLogBtn = screen.getByTestId('quick-log-fallback-btn');
      expect(quickLogBtn).toBeInTheDocument();
      expect(quickLogBtn).toHaveTextContent('Quick log');

      fireEvent.click(aiOnceBtn);
      expect(onAnalyze).toHaveBeenCalledWith({ forceAi: true });

      fireEvent.click(quickLogBtn);
      expect(onSwitchToManual).toHaveBeenCalled();
    });

    it('shows reason and Quick log only (no Use AI once) when offline', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            nlInput: 'chicken and rice for dinner',
            isOnline: false,
            parserMode: 'on_device',
          })}
        />
      );

      expect(screen.getByTestId('unparseable-feedback-container')).toBeInTheDocument();
      expect(screen.getByTestId('unparseable-reason')).toHaveTextContent(
        "Can't read this on your device. It needs calories, protein, carbs and fat."
      );
      expect(screen.queryByTestId('use-ai-once-btn')).toBeNull();
      expect(screen.getByTestId('quick-log-fallback-btn')).toBeInTheDocument();
    });

    it('does not show unparseable container if text can be parsed locally', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            nlInput: 'Chicken\nCalories: 200 kcal\nProtein: 25g\nCarbs: 0g\nFat: 5g',
            isOnline: true,
            parserMode: 'on_device',
          })}
        />
      );

      expect(screen.queryByTestId('unparseable-feedback-container')).toBeNull();
    });
  });

  describe('quota warning states', () => {
    it('does not render quota warning when quota remaining > 5', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            quota: {
              limit: 20,
              used: 10,
              remaining: 10,
              period: 'day',
              resetsAt: '2026-10-13T00:00:00Z',
            },
          })}
        />
      );

      expect(screen.queryByTestId('ai-quota-warning')).toBeNull();
    });

    it('renders persistent quota warning banner when quota remaining <= 5 and > 0', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            quota: {
              limit: 20,
              used: 17,
              remaining: 3,
              period: 'day',
              resetsAt: '2026-10-13T00:00:00Z',
            },
          })}
        />
      );

      const banner = screen.getByTestId('ai-quota-warning');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('3 of 20 left today');
    });

    it('renders persistent quota warning banner for monthly quota', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            quota: {
              limit: 50,
              used: 48,
              remaining: 2,
              period: 'month',
              resetsAt: '2026-11-01T00:00:00Z',
            },
          })}
        />
      );

      const banner = screen.getByTestId('ai-quota-warning');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('2 of 50 left this month');
    });

    it('renders exhausted warning with reset time when remaining === 0', () => {
      render(
        <NutritionAiInput
          {...defaultProps({
            quota: {
              limit: 20,
              used: 20,
              remaining: 0,
              period: 'day',
              resetsAt: '2026-10-13T04:00:00Z',
            },
            timeZone: 'UTC',
          })}
        />
      );

      const banner = screen.getByTestId('ai-quota-warning');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(
        'AI resets at 4:00 AM. Device reading still works'
      );
    });
  });
});
