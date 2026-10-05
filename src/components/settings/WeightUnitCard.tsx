import React, { useState, useRef } from 'react';
import { Scale } from 'lucide-react';
import { useWeightUnitPreference } from '../../hooks/useWeightUnit';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { WeightUnit } from '../../utils/weight';

export const WeightUnitCard: React.FC = () => {
  const { unit, setUnit, isSaving, error } = useWeightUnitPreference();
  const [localError, setLocalError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const lbRef = useRef<HTMLButtonElement | null>(null);
  const kgRef = useRef<HTMLButtonElement | null>(null);

  const handleSelect = async (selectedUnit: WeightUnit) => {
    if (!isOnline || selectedUnit === unit || isSaving) return;
    setLocalError(null);
    try {
      await setUnit(selectedUnit);
    } catch (err) {
      // Catch rejection to ensure no unhandled promise rejection occurs
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || 'Failed to update weight unit';
      setLocalError(msg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentOption: WeightUnit) => {
    if (!isOnline || isSaving) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      void handleSelect('kg');
      kgRef.current?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      void handleSelect('lb');
      lbRef.current?.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void handleSelect(currentOption);
    }
  };

  const displayError = localError || error;

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <Scale className="w-4 h-4 text-cyan-400" aria-hidden="true" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Weight unit
        </h3>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed">
        Weights are stored in pounds; this changes how they are shown and entered.
      </p>

      {displayError ? (
        <StatusBanner
          tone="error"
          message={displayError}
          testId="weight-unit-status-banner"
        />
      ) : null}

      {!isOnline && (
        <p className="text-xs text-amber-400 font-semibold" data-testid="offline-helper-text">
          Available when online
        </p>
      )}

      <fieldset
        aria-label="Weight unit"
        aria-busy={isSaving}
        className="flex items-center gap-2 bg-zinc-950/80 p-1.5 border border-zinc-800/80 rounded-2xl m-0"
      >
        <button
          ref={lbRef}
          type="button"
          aria-pressed={unit === 'lb'}
          disabled={isSaving || !isOnline}
          title={!isOnline ? 'Available when online' : undefined}
          data-testid="weight-unit-lb"
          onClick={() => void handleSelect('lb')}
          onKeyDown={(e) => handleKeyDown(e, 'lb')}
          className={`min-h-[44px] flex-1 flex items-center justify-center rounded-xl text-xs font-bold transition touch-manipulation cursor-pointer ${
            isSaving || !isOnline ? 'opacity-50 cursor-not-allowed ' : ''
          }${
            unit === 'lb'
              ? 'bg-zinc-800 text-cyan-300 border border-border-interactive shadow-sm'
              : 'text-zinc-400 hover:text-white bg-transparent border border-transparent'
          }`}
        >
          lb
        </button>
        <button
          ref={kgRef}
          type="button"
          aria-pressed={unit === 'kg'}
          disabled={isSaving || !isOnline}
          title={!isOnline ? 'Available when online' : undefined}
          data-testid="weight-unit-kg"
          onClick={() => void handleSelect('kg')}
          onKeyDown={(e) => handleKeyDown(e, 'kg')}
          className={`min-h-[44px] flex-1 flex items-center justify-center rounded-xl text-xs font-bold transition touch-manipulation cursor-pointer ${
            isSaving || !isOnline ? 'opacity-50 cursor-not-allowed ' : ''
          }${
            unit === 'kg'
              ? 'bg-zinc-800 text-cyan-300 border border-border-interactive shadow-sm'
              : 'text-zinc-400 hover:text-white bg-transparent border border-transparent'
          }`}
        >
          kg
        </button>
      </fieldset>
    </div>
  );
};
