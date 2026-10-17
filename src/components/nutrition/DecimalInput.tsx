import React, { useState, useEffect, useRef, forwardRef } from 'react';
import { parseDecimalInput } from '../../utils/unitConverter';

export interface DecimalInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number | '';
  onChange: (val: number | '') => void;
  allowNegative?: boolean;
  max?: number;
}

/**
 * Controlled numeric text input supporting decimal comma on mobile keyboards.
 * Maintains local draft string while typing so trailing commas (e.g. "12,")
 * are not clobbered by numeric round-trip state.
 */
export const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(({
  value,
  onChange,
  allowNegative = true,
  max,
  onBlur,
  onKeyDown,
  type: _unusedType,
  inputMode: _unusedInputMode,
  step = 'any',
  min = '0',
  ...rest
}, ref) => {
  const [draft, setDraft] = useState<string | null>(null);

  const prevValueRef = useRef(value);
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      if (draft !== null) {
        const parsedDraft = parseDecimalInput(draft, { allowNegative, max });
        if (parsedDraft !== value) {
          setDraft(null);
        }
      }
    }
  }, [value, draft, allowNegative, max]);

  const displayValue = draft !== null
    ? draft
    : (value === '' || (typeof value === 'number' && Number.isNaN(value)) ? '' : String(value));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);

    if (raw === '') {
      onChange('');
      return;
    }

    // In-progress prefixes while typing
    if (raw === '-' || raw === ',' || raw === '.') {
      return;
    }

    const parsed = parseDecimalInput(raw, { allowNegative, max });
    if (parsed !== null) {
      onChange(parsed);
    } else {
      // Unparseable / ambiguous input (e.g. "1,2,3"): propagate NaN so existing
      // validations (Number.isNaN / min) reject the input and block form submission.
      onChange(Number.NaN);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (draft !== null) {
      if (draft === '' || draft === '-' || draft === ',' || draft === '.') {
        onChange('');
      } else {
        const parsed = parseDecimalInput(draft, { allowNegative, max });
        if (parsed !== null) {
          onChange(parsed);
        } else {
          // Revert invalid draft to current parent value (or empty if unparseable)
          onChange(typeof value === 'number' && !Number.isNaN(value) ? value : '');
        }
      }
      setDraft(null);
    }
    onBlur?.(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (draft !== null) {
        if (draft === '' || draft === '-' || draft === ',' || draft === '.') {
          onChange('');
        } else {
          const parsed = parseDecimalInput(draft, { allowNegative, max });
          if (parsed !== null) {
            onChange(parsed);
          } else {
            onChange(typeof value === 'number' && !Number.isNaN(value) ? value : '');
          }
        }
        setDraft(null);
      }
    }
    onKeyDown?.(e);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      step={step}
      min={min}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
});

DecimalInput.displayName = 'DecimalInput';
