# Offline Architecture & Synchronization Design

This document details the offline-first architecture, local persistence model, synchronization protocols, and design decisions for Yourbody.

---

## 1. Architectural Principles & Goals

The offline subsystem provides dependable logging for workouts and nutrition across web progressive web applications (PWAs) and Capacitor mobile wrappers without data loss or record duplication.

Core principles:
- **Write-First Outbox Pattern**: User actions are persisted locally to an IndexedDB outbox before attempting network transmission, rendering writes instantaneous and resilient to abrupt disconnection.
- **Client-Generated UUIDs**: All transactional entities (workouts, sets, nutrition logs) receive deterministic client-side UUIDs (`crypto.randomUUID()`) prior to persistence, ensuring immediate local referential integrity.
- **Sequential Idempotent Replay**: Sync replays execute sequentially through dedicated queue managers, employing idempotent upserts to guarantee that duplicate transmissions cannot corrupt server state.
- **Optimistic UI Overlays**: Local pending mutations are immediately overlaid onto read models in user interface layers, marked with accessible visual indicators (`src/components/sync/PendingMark.tsx`).

---

## 2. Per-User IndexedDB Partitioning

To ensure strict data privacy and isolation on multi-user and shared devices, the application isolates each authenticated user into a distinct IndexedDB database (`src/offline/db.ts`):

- **Database Name**: `yourbody-offline-<userId>`
- **Schema Version**: `DB_VERSION = 2`

### Store Topology

| Store | Key Path / Indices | Role | Implementation |
|---|---|---|---|
| `rq` | Key-value store | Serialized TanStack Query cache persisted for offline reading across sessions. | `src/offline/persister.ts` |
| `outbox` | KeyPath: `opId`<br>Indices: `seq` (unique), `userId`, `state` | Monotonically ordered mutations queued for sequential replay to Supabase. | `src/offline/outbox.ts` |
| `idmap` | KeyPath: `clientWorkoutId` | Maps client-generated workout UUIDs to server-canonical IDs when reconciling existing sessions. | `src/offline/idmap.ts` |
| `meta` | Key-value store | Internal synchronization timestamps, schema versions, and queue configurations. | `src/offline/db.ts` |
| `aiq` | KeyPath: `id`<br>Indices: `status`, `capturedAt` | Local queue for offline nutritional prompts and captured meal photos awaiting analysis. | `src/offline/aiQueue.ts` |

### Multi-User Isolation Guarantee

When users switch accounts on a shared device, the system closes connections to the preceding database and initializes the newly authenticated user's database. Operations belonging to User A are physically inaccessible to User B, preventing data leaks across accounts.

---

## 3. Outbox Operations & Replay Lifecycle

All write mutations across workout and nutrition workflows route through the offline outbox engine (`src/offline/outbox.ts`):

### Supported Operation Kinds

- `workout.ensure`: Ensures an active workout record exists for the specified date.
- `workout.rename`: Updates the display title of a workout session.
- `set.create`: Inserts a single workout exercise set.
- `set.batchCreate`: Atomic creation of multiple exercise sets in a single operation array.
- `set.update`: Modifies values (reps, weight, RPE, tags) on an existing set.
- `set.delete`: Deletes an individual set.
- `nutrition.log`: Inserts a nutrition meal entry with explicit civil date (`logged_date`) and capture instant (`logged_at`).

### Monotonic Enqueue & Compaction

To prevent race conditions during rapid user input, an in-memory mutex (`runWithEnqueueMutex`) serializes outbox enqueues. Before writing an operation to disk, the compaction engine (`src/offline/compaction.ts`) analyzes the pending queue:
- Merges updates into preceding unsent `create` operations.
- Coalesces rapid sequential updates into a single final state.
- Removes orphaned operations if an entity is created and subsequently deleted before syncing.
- Folds set creations into `set.batchCreate` arrays to reduce downstream network roundtrips.

### Replay & Idempotent Upsert

Replay execution is managed by `src/offline/replay.ts`:
1. `set.create` and `set.batchCreate` execute PostgreSQL upserts with `ON CONFLICT (id) DO NOTHING`.
2. `nutrition.log` executes `.upsert(row, { onConflict: 'id', ignoreDuplicates: true })`. If 0 rows are returned (record was already committed in a prior attempt), the replay treats the operation as an idempotent success.
3. For custom dish logging, `custom_dishes.use_count` is incremented only when an insertion actually occurs.
4. Outbox records are deleted from IndexedDB only after the database confirms the transaction.

---

## 4. Multi-Tab Concurrency & Session Verification

When multiple browser tabs are open simultaneously, synchronization must not produce race conditions or duplicate network calls.

### Web Locks Coordination

Replay processing in `src/offline/flusher.ts` is guarded by the Web Locks API:
```typescript
navigator.locks.request(`yourbody-outbox-${userId}`, async () => {
  await flushNow(userId);
});
```
If the Web Locks API is unavailable in the environment, the flusher falls back to an in-tab promise mutex (`userMutexes`).

### Cross-Tab State Broadcasting

Outbox mutations emit notifications across tabs using a dedicated `BroadcastChannel('yourbody-outbox-<userId>')` alongside a localStorage pending counter (`yourbody_outbox_pending_<userId>`). This guarantees that open tabs display synchronized pending counts in real time.

### Session-Owner Verification

Before executing any outbox replay, `src/offline/flusher.ts` verifies that the active Supabase authentication session (`supabase.auth.getSession()`) precisely matches the `userId` associated with the outbox queue:
```typescript
if (!sessionUser || sessionUser !== userId) {
  // Owner check failed: abort flush to prevent cross-account contamination
  return;
}
```
If the current session is invalid or belongs to another user, flushing aborts immediately.

---

## 5. Error Classification & Recovery

Network and server responses during replay are classified into three operational categories by `src/offline/classify.ts`:

1. **`TRANSIENT`** (Network loss, HTTP 408, 429, 5xx):
   - The operation remains in `pending` state with an incremented attempt count.
   - Exponential backoff with jitter (2 seconds up to 5 minutes) schedules subsequent retries.
   - The flusher automatically wakes and attempts immediate replay upon the browser's `online` event.

2. **`AUTH`** (HTTP 401, token expiry):
   - Triggers an automatic token refresh via `supabase.auth.refreshSession()`.
   - If the refresh token is invalid or expired, sets `authRequired` status to prompt user re-login without dropping queued operations.

3. **`PERMANENT`** (PostgreSQL foreign key violations such as 23503, schema constraints, pre-image conflicts):
   - The operation transitions to `attention` status.
   - Dependent operations that rely on the blocked entity are marked as `blockedBy` to maintain state consistency.
   - The user is notified via `src/components/sync/AttentionBanner.tsx` and can manually retry or discard the operation.

---

## 6. Sign-Out & Shared Device Teardown

Managing shared devices requires balancing user privacy against data durability (`src/context/AuthContext.tsx`):

- **Read Cache Purge**: On sign-out, the user's serialized query cache (`rq` store) is purged immediately, preventing sensitive personal data (workout history, nutrition logs, personal goals) from remaining visible in browser storage.
- **Outbox & ID Mapping Preservation**: The `outbox` and `idmap` stores are preserved in IndexedDB. Unsynced mutations remain safely stored on the device until the original user signs back in to replay them.
- **Sign-Out Warning Modal**: If pending mutations exist when sign-out is initiated, a modal dialog warns the user:
  > *"N unsynced changes stay on this device and sync the next time you sign in as <email>. Sign out?"*

---

## 7. PWA Update Safety Protocol

Service workers downloaded in the background must not trigger unplanned page reloads while users are in the middle of active sessions (`src/pwa/updateSafety.ts`):

### Safety Blocker Hierarchy

`evaluateUpdateSafety` evaluates two categories of blockers before allowing an application reload:

- **Hard Blockers** (Disallow reload immediately):
  - Outbox synchronization currently in-flight (`getSyncingStatus() === true`).
  - Offline AI analysis currently executing (`aiQueue.isAnalyzing === true`).
  - An accessible modal dialog is currently open (`[role="dialog"][aria-modal="true"]`).
  - Registered custom blockers reporting blocking state.

- **Soft Blockers** (Require user acknowledgement before reloading):
  - Active workout session with typed input drafts or uncommitted sets.
  - Pending outbox operations waiting to sync (`pendingCount > 0`).
  - Unsaved forms (e.g. `staged-meal`, `manual-meal-form`).

When a soft blocker is present, the PWA update banner (`src/pwa/UpdateBanner.tsx`) displays an inline notification advising the user to finish their workout or sync changes before applying the update.

---

## 8. Local Nutrition Parser & AI Queue

### Strict Local Nutrition Block Parser (`src/lib/nutrition/localParse.ts`)

For rapid dietary logging without network overhead, the app provides a deterministic local nutrition block parser:
- **Scope**: Parses single, complete nutrition blocks pasted into the meal input.
- **Macro Completeness**: Requires all four foundational macros: Calories/Energy, Protein, Carbohydrates, and Fat (with optional Dietary Fiber).
- **Calorie Consistency Check**: Enforces the chemical calorie equation:
  ```
  |4 * Protein + 4 * Carbohydrates + 9 * Fat - Calories| <= max(60, 25% * Calories)
  ```
  Discrepancies exceeding this tolerance are rejected to avoid corrupted logs.
- **Strict Grammar Rejection**: Automatically rejects prose, conversational multi-item descriptions, ambiguous numbers, or conflicting duplicate lines.
- **Staging UI**: Successfully parsed local items are displayed in `StagedMealCard` with a `"Parsed locally"` badge. When online, an `"Analyze with AI instead"` button allows delegating to Gemini.

### Offline AI Capture Queue (`src/offline/aiQueue.ts`)

When network connectivity is unavailable, natural language text logs and meal photos cannot be processed by the serverless AI endpoint:
- Offline prompts and photos (compressed to <= 4 MB) are staged in the `aiq` IndexedDB store with their exact capture timestamp (`capturedAt`).
- Upon reconnect, the queue processor processes items sequentially under `navigator.locks.request('yourbody-aiq-<userId>')` with a rate limit of <= 12 requests per minute (minimum 5-second spacing).
- HTTP 429 responses are respected by extracting `Retry-After` headers without depleting retry quotas.
- Upon successful analysis, the processed result is saved and the raw photo data is removed from IndexedDB in the same database transaction.
- *Note on Architecture*: AI meal parsing is planned to become online-only; the current offline queue reflects the existing implementation for retaining user capture intent across network interruptions.

---

## 9. Intentionally Unsupported Offline Actions

To prevent irreconcilable conflicts, certain complex administrative and relational operations are guarded and disabled offline:

- **Exercise & Template Authoring**: Creating or editing custom exercises (`src/components/exercises/CreateExerciseSheet.tsx`) and modifying routine templates require live catalog validation and are disabled offline.
- **Coach Cockpit Operations**: Managing athlete rosters, linking coach codes, and modifying athlete targets require online multi-party authorization.
- **Historical Modifications**: Deleting workouts from history, editing/deleting existing logged nutrition entries, and altering custom dishes are disabled offline with inline notices (`"Available when online"`), issuing 0 network calls.
- **Settings Modifications**: Changing PR calculation modes (`src/components/settings/PrModeCard.tsx`) requires an online connection.

---

## 10. Known Platform Limitations

- **WebKit 7-Day Storage Eviction**: iOS Safari can purge client-side IndexedDB databases if the user does not open the web application for 7 consecutive days while the device is under storage pressure.
- **Client Clock Skew**: Offline creation timestamps rely on the device's system clock. Significant device clock inaccuracy may cause logged sets or meals to appear out of order relative to server-recorded entries.
- **Local Storage Pressure**: High volumes of queued photos (up to 4 MB each) stored in `aiq` can elevate local storage usage if a device remains offline for extended periods. Photos are purged immediately upon successful server processing.
