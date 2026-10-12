import { describe, it, expect } from 'vitest';
import { isStandalone, shouldShowLanding, decideRootRoute } from './routeDecision';

describe('routeDecision: pure function decision for root ("/") route', () => {
  describe('isStandalone detection', () => {
    it('returns true when window.matchMedia matches display-mode: standalone', () => {
      const mockWin = {
        matchMedia: (query: string) => ({
          matches: query === '(display-mode: standalone)',
        }),
      };
      const mockNav = { standalone: false };

      expect(isStandalone(mockWin, mockNav)).toBe(true);
    });

    it('returns true when iOS navigator.standalone is true even if matchMedia is false', () => {
      const mockWin = {
        matchMedia: () => ({ matches: false }),
      };
      const mockNav = { standalone: true };

      expect(isStandalone(mockWin, mockNav)).toBe(true);
    });

    it('returns false when neither matchMedia nor navigator.standalone is set', () => {
      const mockWin = {
        matchMedia: () => ({ matches: false }),
      };
      const mockNav = { standalone: false };

      expect(isStandalone(mockWin, mockNav)).toBe(false);
    });

    it('handles null / undefined / throwing matchMedia gracefully', () => {
      const brokenWin = {
        matchMedia: () => {
          throw new Error('Not supported');
        },
      };
      expect(isStandalone(brokenWin, { standalone: false })).toBe(false);
      expect(isStandalone(brokenWin, { standalone: true })).toBe(true);
      expect(isStandalone(null, null)).toBe(false);
    });
  });

  describe('Route decision 4-combination matrix + iOS navigator.standalone', () => {
    // 1. standalone: true, hasUser: true -> app (redirect)
    it('combination 1: standalone=true, hasUser=true -> app (no landing)', () => {
      const user = { id: 'u1' };
      expect(shouldShowLanding(user, true)).toBe(false);
      expect(decideRootRoute(user, true)).toBe('app');
    });

    // 2. standalone: true, hasUser: false -> app (redirect to login)
    it('combination 2: standalone=true, hasUser=false -> app (no landing)', () => {
      expect(shouldShowLanding(null, true)).toBe(false);
      expect(decideRootRoute(null, true)).toBe('app');
    });

    // 3. standalone: false, hasUser: true -> app (redirect to last route)
    it('combination 3: standalone=false, hasUser=true -> app (no landing)', () => {
      const user = { id: 'u1' };
      expect(shouldShowLanding(user, false)).toBe(false);
      expect(decideRootRoute(user, false)).toBe('app');
    });

    // 4. standalone: false, hasUser: false -> landing (public visitor)
    it('combination 4: standalone=false, hasUser=false -> landing', () => {
      expect(shouldShowLanding(null, false)).toBe(true);
      expect(decideRootRoute(null, false)).toBe('landing');
    });

    // iOS navigator.standalone specific cases
    it('iOS navigator.standalone=true with logged-out visitor -> app (redirect)', () => {
      const mockWin = { matchMedia: () => ({ matches: false }) };
      const mockNav = { standalone: true };
      const standalone = isStandalone(mockWin, mockNav);

      expect(shouldShowLanding(null, standalone)).toBe(false);
      expect(decideRootRoute(null, standalone)).toBe('app');
    });

    it('iOS navigator.standalone=true with logged-in user -> app (redirect)', () => {
      const mockWin = { matchMedia: () => ({ matches: false }) };
      const mockNav = { standalone: true };
      const standalone = isStandalone(mockWin, mockNav);
      const user = { id: 'u1' };

      expect(shouldShowLanding(user, standalone)).toBe(false);
      expect(decideRootRoute(user, standalone)).toBe('app');
    });

    it('browser visitor with matchMedia standalone=false and iOS navigator.standalone=false -> landing', () => {
      const mockWin = { matchMedia: () => ({ matches: false }) };
      const mockNav = { standalone: false };
      const standalone = isStandalone(mockWin, mockNav);

      expect(shouldShowLanding(null, standalone)).toBe(true);
      expect(decideRootRoute(null, standalone)).toBe('landing');
    });
  });
});
