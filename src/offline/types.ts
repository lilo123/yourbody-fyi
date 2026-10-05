import type { DBSchema } from 'idb';

export type OpKind =
  | 'workout.ensure'
  | 'workout.rename'
  | 'set.create'
  | 'set.batchCreate'
  | 'set.update'
  | 'set.delete'
  | 'nutrition.log';

export type OpState = 'pending' | 'inflight' | 'attention';

export type SetTypeKind = 'warmup' | 'working' | 'drop';

export interface WorkoutEnsurePayload {
  clientWorkoutId: string;
  workout_date: string;
  name?: string | null;
}

export interface WorkoutRenamePayload {
  workoutRef: string;
  name: string;
}

export interface SetCreatePayload {
  id: string;
  workoutRef: string;
  exercise_id: string;
  weight: number;
  reps: number;
  set_index: number;
  set_type?: SetTypeKind;
  rpe?: number | null;
  created_at: string; // ISO string
}

export interface BatchSetItem {
  id: string;
  exercise_id: string;
  weight: number;
  reps: number;
  set_index: number;
  set_type?: SetTypeKind;
  rpe?: number | null;
  created_at: string; // ISO string
}

export interface SetBatchCreatePayload {
  workoutRef: string;
  sets: BatchSetItem[];
}

export interface SetPatchFields {
  weight?: number;
  reps?: number;
  set_index?: number;
  set_type?: SetTypeKind;
  rpe?: number | null;
  exercise_id?: string;
}

export interface SetUpdatePayload {
  id: string;
  patch: SetPatchFields;
  expected?: SetPatchFields;
}

export interface SetDeletePayload {
  id: string;
}

export interface NutritionLogPayload {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  meal_type?: string | null;
  serving_size?: number | null;
  serving_unit?: string | null;
  logged_at: string; // ISO string with offset
  logged_date: string; // civil date YYYY-MM-DD
  items?: unknown | null;
  notes?: string | null;
  incrementDishId?: string;
  [key: string]: unknown;
}

export type OpPayloadMap = {
  'workout.ensure': WorkoutEnsurePayload;
  'workout.rename': WorkoutRenamePayload;
  'set.create': SetCreatePayload;
  'set.batchCreate': SetBatchCreatePayload;
  'set.update': SetUpdatePayload;
  'set.delete': SetDeletePayload;
  'nutrition.log': NutritionLogPayload;
};

interface BaseOp {
  opId: string;
  userId: string;
  seq: number;
  createdAt: string; // ISO timestamp
  attempts: number;
  state: OpState;
  error?: string;
  blockedBy?: string; // opId of blocking op
}

export interface OutboxOpEnsure extends BaseOp {
  kind: 'workout.ensure';
  payload: WorkoutEnsurePayload;
}

export interface OutboxOpRename extends BaseOp {
  kind: 'workout.rename';
  payload: WorkoutRenamePayload;
}

export interface OutboxOpCreate extends BaseOp {
  kind: 'set.create';
  payload: SetCreatePayload;
}

export interface OutboxOpBatchCreate extends BaseOp {
  kind: 'set.batchCreate';
  payload: SetBatchCreatePayload;
}

export interface OutboxOpUpdate extends BaseOp {
  kind: 'set.update';
  payload: SetUpdatePayload;
}

export interface OutboxOpDelete extends BaseOp {
  kind: 'set.delete';
  payload: SetDeletePayload;
}

export interface OutboxOpNutritionLog extends BaseOp {
  kind: 'nutrition.log';
  payload: NutritionLogPayload;
}

export type OutboxOp =
  | OutboxOpEnsure
  | OutboxOpRename
  | OutboxOpCreate
  | OutboxOpBatchCreate
  | OutboxOpUpdate
  | OutboxOpDelete
  | OutboxOpNutritionLog;

export interface OutboxSummary {
  pending: number;
  attention: number;
  syncing: boolean;
  authRequired: boolean;
  lastSyncedCount: number;
  needsAttentionOps: OutboxOp[];
}

export type ErrorClass = 'TRANSIENT' | 'AUTH' | 'PERMANENT';

export interface ErrorClassification {
  kind: ErrorClass;
  reason: string;
  code?: string | number;
  isInvalidRefreshToken?: boolean;
}

export interface EnqueueAndAwaitOptions {
  timeoutMs?: number;
}

export type EnqueueAndAwaitResult =
  | { status: 'synced'; opId: string }
  | { status: 'queued'; opId: string };

export type AiQueueItemStatus = 'queued' | 'analyzing' | 'ready' | 'failed';
export type AiQueueItemKind = 'text' | 'photo';

export interface AiQueuePhoto {
  base64: string;
  mime: string;
}

export interface AiQueueItem {
  id: string;
  userId: string;
  kind: AiQueueItemKind;
  text?: string;
  photo?: AiQueuePhoto;
  capturedAt: string; // ISO instant with offset
  captureDate: string; // civil date in user timezone
  mealType?: string;
  status: AiQueueItemStatus;
  result?: unknown;
  attempts: number;
  nextAttemptAt: number; // timestamp ms
  lastError?: string;
}

export interface EnqueueAiItemInput {
  id?: string;
  userId: string;
  kind: AiQueueItemKind;
  text?: string;
  photo?: AiQueuePhoto;
  capturedAt: string;
  captureDate: string;
  mealType?: string;
}

export interface AiQueueCounts {
  queued: number;
  analyzing: number;
  ready: number;
  failed: number;
  total: number;
}

export interface AiQueueState {
  items: AiQueueItem[];
  counts: AiQueueCounts;
  isAnalyzing: boolean;
}

export interface OfflineDBSchema extends DBSchema {
  rq: {
    key: string;
    value: unknown;
  };
  outbox: {
    key: string; // opId
    value: OutboxOp;
    indexes: {
      seq: number;
      userId: string;
      state: string;
    };
  };
  idmap: {
    key: string; // clientWorkoutId
    value: string; // canonicalId
  };
  meta: {
    key: string;
    value: unknown;
  };
  aiq: {
    key: string; // item id
    value: AiQueueItem;
    indexes: {
      status: string;
      capturedAt: string;
    };
  };
}
