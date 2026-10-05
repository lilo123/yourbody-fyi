import React, { useEffect, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  testId?: string;
}

export interface OverflowMenuProps {
  /** Accessible name for the trigger. Icon-only buttons need one; `title` is not a reliable accessible name on touch. */
  ariaLabel: string;
  items: OverflowMenuItem[];
  testId?: string;
}

/**
 * A single 44 px overflow trigger that stands in for a pair of icon buttons.
 *
 * At a 320 px viewport the meal row's content box is 220 px and the macro
 * cluster needs at least 168 px to stay at two lines, which leaves room for
 * exactly one 44 px control. Collapsing Edit and Delete into one button is what
 * makes the layout fit — and it also means the coach read-only guard has one
 * element to hide instead of two.
 */
export const OverflowMenu: React.FC<OverflowMenuProps> = ({ ariaLabel, items, testId }) => {
  const [open, setOpen] = React.useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10 transition touch-manipulation"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl"
        >
          {items.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              data-testid={entry.testId}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                entry.onSelect();
              }}
              className={`block w-full min-h-[44px] rounded-lg px-3 text-left text-xs font-bold transition touch-manipulation ${
                entry.tone === 'danger'
                  ? 'text-rose-400 hover:bg-rose-500/10'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
