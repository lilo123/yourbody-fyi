import { getOfflineDb } from './db';

// In-memory cache per user: userId -> (clientWorkoutId -> canonicalId)
const memoryCache = new Map<string, Map<string, string>>();

function getUserMap(userId: string): Map<string, string> {
  let userMap = memoryCache.get(userId);
  if (!userMap) {
    userMap = new Map<string, string>();
    memoryCache.set(userId, userMap);
  }
  return userMap;
}

export async function setIdMapping(
  userId: string,
  clientWorkoutId: string,
  canonicalId: string
): Promise<void> {
  getUserMap(userId).set(clientWorkoutId, canonicalId);
  const db = await getOfflineDb(userId);
  await db.put('idmap', canonicalId, clientWorkoutId);
}

export async function getIdMapping(
  userId: string,
  clientWorkoutId: string
): Promise<string | undefined> {
  const cached = getUserMap(userId).get(clientWorkoutId);
  if (cached) return cached;

  const db = await getOfflineDb(userId);
  const canonical = await db.get('idmap', clientWorkoutId);
  if (canonical) {
    getUserMap(userId).set(clientWorkoutId, canonical);
    return canonical;
  }
  return undefined;
}

export async function resolveWorkoutRef(
  userId: string,
  workoutRef: string
): Promise<string> {
  if (!workoutRef) return workoutRef;
  const canonical = await getIdMapping(userId, workoutRef);
  return canonical || workoutRef;
}

export function resolveWorkoutRefSync(
  userId: string,
  workoutRef: string
): string {
  if (!workoutRef) return workoutRef;
  const cached = getUserMap(userId).get(workoutRef);
  return cached || workoutRef;
}

export async function loadIdMappings(userId: string): Promise<void> {
  const db = await getOfflineDb(userId);
  const tx = db.transaction('idmap', 'readonly');
  const store = tx.store;
  let cursor = await store.openCursor();
  const userMap = getUserMap(userId);
  while (cursor) {
    userMap.set(cursor.key as string, cursor.value as string);
    cursor = await cursor.continue();
  }
  await tx.done;
}

export function clearIdMappingsForTesting(): void {
  memoryCache.clear();
}
