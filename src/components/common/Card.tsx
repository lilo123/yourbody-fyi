import React from 'react';

export type CardVariant = 'default' | 'active' | 'interactive';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

const VARIANT_STYLES: Record<CardVariant, string> = {
  default: 'bg-zinc-900/90 border border-zinc-800/80',
  active: 'bg-zinc-900/95 border border-cyan-500/40 shadow-neon-cyan',
  interactive:
    'bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 transition cursor-pointer',
};

export const Card: React.FC<CardProps> = ({
  variant = 'default',
  children,
  className = '',
  testId,
  ...rest
}) => {
  return (
    <div
      data-testid={testId}
      className={`rounded-3xl p-3 sm:p-4 ${VARIANT_STYLES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};
