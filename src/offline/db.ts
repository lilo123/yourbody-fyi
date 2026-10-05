import { openDB, type IDBPDatabase, deleteDB } from 'idb';
import type { OfflineDBSchema } from './types';

export const DB_VERSION = 2;

export function getOfflineDbName(userId: string): string {
  if (!userId) {
    throw new Error('userId is required to access offline database');
  }
  return `yourbody-offline-${userId}`;
}

const dbCache = new Map<string, Promise<IDBPDatabase<OfflineDBSchema>>>();

export async function getOfflineDb(userId: string): Promise<IDBPDatabase<OfflineDBSchema>> {
  const dbName = getOfflineDbName(userId);
  const cached = dbCache.get(dbName);
  if (cached) {
    try {
      const db = await cached;
      // If DB was closed externally, remove from cache and reopen
      db.transaction('meta', 'readonly');
      return db;
    } catch (err) {
      // Cached connection was closed or in invalid state; evict from cache to reconnect
      dbCache.delete(dbName);
      if (!isDbClosedError(err)) {
        console.warn('[db] Cached DB connection error, evicting cache:', err);
      }
    }
  }

  const promise = openDB<OfflineDBSchema>(dbName, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('rq')) {
        db.createObjectStore('rq');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const outboxStore = db.createObjectStore('outbox', { keyPath: 'opId' });
        outboxStore.createIndex('seq', 'seq', { unique: true });
        outboxStore.createIndex('userId', 'userId', { unique: false });
        outboxStore.createIndex('state', 'state', { unique: false });
      }
      if (!db.objectStoreNames.contains('idmap')) {
        db.createObjectStore('idmap');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
      if (!db.objectStoreNames.contains('aiq')) {
        const aiqStore = db.createObjectStore('aiq', { keyPath: 'id' });
        aiqStore.createIndex('status', 'status', { unique: false });
        aiqStore.createIndex('capturedAt', 'capturedAt', { unique: false });
      }
    },
    blocked() {
      console.warn(`[offlineDb] openDB blocked for ${dbName}`);
    },
    blocking() {
      console.warn(`[offlineDb] openDB blocking for ${dbName}`);
    },
    terminated() {
      console.warn(`[offlineDb] openDB terminated for ${dbName}`);
      dbCache.delete(dbName);
    },
  });

  dbCache.set(dbName, promise);
  return promise;
}

export async function closeOfflineDb(userId: string): Promise<void> {
  const dbName = getOfflineDbName(userId);
  const promise = dbCache.get(dbName);
  if (promise) {
    dbCache.delete(dbName);
    try {
      const db = await promise;
      db.close();
    } catch (err) {
      // DB connection may already be closing or closed during teardown.
      if (!isDbClosedError(err)) {
        console.warn('[db] Failed to close offline DB:', err);
      }
    }
  }
}

export async function closeAllOfflineDbs(): Promise<void> {
  const entries = Array.from(dbCache.entries());
  dbCache.clear();
  for (const [, promise] of entries) {
    promise
      .then((db) => {
        try {
          db.close();
        } catch {
          // DB connection may already be closing or closed during teardown.
        }
      })
      .catch((openErr) => {
        // Pending openDB promise failed; ignore if DB was closed/invalidated during teardown, warn otherwise.
        if (!isDbClosedError(openErr)) {
          console.warn('[db] Failed to open DB during closeAllOfflineDbs:', openErr);
        }
      });
  }
}

export async function clearUserRqStore(userId: string): Promise<void> {
  const db = await getOfflineDb(userId);
  const tx = db.transaction('rq', 'readwrite');
  await tx.store.clear();
  await tx.done;
}

export async function deleteOfflineDb(userId: string): Promise<void> {
  await closeOfflineDb(userId);
  const dbName = getOfflineDbName(userId);
  await deleteDB(dbName);
}

const EXACT_DB_CLOSED_MESSAGES = new Set([
  'The database connection is closing.',
  'The database connection is closed.',
  'Database is closing',
  'Database is closed',
  'The database is closing.',
  'The database is closed.',
  'An operation was called on an object on which it is not allowed or at a time when it is not allowed. Also occurs if a request is made on a source object that has been deleted or removed. Use TransactionInactiveError or ReadOnlyError when possible, as they are more specific variations of InvalidStateError.',
  'The object is in an invalid state.',
]);

export function isDbClosedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  if (typeof name === 'string' && name === 'InvalidStateError') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && EXACT_DB_CLOSED_MESSAGES.has(message);
}

