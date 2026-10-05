import React from 'react';

export type TagTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface TagProps {
  label: string;
  tone?: TagTone;
  icon?: React.ReactNode;
  className?: string;
  testId?: string;
}

const TONE_STYLES: Record<TagTone, string> = {
  info: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  danger: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
  neutral: 'bg-zinc-800 border-zinc-700/60 text-zinc-300',
};

export const Tag: React.FC<TagProps> = ({
  label,
  tone = 'neutral',
  icon,
  className = '',
  testId,
}) => {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full border shrink-0 select-none ${TONE_STYLES[tone]} ${className}`}
    >
      {icon && <span className="shrink-0 [&>svg]:w-3 [&>svg]:h-3">{icon}</span>}
      <span>{label}</span>
    </span>
  );
};
