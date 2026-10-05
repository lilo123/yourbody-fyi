import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TAB_ROUTES,
  DEFAULT_ROUTE,
  isTabRoute,
  recordLastRoute,
  getLastRoute,
  getLastRouteStorageKey,
} from './lastRoute';

describe('Last-used route tracking (A12)', () => {
  const userA = 'user-alpha-1111';
  const userB = 'user-bravo-2222';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('recognizes exactly the 6 tab routes', () => {
    expect(TAB_ROUTES).toEqual([
      '/workout',
      '/nutrition',
      '/history',
      '/exercises',
      '/coach',
      '/settings',
    ]);

    for (const route of TAB_ROUTES) {
      expect(isTabRoute(route)).toBe(true);
      expect(isTabRoute(`${route}/`)).toBe(true);
    }

    expect(isTabRoute('/')).toBe(false);
    expect(isTabRoute('/login')).toBe(false);
    expect(isTabRoute('/reset-password')).toBe(false);
    expect(isTabRoute('/random-subpath')).toBe(false);
  });

  it('records only valid tab routes for a user', () => {
    recordLastRoute('/nutrition', userA);
    expect(getLastRoute(userA)).toBe('/nutrition');

    // Non-tab routes do not overwrite the recorded route
    recordLastRoute('/login', userA);
    expect(getLastRoute(userA)).toBe('/nutrition');

    recordLastRoute('/reset-password', userA);
    expect(getLastRoute(userA)).toBe('/nutrition');

    // Another valid tab route updates it
    recordLastRoute('/history', userA);
    expect(getLastRoute(userA)).toBe('/history');
  });

  it('isolates last route per user', () => {
    recordLastRoute('/nutrition', userA);
    recordLastRoute('/settings', userB);

    expect(getLastRoute(userA)).toBe('/nutrition');
    expect(getLastRoute(userB)).toBe('/settings');

    expect(localStorage.getItem(getLastRouteStorageKey(userA))).toBe('/nutrition');
    expect(localStorage.getItem(getLastRouteStorageKey(userB))).toBe('/settings');
  });

  it('defaults to /workout when no route recorded or user is null', () => {
    expect(getLastRoute(null)).toBe(DEFAULT_ROUTE);
    expect(getLastRoute(undefined)).toBe(DEFAULT_ROUTE);
    expect(getLastRoute('unknown-user')).toBe(DEFAULT_ROUTE);
  });

  it('handles corrupted localStorage entries gracefully by falling back to /workout', () => {
    localStorage.setItem(getLastRouteStorageKey(userA), 'invalid-route');
    expect(getLastRoute(userA)).toBe(DEFAULT_ROUTE);
  });
});
