import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Z_INDEX_MODAL,
  Z_INDEX_TOAST,
  Z_INDEX_INNER_PICKER,
  isAnyModalOpen,
  getModalToastTop,
  getModalBottomAvoidance,
} from './zLayers';

describe('zLayers constants and modal detection (D-YB5-T1, D-YB5-T2)', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(852);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(393);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  });

  it('declares the expected stacking scale constants', () => {
    expect(Z_INDEX_MODAL).toBe('z-[60]');
    expect(Z_INDEX_TOAST).toBe('z-[65]');
    expect(Z_INDEX_INNER_PICKER).toBe('z-[70]');
  });

  it('returns false when no modal dialog is present in the DOM', () => {
    expect(isAnyModalOpen()).toBe(false);
  });

  it('returns true when an aria-modal dialog is present in the DOM', () => {
    if (!container) throw new Error('Container must exist');
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    container.appendChild(modal);

    expect(isAnyModalOpen()).toBe(true);
  });

  it('returns false when dialog role is present but aria-modal is not true', () => {
    if (!container) throw new Error('Container must exist');
    const nonModal = document.createElement('div');
    nonModal.setAttribute('role', 'dialog');
    nonModal.setAttribute('aria-modal', 'false');
    container.appendChild(nonModal);

    expect(isAnyModalOpen()).toBe(false);
  });

  it('returns false for live regions like status or alert banners', () => {
    if (!container) throw new Error('Container must exist');
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.appendChild(status);

    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-live', 'assertive');
    container.appendChild(alert);

    expect(isAnyModalOpen()).toBe(false);
  });

  it('re-evaluates accurately when a modal dialog is dynamically removed', () => {
    if (!container) throw new Error('Container must exist');
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    container.appendChild(modal);

    expect(isAnyModalOpen()).toBe(true);

    container.removeChild(modal);
    expect(isAnyModalOpen()).toBe(false);
  });

  describe('getModalToastTop dynamic geometry (D-YB5-T2 / YB5 Addendum A)', () => {
    it('returns fallback top lane when no modal dialog is present in DOM', () => {
      expect(getModalToastTop()).toBe('calc(env(safe-area-inset-top, 0px) + 12px)');
      expect(getModalToastTop(1)).toBe('calc(env(safe-area-inset-top, 0px) + 80px)');
    });

    it('returns fallback when dialog is present but has no close button or header', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      expect(getModalToastTop()).toBe('calc(env(safe-area-inset-top, 0px) + 12px)');
    });

    it('positions toast 8px below close button when close button is present', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Close edit meal');
      modal.appendChild(closeBtn);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 393,
        height: 844,
        top: 0,
        bottom: 844,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      vi.spyOn(closeBtn, 'getBoundingClientRect').mockReturnValue({
        x: 336,
        y: 9,
        width: 40,
        height: 40,
        top: 9,
        bottom: 49,
        left: 336,
        right: 376,
        toJSON: () => {},
      });

      // headerBottom is 49px -> targetTop = 49 + 8 = 57px
      expect(getModalToastTop()).toBe('max(calc(env(safe-area-inset-top, 0px) + 12px), 57px)');
    });

    it('positions toast 8px below the header flex row when parent flex container exists', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const headerRow = document.createElement('div');
      headerRow.className = 'flex items-center justify-between border-b border-zinc-800 pb-2';
      modal.appendChild(headerRow);

      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Close edit meal');
      headerRow.appendChild(closeBtn);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 393,
        height: 844,
        top: 0,
        bottom: 844,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      vi.spyOn(closeBtn, 'getBoundingClientRect').mockReturnValue({
        x: 336,
        y: 9,
        width: 40,
        height: 40,
        top: 9,
        bottom: 49,
        left: 336,
        right: 376,
        toJSON: () => {},
      });

      vi.spyOn(headerRow, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 9,
        width: 393,
        height: 49,
        top: 9,
        bottom: 58,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      // flex row bottom is 58px -> targetTop = 58 + 8 = 66px
      expect(getModalToastTop()).toBe('max(calc(env(safe-area-inset-top, 0px) + 12px), 66px)');
    });

    it('adjusts position for stacked toasts', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Close dialog');
      modal.appendChild(closeBtn);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 393,
        height: 844,
        top: 0,
        bottom: 844,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      vi.spyOn(closeBtn, 'getBoundingClientRect').mockReturnValue({
        x: 336,
        y: 9,
        width: 40,
        height: 40,
        top: 9,
        bottom: 49,
        left: 336,
        right: 376,
        toJSON: () => {},
      });

      // stackIndex 1: baseOffset = 12 + 68 = 80; targetTop = 49 + 8 + 68 = 125
      expect(getModalToastTop(1)).toBe('max(calc(env(safe-area-inset-top, 0px) + 80px), 125px)');
    });

    it('uses the top-most dialog when multiple modal dialogs are rendered in DOM', () => {
      if (!container) throw new Error('Container must exist');
      const modal1 = document.createElement('div');
      modal1.setAttribute('role', 'dialog');
      modal1.setAttribute('aria-modal', 'true');
      container.appendChild(modal1);

      const closeBtn1 = document.createElement('button');
      closeBtn1.setAttribute('aria-label', 'Close base modal');
      modal1.appendChild(closeBtn1);

      const modal2 = document.createElement('div');
      modal2.setAttribute('role', 'dialog');
      modal2.setAttribute('aria-modal', 'true');
      container.appendChild(modal2);

      const closeBtn2 = document.createElement('button');
      closeBtn2.setAttribute('aria-label', 'Close top modal');
      modal2.appendChild(closeBtn2);

      vi.spyOn(modal1, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 393,
        height: 844,
        top: 0,
        bottom: 844,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      vi.spyOn(closeBtn1, 'getBoundingClientRect').mockReturnValue({
        x: 336,
        y: 9,
        width: 40,
        height: 40,
        top: 9,
        bottom: 49,
        left: 336,
        right: 376,
        toJSON: () => {},
      });

      vi.spyOn(modal2, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 50,
        width: 393,
        height: 700,
        top: 50,
        bottom: 750,
        left: 0,
        right: 393,
        toJSON: () => {},
      });

      vi.spyOn(closeBtn2, 'getBoundingClientRect').mockReturnValue({
        x: 336,
        y: 60,
        width: 40,
        height: 40,
        top: 60,
        bottom: 100,
        left: 336,
        right: 376,
        toJSON: () => {},
      });

      // Should measure modal2 (topmost): closeBtn2 bottom is 100 -> 100 + 8 = 108px
      expect(getModalToastTop()).toBe('max(calc(env(safe-area-inset-top, 0px) + 12px), 108px)');
    });
  });

  describe('getModalBottomAvoidance dynamic geometry (D-YB6-2)', () => {
    it('returns baseOffset when no modal dialog is present in DOM', () => {
      expect(getModalBottomAvoidance(74)).toBe(74);
    });

    it('returns baseOffset when modal dialog is present but action row is not in lane', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      modal.appendChild(staged);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      // staged row mid-screen (top=300, bottom=354)
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 300, width: 393, height: 54, top: 300, bottom: 354, left: 0, right: 393, toJSON: () => {},
      });

      // Window height 852, baseOffset 74, lane is [706, 786]. Obstacle at [300, 354] does not intersect.
      expect(getModalBottomAvoidance(74)).toBe(74);
    });

    it('raises offset when staged-card-actions intersects bottom lane', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      modal.appendChild(staged);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      // staged row in bottom lane: top=750, height=54 (bottom=804)
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 750, width: 393, height: 54, top: 750, bottom: 804, left: 0, right: 393, toJSON: () => {},
      });

      // Raised to: vh - rowTop + 8 = 852 - 750 + 8 = 110px
      expect(getModalBottomAvoidance(74)).toBe(110);
    });

    it('raises offset when submit button parent intersects bottom lane', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const actionRow = document.createElement('div');
      modal.appendChild(actionRow);

      const submitBtn = document.createElement('button');
      submitBtn.setAttribute('type', 'submit');
      actionRow.appendChild(submitBtn);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      vi.spyOn(actionRow, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 760, width: 393, height: 44, top: 760, bottom: 804, left: 0, right: 393, toJSON: () => {},
      });
      vi.spyOn(submitBtn, 'getBoundingClientRect').mockReturnValue({
        x: 280, y: 760, width: 100, height: 44, top: 760, bottom: 804, left: 280, right: 380, toJSON: () => {},
      });

      // Raised to: 852 - 760 + 8 = 100px
      expect(getModalBottomAvoidance(74)).toBe(100);
    });

    it('raises offset when focused input inside dialog intersects bottom lane', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const input = document.createElement('input');
      modal.appendChild(input);
      input.focus();

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        x: 20, y: 740, width: 350, height: 40, top: 740, bottom: 780, left: 20, right: 370, toJSON: () => {},
      });

      // Raised to: 852 - 740 + 8 = 120px
      expect(getModalBottomAvoidance(74)).toBe(120);
    });

    it('does NOT raise offset for unfocused item-row buttons in bottom lane', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const itemRow = document.createElement('div');
      const deleteItemBtn = document.createElement('button');
      deleteItemBtn.setAttribute('type', 'button');
      deleteItemBtn.setAttribute('aria-label', 'Delete item');
      itemRow.appendChild(deleteItemBtn);
      modal.appendChild(itemRow);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });
      vi.spyOn(deleteItemBtn, 'getBoundingClientRect').mockReturnValue({
        x: 20, y: 750, width: 40, height: 40, top: 750, bottom: 790, left: 20, right: 60, toJSON: () => {},
      });

      // Must NOT raise: returns baseOffset
      expect(getModalBottomAvoidance(74)).toBe(74);
    });

    it('falls back to offset0 when raising would push toast into header/close button', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'Close edit meal');
      modal.appendChild(closeBtn);

      const staged = document.createElement('div');
      staged.setAttribute('data-testid', 'staged-card-actions');
      modal.appendChild(staged);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 200, top: 0, bottom: 200, left: 0, right: 393, toJSON: () => {},
      });
      vi.spyOn(closeBtn, 'getBoundingClientRect').mockReturnValue({
        x: 336, y: 9, width: 40, height: 40, top: 9, bottom: 49, left: 336, right: 376, toJSON: () => {},
      });
      // staged row at top=100 in tiny viewport vh=200
      vi.spyOn(staged, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 100, width: 393, height: 50, top: 100, bottom: 150, left: 0, right: 393, toJSON: () => {},
      });

      // In vh=200, toastHeight=64, if raised to vh - 100 + 8 = 108:
      // toast top would be 200 - 108 - 64 = 28px, which is < headerBottom (49) + 8 = 57px!
      // Header guard triggers and returns offset0 (74)
      expect(getModalBottomAvoidance(74)).toBe(74);
    });

    it('accounts for virtual keyboard inset when visualViewport is contracted', () => {
      if (!container) throw new Error('Container must exist');
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      container.appendChild(modal);

      vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, width: 393, height: 852, top: 0, bottom: 852, left: 0, right: 393, toJSON: () => {},
      });

      // Mock visualViewport: height 500 in 852 vh -> kb = 852 - 500 = 352 >= 100
      const originalVv = window.visualViewport;
      try {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: {
            offsetTop: 0,
            height: 500,
            width: 393,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
        });

        // offset0 = max(74, round(352 + 8)) = 360
        expect(getModalBottomAvoidance(74)).toBe(360);
      } finally {
        Object.defineProperty(window, 'visualViewport', {
          configurable: true,
          value: originalVv,
        });
      }
    });
  });
});
