import React from 'react';

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'destructive';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  testId?: string;
}

const VARIANT_STYLES: Record<IconButtonVariant, string> = {
  ghost:
    'bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-white border border-transparent',
  secondary:
    'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60',
  primary:
    'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-neon-cyan border border-transparent',
  destructive:
    'text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 border border-transparent',
};

const SIZE_STYLES: Record<IconButtonSize, string> = {
  sm: 'h-11 w-11 min-h-[44px] min-w-[44px]',
  md: 'h-11 w-11 min-h-[44px] min-w-[44px]',
  lg: 'h-12 w-12 min-h-[48px] min-w-[48px]',
};

export const IconButton: React.FC<IconButtonProps> = ({
  'aria-label': ariaLabel,
  icon,
  children,
  variant = 'ghost',
  size = 'md',
  testId,
  className = '',
  disabled = false,
  type = 'button',
  ...rest
}) => {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      className={`inline-flex items-center justify-center shrink-0 rounded-xl transition active:scale-95 motion-reduce:transition-none motion-reduce:transform-none touch-manipulation cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none select-none ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
      {...rest}
    >
      {icon ?? children}
    </button>
  );
};
