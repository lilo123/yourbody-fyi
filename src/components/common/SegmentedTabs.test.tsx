import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedTabs, type TabItem } from './SegmentedTabs';

describe('SegmentedTabs (WAI ARIA)', () => {
  const tabs: TabItem[] = [
    { id: 'tab-1', label: 'First Tab', testId: 'tab-btn-1' },
    { id: 'tab-2', label: 'Second Tab', testId: 'tab-btn-2' },
    { id: 'tab-3', label: 'Third Tab', testId: 'tab-btn-3' },
  ];

  it('renders tablist role and tab roles with correct aria-selected and roving tabindex', () => {
    render(
      <SegmentedTabs
        tabs={tabs}
        activeTab="tab-1"
        onChange={vi.fn()}
        ariaLabel="Test tabs"
      />
    );

    const tablist = screen.getByRole('tablist', { name: 'Test tabs' });
    expect(tablist).toBeDefined();

    const tabElements = screen.getAllByRole('tab');
    expect(tabElements).toHaveLength(3);

    // Active tab
    expect(tabElements[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabElements[0]).toHaveAttribute('tabIndex', '0');

    // Inactive tabs
    expect(tabElements[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabElements[1]).toHaveAttribute('tabIndex', '-1');
    expect(tabElements[2]).toHaveAttribute('aria-selected', 'false');
    expect(tabElements[2]).toHaveAttribute('tabIndex', '-1');
  });

  it('calls onChange when a tab is clicked', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedTabs
        tabs={tabs}
        activeTab="tab-1"
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByTestId('tab-btn-2'));
    expect(handleChange).toHaveBeenCalledWith('tab-2');
  });

  it('supports roving tabindex and keyboard navigation via ArrowRight, ArrowLeft, Home, End', () => {
    const handleChange = vi.fn();
    render(
      <SegmentedTabs
        tabs={tabs}
        activeTab="tab-1"
        onChange={handleChange}
      />
    );

    const firstTab = screen.getByTestId('tab-btn-1');

    // ArrowRight moves to tab-2
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(handleChange).toHaveBeenCalledWith('tab-2');

    // ArrowLeft wraps around to last tab (tab-3)
    fireEvent.keyDown(firstTab, { key: 'ArrowLeft' });
    expect(handleChange).toHaveBeenCalledWith('tab-3');

    // End key moves to last tab (tab-3)
    fireEvent.keyDown(firstTab, { key: 'End' });
    expect(handleChange).toHaveBeenCalledWith('tab-3');

    // Home key moves to first tab (tab-1)
    fireEvent.keyDown(firstTab, { key: 'Home' });
    expect(handleChange).toHaveBeenCalledWith('tab-1');
  });

  it('satisfies touch-target sizing (min-h-[44px])', () => {
    render(
      <SegmentedTabs
        tabs={tabs}
        activeTab="tab-1"
        onChange={vi.fn()}
      />
    );

    const tabElements = screen.getAllByRole('tab');
    for (const tab of tabElements) {
      expect(tab.className).toContain('min-h-[44px]');
    }
  });
});
