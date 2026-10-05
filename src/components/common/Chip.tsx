import React from 'react';

export type ChipVariant = 'default' | 'filter' | 'metric';
export type ChipSize = 'sm' | 'md';

export interface ChipProps {
  label: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  variant?: ChipVariant;
  size?: ChipSize;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

const SIZE_STYLES: Record<ChipSize, string> = {
  sm: 'h-6 px-2.5 text-xs',
  md: 'h-8 px-3 text-xs',
};

export const Chip: React.FC<ChipProps> = ({
  label,
  icon,
  selected = false,
  onClick,
  variant = 'default',
  size = 'sm',
  disabled = false,
  className = '',
  testId,
}) => {
  const isInteractive = Boolean(onClick);

  const stateStyle = selected
    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
    : variant === 'metric'
    ? 'bg-zinc-800/90 text-zinc-300 border-zinc-700/60'
    : 'bg-zinc-800/80 text-zinc-400 border-zinc-700/60 hover:text-zinc-200 hover:border-zinc-600';

  const baseClasses = `inline-flex items-center gap-1.5 font-semibold rounded-full border transition select-none ${SIZE_STYLES[size]} ${stateStyle}`;

  if (isInteractive) {
    return (
      <button
        type="button"
        data-testid={testId}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
        className={`${baseClasses} relative before:absolute before:inset-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] before:content-[''] cursor-pointer touch-manipulation active:scale-95 motion-reduce:transition-none motion-reduce:transform-none disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {icon && <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <span
      data-testid={testId}
      className={`${baseClasses} ${className}`}
    >
      {icon && <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>}
      <span className="truncate">{label}</span>
    </span>
  );
};
