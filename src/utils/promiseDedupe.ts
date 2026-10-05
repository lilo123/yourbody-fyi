/**
 * promiseDedupe.ts (F-15)
 *
 * Provides in-flight promise deduplication for asynchronous operations.
 * When multiple callers invoke dedupeInFlight with the same key while a request
 * is still active, they share the single in-flight Promise rather than firing
 * duplicate network calls.
 *
 * Preserves strict staleness semantics: upon settlement (resolution or rejection),
 * the key is immediately cleared in .finally(). Subsequent requests after completion
 * will trigger a fresh invocation.
 */

const inFlightMap = new Map<string, Promise<unknown>>();

export function dedupeInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlightMap.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = factory().finally(() => {
    inFlightMap.delete(key);
  });

  inFlightMap.set(key, promise);
  return promise;
}

export function getInFlightCount(): number {
  return inFlightMap.size;
}

export function clearInFlight(): void {
  inFlightMap.clear();
}
