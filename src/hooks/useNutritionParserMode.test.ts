import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  getNutritionParserMode,
  setNutritionParserMode,
  useNutritionParserMode,
  NUTRITION_PARSER_MODE_KEY,
  NUTRITION_PARSER_MODE_CHANGE_EVENT,
  type NutritionParserMode,
} from './useNutritionParserMode';

describe('useNutritionParserMode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('getNutritionParserMode', () => {
    it('defaults to "auto" when localStorage is empty', () => {
      expect(getNutritionParserMode()).toBe('auto');
    });

    it('returns "always_ai" when stored in localStorage', () => {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'always_ai');
      expect(getNutritionParserMode()).toBe('always_ai');
    });

    it('returns "on_device" when stored in localStorage', () => {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'on_device');
      expect(getNutritionParserMode()).toBe('on_device');
    });

    it('falls back to "auto" for unrecognized or invalid strings', () => {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'unknown_mode');
      expect(getNutritionParserMode()).toBe('auto');

      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, '');
      expect(getNutritionParserMode()).toBe('auto');

      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'AUTO');
      expect(getNutritionParserMode()).toBe('auto');
    });
  });

  describe('setNutritionParserMode', () => {
    it('persists valid mode to localStorage and dispatches change event', () => {
      const listener = vi.fn();
      window.addEventListener(NUTRITION_PARSER_MODE_CHANGE_EVENT, listener);

      setNutritionParserMode('always_ai');
      expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBe('always_ai');
      expect(listener).toHaveBeenCalledTimes(1);

      setNutritionParserMode('on_device');
      expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBe('on_device');
      expect(listener).toHaveBeenCalledTimes(2);

      window.removeEventListener(NUTRITION_PARSER_MODE_CHANGE_EVENT, listener);
    });

    it('falls back to "auto" when attempting to set an invalid mode', () => {
      setNutritionParserMode('invalid' as NutritionParserMode);
      expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBe('auto');
    });
  });

  describe('useNutritionParserMode hook', () => {
    it('initializes with default "auto"', () => {
      const { result } = renderHook(() => useNutritionParserMode());
      expect(result.current.mode).toBe('auto');
    });

    it('initializes with value from localStorage', () => {
      localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'on_device');
      const { result } = renderHook(() => useNutritionParserMode());
      expect(result.current.mode).toBe('on_device');
    });

    it('updates mode and localStorage when setMode is called', () => {
      const { result } = renderHook(() => useNutritionParserMode());
      expect(result.current.mode).toBe('auto');

      act(() => {
        result.current.setMode('always_ai');
      });

      expect(result.current.mode).toBe('always_ai');
      expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBe('always_ai');

      act(() => {
        result.current.setMode('on_device');
      });

      expect(result.current.mode).toBe('on_device');
      expect(localStorage.getItem(NUTRITION_PARSER_MODE_KEY)).toBe('on_device');
    });

    it('synchronizes across components when custom change event fires', () => {
      const { result: hook1 } = renderHook(() => useNutritionParserMode());
      const { result: hook2 } = renderHook(() => useNutritionParserMode());

      expect(hook1.current.mode).toBe('auto');
      expect(hook2.current.mode).toBe('auto');

      act(() => {
        hook1.current.setMode('always_ai');
      });

      expect(hook1.current.mode).toBe('always_ai');
      expect(hook2.current.mode).toBe('always_ai');
    });

    it('synchronizes when window storage event fires', () => {
      const { result } = renderHook(() => useNutritionParserMode());
      expect(result.current.mode).toBe('auto');

      act(() => {
        localStorage.setItem(NUTRITION_PARSER_MODE_KEY, 'on_device');
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: NUTRITION_PARSER_MODE_KEY,
            newValue: 'on_device',
          })
        );
      });

      expect(result.current.mode).toBe('on_device');
    });

    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderHook(() => useNutritionParserMode());

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'storage',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        NUTRITION_PARSER_MODE_CHANGE_EVENT,
        expect.any(Function)
      );
    });
  });
});
