import type { QueryClient } from '@tanstack/react-query';

/**
 * Returns the most recent cached data in a key family from the React Query cache.
 * Used as placeholderData when exact date-keyed keys are missing while offline (§A6).
 */
export function offlineFallback<T>(
  queryClient: QueryClient,
  familyPrefix: readonly unknown[],
  match?: (queryKey: readonly unknown[]) => boolean
): T | undefined {
  const queryCache = queryClient.getQueryCache();
  const queries = queryCache.findAll({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || key.length < familyPrefix.length) {
        return false;
      }
      for (let i = 0; i < familyPrefix.length; i++) {
        if (key[i] !== familyPrefix[i]) return false;
      }
      if (match && !match(key)) {
        return false;
      }
      return query.state.status === 'success' && query.state.data !== undefined;
    },
  });

  if (queries.length === 0) {
    return undefined;
  }

  queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  return queries[0].state.data as T;
}
