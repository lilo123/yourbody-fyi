import React from 'react';

export type SkeletonVariant = 'card' | 'row' | 'text' | 'chip' | 'circle' | 'box';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  count?: number;
  className?: string;
  ariaLabel?: string;
  testId?: string;
}

const VARIANT_STYLES: Record<SkeletonVariant, string> = {
  card: 'h-36 rounded-3xl bg-zinc-900/90 border border-zinc-800/80 p-4 space-y-3',
  row: 'h-14 rounded-xl bg-zinc-800/50 border border-zinc-800/60',
  text: 'h-4 rounded-md bg-zinc-800/70 w-3/4',
  chip: 'h-6 w-20 rounded-full bg-zinc-800/60',
  circle: 'h-10 w-10 rounded-full bg-zinc-800/60',
  box: 'h-24 rounded-2xl bg-zinc-800/50',
};

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'row',
  count = 1,
  className = '',
  ariaLabel = 'Loading...',
  testId,
}) => {
  const items = Array.from({ length: Math.max(1, count) });

  return (
    <output
      aria-busy="true"
      data-testid={testId}
      className={`block space-y-3 ${count === 1 ? '' : 'w-full'}`}
    >
      <span className="sr-only">{ariaLabel}</span>
      {items.map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`animate-pulse ${VARIANT_STYLES[variant]} ${className}`}
        >
          {variant === 'card' && (
            <>
              <div className="h-5 bg-zinc-800/80 rounded w-1/3" />
              <div className="h-4 bg-zinc-800/60 rounded w-1/2" />
              <div className="h-10 bg-zinc-800/40 rounded-xl w-full mt-2" />
            </>
          )}
        </div>
      ))}
    </output>
  );
};
