/**
 * Pure decision and standalone detection helpers for the root ('/') route.
 */

export interface RouteDecisionEnvironment {
  matchMedia?: (query: string) => { matches: boolean };
}

export interface RouteDecisionNavigator {
  standalone?: boolean;
}

export const isStandalone = (
  w: any = typeof window !== 'undefined' && window,
  n: any = typeof navigator !== 'undefined' && navigator
): boolean => {
  try {
    return !!(w?.matchMedia?.('(display-mode: standalone)')?.matches || n?.standalone);
  } catch {
    return !!n?.standalone;
  }
};

export const shouldShowLanding = (
  user: unknown,
  standalone: boolean = isStandalone()
): boolean => !user && !standalone;

export const decideRootRoute = (
  user: unknown,
  standalone?: boolean
): 'app' | 'landing' => (shouldShowLanding(user, standalone) ? 'landing' : 'app');
