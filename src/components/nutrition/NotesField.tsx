import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Plus, X, StickyNote } from 'lucide-react';

export interface NotesFieldProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

export const NotesField: React.FC<NotesFieldProps> = ({
  value,
  onChange,
  id: externalId,
  placeholder = 'Add notes, preparation details, or ingredients...',
  maxLength = 500,
  disabled = false,
}) => {
  const generatedId = useId();
  const inputId = externalId || `${generatedId}-dish-notes`;
  const labelId = `${generatedId}-dish-notes-label`;
  const hintId = `${generatedId}-dish-notes-hint`;
  const statusId = `${generatedId}-dish-notes-status`;

  // Expanded if the user asked for the field, or if a note already exists.
  // Deriving this rather than syncing it in an effect matters because `value`
  // can arrive after mount, when the dish detail fetch resolves.
  const [userExpanded, setUserExpanded] = useState(false);
  const isExpanded = userExpanded || Boolean(value && value.trim().length > 0);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea using scrollHeight
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, 60), 140);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    if (isExpanded) {
      adjustTextareaHeight();
    }
  }, [isExpanded, value, adjustTextareaHeight]);

  // Handle threshold-based screen reader announcements (WCAG 4.1.3)
  // Only announce when CROSSING 50 remaining, 20 remaining, or the limit, and
  // never on every keystroke. Crossing rather than equality matters because a
  // paste can jump straight past a threshold without ever landing on it.
  const prevRemainingRef = useRef(maxLength);
  const updateStatusMessage = (length: number) => {
    const remaining = maxLength - length;
    const prev = prevRemainingRef.current;
    prevRemainingRef.current = remaining;

    if (remaining <= 0 && prev > 0) {
      setStatusAnnouncement(`Character limit reached (${maxLength} maximum characters).`);
    } else if (remaining <= 20 && prev > 20) {
      setStatusAnnouncement('20 characters remaining.');
    } else if (remaining <= 50 && prev > 50) {
      setStatusAnnouncement('50 characters remaining.');
    }
  };

  const handleExpand = () => {
    setUserExpanded(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      adjustTextareaHeight();
    });
  };

  const handleClear = () => {
    onChange('');
    setStatusAnnouncement('');
    setUserExpanded(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, maxLength);
    onChange(next);
    updateStatusMessage(next.length);
    adjustTextareaHeight();
  };

  if (!isExpanded) {
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={handleExpand}
          disabled={disabled}
          data-testid="add-note-btn"
          aria-label="Add note"
          className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/60 border border-dashed border-border-interactive hover:border-cyan-500/40 transition touch-manipulation disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          <span>Add note</span>
        </button>
      </div>
    );
  }

  const currentLength = value?.length ?? 0;
  const isNearLimit = currentLength >= maxLength - 50;

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between">
        <label
          id={labelId}
          htmlFor={inputId}
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400"
        >
          <StickyNote className="w-3 h-3 text-cyan-400" aria-hidden="true" />
          <span>Notes</span>
          <span className="text-zinc-600 font-normal lowercase">(optional)</span>
        </label>

        <button
          type="button"
          onClick={handleClear}
          disabled={disabled}
          title="Clear and remove note"
          aria-label="Remove note"
          data-testid="clear-note-btn"
          className="p-1 min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-[28px] flex items-center justify-center text-zinc-400 hover:text-rose-400 transition touch-manipulation rounded-lg"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          id={inputId}
          value={value}
          onChange={handleChange}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          aria-labelledby={labelId}
          aria-describedby={`${hintId} ${statusId}`}
          data-testid="dish-notes-textarea"
          className="w-full bg-zinc-950 border border-border-interactive focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/50 rounded-xl p-2.5 text-base text-white placeholder-zinc-600 outline-none transition resize-none min-h-[60px] max-h-[140px] leading-relaxed"
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        {/* Static accessibility hint read once on focus */}
        <span id={hintId} className="text-zinc-400 sr-only">
          Maximum 500 characters.
        </span>

        {/* Dynamic thresholded live announcement region */}
        <output
          id={statusId}
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {statusAnnouncement}
        </output>

        {/* Visual counter for sighted users */}
        <span
          aria-hidden="true"
          className={`ml-auto tabular-nums ${
            isNearLimit ? 'text-amber-400 font-bold' : 'text-zinc-600'
          }`}
        >
          {currentLength}/{maxLength}
        </span>
      </div>
    </div>
  );
};

NotesField.displayName = 'NotesField';
