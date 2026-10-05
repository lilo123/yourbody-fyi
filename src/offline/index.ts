// Core types
export * from './types';

// Database & ID mapping
export {
  getOfflineDb,
  getOfflineDbName,
  closeOfflineDb,
  closeAllOfflineDbs,
  clearUserRqStore,
  deleteOfflineDb,
} from './db';

export {
  setIdMapping,
  getIdMapping,
  resolveWorkoutRef,
  resolveWorkoutRefSync,
  loadIdMappings,
  clearIdMappingsForTesting,
} from './idmap';

// Compaction
export {
  compactIncomingOp,
  type CompactionAction,
  type CompactionResult,
} from './compaction';

// Error classification
export { classifyError } from './classify';

// Replay execution
export {
  executeReplayOp,
  type ReplayResult,
} from './replay';

// Outbox
export {
  enqueue,
  getOutboxOps,
  getOutboxSummary,
  updateOp,
  deleteOp,
  blockDependentOps,
  retryOp,
  discardOp,
  subscribeToOutbox,
  notifyOutboxChanged,
  setSyncingStatus,
  setAuthRequiredStatus,
  setLastSyncedCount,
  getSyncingStatus,
  getAuthRequiredStatus,
  getLastSyncedCount,
  getCachedOutboxSummary,
  getCachedOpsForUser,
  hasCachedOpsForUser,
} from './outbox';

// Flusher & Concurrency
export {
  flushNow,
  enqueueAndAwait,
  onSynced,
  newId,
  setActiveUserForFlusher,
  getActiveUserId,
  setFlusherSessionUser,
} from './flusher';

// Persister & Persist Controller
export {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  WHITELIST_ROOTS,
  shouldDehydrateQuery,
  applyPageCaps,
  createIdbPersister,
  getCivilDateInTz,
  getCivilDayDifference,
} from './persister';

export {
  setupQueryDefaults,
  initPersistForUser,
  stopPersisting,
  clearUserReadCache,
  getCurrentPersistingUserId,
} from './persistController';

// Offline fallback
export { offlineFallback } from './offlineFallback';

// Overlay pure functions
export {
  applyPendingToDaySets,
  pendingSetsBefore,
  applyPendingToHistory,
  applyPendingToNutritionLogs,
  type OverlayNutritionLogsOptions,
} from './overlay';

// AI Queue
export {
  enqueueAiItem,
  listAiItems,
  discardAiItem,
  markReviewed,
  deleteAfterLog,
  resetStuckAnalyzingItems,
  startAiQueueProcessor,
  subscribeToAiQueue,
  notifyAiQueueChanged,
  getCachedAiQueue,
  runWithAiMutex,
  AiPhotoTooLargeError,
  MAX_PHOTO_BASE64_BYTES,
  AI_RATE_LIMIT_MS,
  DEFAULT_429_RETRY_AFTER_SECONDS,
  MIN_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from './aiQueue';

// Hooks
export {
  usePendingOps,
  useOutboxSummary,
  useAiQueue,
  useOverlaidNutritionLogs,
} from './hooks';

// Update safety blocker & helpers
export {
  registerOutboxUpdateBlocker,
  pendingBeforeSignOut,
} from './blocker';
