import React, { useCallback } from 'react';
import { useModalA11y } from '../../hooks/useModalA11y';

export interface AccessibleModalProps {
  /**
   * Whether the modal is open. If false, AccessibleModal renders null.
   */
  isOpen: boolean;

  /**
   * Invoked when the modal should close (via Escape or backdrop click).
   */
  onClose: () => void;

  /**
   * HTML ID of the element labelling the modal dialog (used for aria-labelledby).
   */
  titleId?: string;

  /**
   * Fallback accessible label if no element provides aria-labelledby.
   */
  ariaLabel?: string;

  /**
   * Controls whether the modal can be dismissed via Escape or backdrop click.
   * Can be a boolean or a function returning boolean (e.g. `!isPending`).
   * Defaults to true.
   */
  dismissible?: boolean | (() => boolean);

  /**
   * Callback invoked when Escape is pressed.
   * If it returns `false`, `onClose` is NOT called (e.g., to close an inner picker/sheet first).
   */
  onEscape?: () => boolean | void;

  /**
   * Whether clicking the backdrop overlay triggers modal dismissal.
   * Defaults to true.
   */
  closeOnBackdropClick?: boolean;

  /**
   * Content to render inside the dialog container.
   */
  children: React.ReactNode;

  /**
   * Class name for the dialog container element (role="dialog").
   */
  className?: string;

  /**
   * Class name for the backdrop overlay element.
   * Defaults to standard modal backdrop styling.
   */
  overlayClassName?: string;

  /**
   * data-testid for the dialog container element.
   */
  testId?: string;

  /**
   * Alias for testId.
   */
  dialogTestId?: string;

  /**
   * data-testid for the backdrop overlay element.
   */
  overlayTestId?: string;
}

export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  titleId,
  ariaLabel,
  dismissible = true,
  onEscape,
  closeOnBackdropClick = true,
  children,
  className,
  overlayClassName = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4',
  testId,
  dialogTestId,
  overlayTestId,
}) => {
  const handleA11yClose = useCallback(() => {
    const isDismissible = typeof dismissible === 'function' ? dismissible() : dismissible;
    if (!isDismissible) {
      return;
    }
    if (onEscape) {
      const handled = onEscape();
      if (handled === false) {
        return;
      }
    }
    onClose();
  }, [dismissible, onEscape, onClose]);

  const containerRef = useModalA11y(isOpen, handleA11yClose);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (!closeOnBackdropClick) return;
    const isDismissible = typeof dismissible === 'function' ? dismissible() : dismissible;
    if (!isDismissible) return;
    onClose();
  };

  const effectiveDialogTestId = dialogTestId ?? testId;

  return (
    <div
      data-testid={overlayTestId}
      className={overlayClassName}
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        data-testid={effectiveDialogTestId}
        className={className}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};
