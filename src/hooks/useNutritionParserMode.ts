import { useState, useEffect, useCallback } from 'react';

export type NutritionParserMode = 'auto' | 'always_ai' | 'on_device';

export const NUTRITION_PARSER_MODE_KEY = 'yourbody_nutrition_parser_mode';
export const NUTRITION_PARSER_MODE_CHANGE_EVENT = 'yourbody_nutrition_parser_mode_change';

const VALID_MODES: ReadonlySet<NutritionParserMode> = new Set<NutritionParserMode>([
  'auto',
  'always_ai',
  'on_device',
]);

/**
 * Returns the currently active parser mode from localStorage.
 * Defaults to 'auto' if missing, unparseable, or invalid.
 */
export function getNutritionParserMode(): NutritionParserMode {
  if (typeof localStorage === 'undefined') {
    return 'auto';
  }
  try {
    const stored = localStorage.getItem(NUTRITION_PARSER_MODE_KEY);
    if (stored && VALID_MODES.has(stored as NutritionParserMode)) {
      return stored as NutritionParserMode;
    }
  } catch {
    // Graceful fallback on localStorage access restrictions
  }
  return 'auto';
}

/**
 * Writes the specified parser mode to localStorage and notifies listeners
 * on the current window via a custom event.
 */
export function setNutritionParserMode(mode: NutritionParserMode): void {
  const nextMode: NutritionParserMode = VALID_MODES.has(mode) ? mode : 'auto';
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, nextMode);
    } catch {
      // Graceful fallback on localStorage quota / access issues
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NUTRITION_PARSER_MODE_CHANGE_EVENT));
  }
}

export interface UseNutritionParserModeReturn {
  mode: NutritionParserMode;
  setMode: (mode: NutritionParserMode) => void;
}

/**
 * React hook to read and update the device-local nutrition parser mode preference.
 * Synchronizes across multiple components and tabs using custom and storage events.
 */
export function useNutritionParserMode(): UseNutritionParserModeReturn {
  const [mode, setModeState] = useState<NutritionParserMode>(getNutritionParserMode);

  useEffect(() => {
    const handleSync = () => {
      setModeState(getNutritionParserMode());
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleSync);
      window.addEventListener(NUTRITION_PARSER_MODE_CHANGE_EVENT, handleSync);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleSync);
        window.removeEventListener(NUTRITION_PARSER_MODE_CHANGE_EVENT, handleSync);
      }
    };
  }, []);

  const setMode = useCallback((newMode: NutritionParserMode) => {
    setNutritionParserMode(newMode);
    setModeState(getNutritionParserMode());
  }, []);

  return { mode, setMode };
}
