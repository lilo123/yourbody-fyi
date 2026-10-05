export const TAB_ROUTES = [
  '/workout',
  '/nutrition',
  '/history',
  '/exercises',
  '/coach',
  '/settings',
] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];

export const DEFAULT_ROUTE: TabRoute = '/workout';

/**
 * Validates if the given path is one of the 6 primary tab routes.
 */
export function isTabRoute(path: string): path is TabRoute {
  if (!path) return false;
  const normalized = path.replace(/\/+$/, '') || '/';
  return (TAB_ROUTES as readonly string[]).includes(normalized);
}

/**
 * Returns the storage key for a user's last-visited route.
 */
export function getLastRouteStorageKey(userId: string): string {
  return `yourbody_last_route_${userId}`;
}

/**
 * Records the last-used tab route for a specific user.
 * Ignores non-tab routes (e.g. /login, /reset-password) or anonymous visits.
 */
export function recordLastRoute(pathname: string, userId?: string | null): void {
  if (!userId || typeof localStorage === 'undefined') return;

  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (isTabRoute(normalized)) {
    try {
      localStorage.setItem(getLastRouteStorageKey(userId), normalized);
    } catch {
      // Ignore storage errors (quota/disabled)
    }
  }
}

/**
 * Retrieves the last-used tab route for a user, defaulting to /workout.
 */
export function getLastRoute(userId?: string | null): string {
  if (!userId || typeof localStorage === 'undefined') {
    return DEFAULT_ROUTE;
  }

  try {
    const saved = localStorage.getItem(getLastRouteStorageKey(userId));
    if (saved && isTabRoute(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }

  return DEFAULT_ROUTE;
}
