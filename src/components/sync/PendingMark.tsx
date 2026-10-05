import React from 'react';

export interface PendingMarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'default';
}

/**
 * Small indicator dot showing that an item has not been synced to the server yet.
 * A10 / STD-COL-3: amber tone, accessible label.
 */
export const PendingMark: React.FC<PendingMarkProps> = ({ className = '', size = 'default' }) => {
  const sizeClasses = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  return (
    <span
      role="status"
      data-testid="pending-mark"
      aria-label="Not synced yet"
      title="Not synced yet"
      className={`${sizeClasses} rounded-full bg-amber-400 inline-block shrink-0 shadow-[0_0_6px_rgba(251,191,36,0.5)] ${className}`}
    />
  );
};

export default PendingMark;
