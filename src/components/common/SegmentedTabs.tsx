import React, { useRef, useId } from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  testId?: string;
  badge?: React.ReactNode;
  activeClassName?: string;
}

export interface SegmentedTabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedTabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel,
  className = '',
  size = 'md',
}: SegmentedTabsProps<T>): React.ReactElement {
  const tabListId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let targetIndex = -1;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        targetIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        targetIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        targetIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    if (targetIndex >= 0 && targetIndex < tabs.length) {
      const targetTab = tabs[targetIndex];
      onChange(targetTab.id);
      tabsRef.current[targetIndex]?.focus();
    }
  };

  const defaultActiveClassName = 'bg-zinc-800 text-cyan-300 border border-border-interactive';
  const sizeStyles = size === 'sm' ? 'py-2 px-3 min-h-[44px]' : 'py-2.5 px-3 min-h-[44px]';

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`bg-zinc-950/90 p-1.5 rounded-2xl border border-zinc-800 flex gap-1 ${className}`}
    >
      {tabs.map((tab, index) => {
        const isSelected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabsRef.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${tabListId}-tab-${tab.id}`}
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            data-testid={tab.testId}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl text-xs font-bold uppercase tracking-wider transition touch-manipulation cursor-pointer ${sizeStyles} ${
              isSelected
                ? tab.activeClassName || defaultActiveClassName
                : 'text-zinc-400 hover:text-white bg-transparent'
            }`}
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
