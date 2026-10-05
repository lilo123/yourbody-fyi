/**
 * Shared virtualization constants for list views with fallback rendering.
 * Lists falling back to non-virtualized rendering must cap at FALLBACK_WINDOW
 * to prevent DOM explosions while providing an honest visible affordance.
 * Keyset-paginated list overscan for smooth scrolling.
 */
export const FALLBACK_WINDOW = 5;
export const HISTORY_OVERSCAN = 5;
