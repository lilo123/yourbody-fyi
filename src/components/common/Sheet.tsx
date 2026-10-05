import React, { useId } from 'react';
import { X } from 'lucide-react';
import { AccessibleModal } from './AccessibleModal';
import { IconButton } from './IconButton';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  titleId?: string;
  ariaLabel?: string;
  dismissible?: boolean | (() => boolean);
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  testId?: string;
}

export const Sheet: React.FC<SheetProps> = ({
  isOpen,
  onClose,
  title,
  titleId: customTitleId,
  ariaLabel,
  dismissible = true,
  children,
  footer,
  className = '',
  testId,
}) => {
  const generatedTitleId = useId();
  const effectiveTitleId = customTitleId || (title ? generatedTitleId : undefined);

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      titleId={effectiveTitleId}
      ariaLabel={ariaLabel ?? (title ? undefined : 'Sheet')}
      dismissible={dismissible}
      testId={testId}
      className={`w-full sm:max-w-lg max-h-[90vh] sm:rounded-3xl rounded-t-3xl bg-zinc-900 border border-zinc-800 flex flex-col overflow-hidden shadow-2xl safe-area-pb ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800/80 shrink-0">
        {title ? (
          <h2
            id={effectiveTitleId}
            className="text-sm font-bold text-white truncate"
          >
            {title}
          </h2>
        ) : (
          <div />
        )}
        <IconButton
          aria-label={title ? `Close ${title}` : 'Close sheet'}
          onClick={onClose}
          size="sm"
          testId={testId ? `${testId}-close` : 'sheet-close-btn'}
          icon={<X className="w-5 h-5 text-zinc-400 hover:text-white" />}
        />
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {children}
      </div>

      {/* Optional Sticky Footer */}
      {footer && (
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/95 shrink-0 flex items-center gap-3">
          {footer}
        </div>
      )}
    </AccessibleModal>
  );
};
