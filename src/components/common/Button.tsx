import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  testId?: string;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-neon-cyan border border-transparent',
  secondary:
    'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60',
  destructive:
    'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40',
  ghost:
    'bg-transparent hover:bg-zinc-800 text-zinc-300 border border-transparent',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'min-h-[40px] px-3 text-xs relative before:absolute before:-inset-y-0.5 before:-inset-x-0.5 before:content-[\'\']',
  md: 'min-h-[44px] px-4 text-xs',
  lg: 'min-h-[48px] px-5 text-sm',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  testId,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      data-testid={testId}
      disabled={isDisabled}
      aria-busy={isLoading ? 'true' : undefined}
      className={`inline-flex items-center justify-center gap-2 font-bold rounded-xl transition active:scale-95 motion-reduce:transition-none motion-reduce:transform-none touch-manipulation cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none select-none ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current shrink-0" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
};
