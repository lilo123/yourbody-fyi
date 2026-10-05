import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NutritionAiInput, type NutritionAiInputProps } from './NutritionAiInput';

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
});
