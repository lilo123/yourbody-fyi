import { getLocalDateStr } from './ghostSets';

export interface SetDraftInput {
  weight: string;
  reps: string;
}

export interface ActiveWorkoutSession {
  schemaVersion: 1;
  sessionId: string;
  userId: string;
  workoutDate: string; // YYYY-MM-DD
  routineName: string;
  exercises: string[]; // Authoritative ordered exercise names
  targetSetCounts: Record<string, number>; // exerciseName -> count
  targetRepCounts: Record<string, number>; // exerciseName -> reps
  expandedExercises: string[]; // Serialized list of expanded exercise names
  inputDrafts: Record<string, SetDraftInput>; // key: `${exerciseName}_${setIndex}`
  startedAt: string; // ISO 8601
  lastModifiedAt: string; // ISO 8601
  completedAt: string | null;
}

import {
  SESSION_PREFIX,
  POINTER_PREFIX,
  DRAFT_EXERCISES_PREFIX,
  ROUTINE_PREFIX,
  TTL_MS,
  renameExerciseInSessions,
} from './workoutSessionHelpers';

interface QueuedDraft {
  userId: string;
  date: string;
  exName: string;
  setIndex: number;
  draft: SetDraftInput;
}

export class WorkoutSessionStore {
  private pendingDrafts = new Map<string, QueuedDraft>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushPendingWrites());
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            this.flushPendingWrites();
          }
        });
      }
    }
  }

  private isStorageAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private isSessionStorageAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private getSessionKey(userId: string, date: string): string {
    return `${SESSION_PREFIX}${userId}_${date}`;
  }

  private getPointerKey(userId: string): string {
    return `${POINTER_PREFIX}${userId}`;
  }

  private getMirrorExercisesKey(userId: string, date: string): string {
    return `${DRAFT_EXERCISES_PREFIX}${userId}_${date}`;
  }

  private getMirrorRoutineKey(userId: string, date: string): string {
    return `${ROUTINE_PREFIX}${userId}_${date}`;
  }

  // Pure session reader by date (returns session regardless of completion status if <24h)
  getSession(userId: string, date: string): ActiveWorkoutSession | null {
    if (!this.isStorageAvailable() || !userId || !date) return null;
    try {
      const raw = localStorage.getItem(this.getSessionKey(userId, date));
      if (!raw) return null;
      const session: ActiveWorkoutSession = JSON.parse(raw);
      if (!session || session.schemaVersion !== 1) return null;
      const age = Date.now() - new Date(session.lastModifiedAt).getTime();
      if (age >= TTL_MS) return null;
      return session;
    } catch {
      return null;
    }
  }

  // Get active session: if date provided, returns getSession; if omitted, checks pointer
  getActiveSession(userId: string, date?: string): ActiveWorkoutSession | null {
    if (!this.isStorageAvailable() || !userId) return null;
    if (date) {
      return this.getSession(userId, date);
    }
    try {
      const pointerDate = localStorage.getItem(this.getPointerKey(userId));
      if (!pointerDate) return null;
      const session = this.getSession(userId, pointerDate);
      if (session && session.completedAt === null) {
        return session;
      }
      return null;
    } catch {
      return null;
    }
  }

  getOrInitSession(
    userId: string,
    date: string,
    fallback: {
      routineName: string;
      exercises: string[];
      targetSetCounts: Record<string, number>;
      targetRepCounts: Record<string, number>;
    }
  ): ActiveWorkoutSession {
    const existing = this.getSession(userId, date);
    if (existing) {
      return existing;
    }

    const isToday = date === getLocalDateStr(new Date());
    const nowIso = new Date().toISOString();
    const newSession: ActiveWorkoutSession = {
      schemaVersion: 1,
      sessionId: `session_${userId}_${date}_${Date.now()}`,
      userId,
      workoutDate: date,
      routineName: fallback.routineName,
      exercises: [...fallback.exercises],
      targetSetCounts: { ...fallback.targetSetCounts },
      targetRepCounts: { ...fallback.targetRepCounts },
      expandedExercises: fallback.exercises.length > 0 ? [fallback.exercises[0]] : [],
      inputDrafts: {},
      startedAt: nowIso,
      lastModifiedAt: nowIso,
      completedAt: null,
    };

    this.saveSession(newSession, isToday);
    return newSession;
  }

  saveSession(session: ActiveWorkoutSession, setPointer = false): void {
    if (!this.isStorageAvailable()) return;
    session.lastModifiedAt = new Date().toISOString();
    const key = this.getSessionKey(session.userId, session.workoutDate);
    const serialized = JSON.stringify(session);

    try {
      localStorage.setItem(key, serialized);
    } catch (e: unknown) {
      const error = e as { name?: string; code?: number };
      if (error?.name === 'QuotaExceededError' || error?.code === 22) {
        this.pruneExpiredSessions();
        try {
          localStorage.setItem(key, serialized);
        } catch {
          // Graceful fallback
        }
      }
    }

    // Persist pointer for any active open session date (including past dates)
    if (setPointer && session.completedAt === null) {
      localStorage.setItem(this.getPointerKey(session.userId), session.workoutDate);
    }

    // Mirror to sessionStorage for legacy test compatibility
    if (this.isSessionStorageAvailable()) {
      try {
        const mirrorExKey = this.getMirrorExercisesKey(session.userId, session.workoutDate);
        const mirrorRtnKey = this.getMirrorRoutineKey(session.userId, session.workoutDate);
        if (session.exercises.length > 0) {
          sessionStorage.setItem(mirrorExKey, JSON.stringify(session.exercises));
        } else {
          sessionStorage.removeItem(mirrorExKey);
        }
        sessionStorage.setItem(mirrorRtnKey, session.routineName);
      } catch {
        // ignore
      }
    }
  }

  updateRoutine(
    userId: string,
    date: string,
    routineName: string,
    exercises: string[],
    targetSets: Record<string, number>,
    targetReps: Record<string, number>
  ): ActiveWorkoutSession {
    const isToday = date === getLocalDateStr(new Date());
    const session = this.getOrInitSession(userId, date, {
      routineName,
      exercises,
      targetSetCounts: targetSets,
      targetRepCounts: targetReps,
    });

    session.routineName = routineName;
    session.exercises = [...exercises];
    session.targetSetCounts = { ...targetSets };
    session.targetRepCounts = { ...targetReps };
    session.expandedExercises = exercises.length > 0 ? [exercises[0]] : [];
    session.inputDrafts = {};
    session.completedAt = null;

    // Purge pending uncommitted drafts for this session so old drafts do not resurface
    const prefix = `${userId}::${date}::`;
    for (const qKey of Array.from(this.pendingDrafts.keys())) {
      if (qKey.startsWith(prefix)) {
        this.pendingDrafts.delete(qKey);
      }
    }

    this.saveSession(session, isToday);
    return session;
  }

  addExercise(userId: string, date: string, exerciseName: string, targetSets = 3): ActiveWorkoutSession {
    const isToday = date === getLocalDateStr(new Date());
    const session = this.getOrInitSession(userId, date, {
      routineName: 'Free Workout',
      exercises: [],
      targetSetCounts: {},
      targetRepCounts: {},
    });

    if (!session.exercises.includes(exerciseName)) {
      session.exercises.push(exerciseName);
      session.targetSetCounts[exerciseName] = targetSets;
      if (!session.expandedExercises.includes(exerciseName)) {
        session.expandedExercises.push(exerciseName);
      }
      this.saveSession(session, isToday);
    }
    return session;
  }

  removeExercise(userId: string, date: string, exerciseName: string): ActiveWorkoutSession | null {
    const session = this.getSession(userId, date);
    if (!session) return null;

    session.exercises = session.exercises.filter((e) => e !== exerciseName);
    delete session.targetSetCounts[exerciseName];
    delete session.targetRepCounts[exerciseName];
    session.expandedExercises = session.expandedExercises.filter((e) => e !== exerciseName);

    // Remove any draft inputs for this exercise (strictly matching numeric set index suffix)
    Object.keys(session.inputDrafts).forEach((key) => {
      if (key.startsWith(`${exerciseName}_`)) {
        const setSuffix = key.slice(exerciseName.length + 1);
        if (/^\d+$/.test(setSuffix)) {
          delete session.inputDrafts[key];
        }
      }
    });

    // Purge pending uncommitted drafts for this exercise so they do not resurrect
    const prefix = `${userId}::${date}::${exerciseName}_`;
    for (const qKey of Array.from(this.pendingDrafts.keys())) {
      if (qKey.startsWith(prefix)) {
        const suffix = qKey.slice(prefix.length);
        if (/^\d+$/.test(suffix)) {
          this.pendingDrafts.delete(qKey);
        }
      }
    }

    this.saveSession(session, date === getLocalDateStr(new Date()));
    return session;
  }

  reorderExercises(userId: string, date: string, newExercises: string[]): ActiveWorkoutSession | null {
    const session = this.getSession(userId, date);
    if (!session) return null;
    session.exercises = [...newExercises];
    this.saveSession(session, date === getLocalDateStr(new Date()));
    return session;
  }

  updateTargetSets(userId: string, date: string, exerciseName: string, count: number): ActiveWorkoutSession | null {
    const session = this.getSession(userId, date);
    if (!session) return null;
    session.targetSetCounts[exerciseName] = count;
    this.saveSession(session, date === getLocalDateStr(new Date()));
    return session;
  }

  clearDraft(userId: string, date: string, exerciseName: string, setIndex: number): void {
    const draftKey = `${exerciseName}_${setIndex}`;
    const queueKey = `${userId}::${date}::${draftKey}`;
    this.pendingDrafts.delete(queueKey);

    const session = this.getSession(userId, date);
    if (session && session.inputDrafts[draftKey]) {
      delete session.inputDrafts[draftKey];
      this.saveSession(session, false);
    }
  }

  clearWorkout(userId: string, date: string): ActiveWorkoutSession {
    const session = this.getOrInitSession(userId, date, {
      routineName: 'Free Workout',
      exercises: [],
      targetSetCounts: {},
      targetRepCounts: {},
    });

    session.routineName = 'Free Workout';
    session.exercises = [];
    session.targetSetCounts = {};
    session.targetRepCounts = {};
    session.expandedExercises = [];
    session.inputDrafts = {};
    session.completedAt = null;

    // Purge pending uncommitted drafts for this session
    const prefix = `${userId}::${date}::`;
    for (const qKey of Array.from(this.pendingDrafts.keys())) {
      if (qKey.startsWith(prefix)) {
        this.pendingDrafts.delete(qKey);
      }
    }

    this.saveSession(session, date === getLocalDateStr(new Date()));

    if (this.isSessionStorageAvailable()) {
      sessionStorage.removeItem(this.getMirrorExercisesKey(userId, date));
      sessionStorage.setItem(this.getMirrorRoutineKey(userId, date), 'Free Workout');
    }

    return session;
  }

  deleteSession(userId: string, date: string): void {
    if (!this.isStorageAvailable() || !userId || !date) return;
    const key = this.getSessionKey(userId, date);
    localStorage.removeItem(key);

    const pointerKey = this.getPointerKey(userId);
    if (localStorage.getItem(pointerKey) === date) {
      localStorage.removeItem(pointerKey);
    }

    if (this.isSessionStorageAvailable()) {
      sessionStorage.removeItem(this.getMirrorExercisesKey(userId, date));
      sessionStorage.removeItem(this.getMirrorRoutineKey(userId, date));
    }

    const prefix = `${userId}::${date}::`;
    for (const qKey of Array.from(this.pendingDrafts.keys())) {
      if (qKey.startsWith(prefix)) {
        this.pendingDrafts.delete(qKey);
      }
    }
  }

  completeSession(userId: string, date: string): void {
    const session = this.getSession(userId, date);
    if (!session) return;
    session.completedAt = new Date().toISOString();
    this.saveSession(session, false);
    // Clear pointer on completion
    if (this.isStorageAvailable()) {
      localStorage.removeItem(this.getPointerKey(userId));
    }
  }

  reopenSession(userId: string, date: string): void {
    const session = this.getSession(userId, date);
    if (!session) return;
    session.completedAt = null;
    const isToday = date === getLocalDateStr(new Date());
    this.saveSession(session, isToday);
  }

  // Debounced micro-mutator
  setDraftInput(userId: string, date: string, exerciseName: string, setIndex: number, draft: SetDraftInput): void {
    const queueKey = `${userId}::${date}::${exerciseName}_${setIndex}`;
    this.pendingDrafts.set(queueKey, { userId, date, exName: exerciseName, setIndex, draft });

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushPendingWrites();
    }, 300);
  }

  setExpandedExercises(userId: string, date: string, expanded: string[]): void {
    const session = this.getSession(userId, date);
    if (!session) return;
    session.expandedExercises = expanded;
    this.saveSession(session, false);
  }

  flushPendingWrites(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingDrafts.size === 0) return;

    // Group drafts by session key
    const bySession = new Map<string, QueuedDraft[]>();
    this.pendingDrafts.forEach((item) => {
      const sKey = `${item.userId}_${item.date}`;
      if (!bySession.has(sKey)) bySession.set(sKey, []);
      bySession.get(sKey)!.push(item);
    });

    bySession.forEach((drafts) => {
      if (drafts.length === 0) return;
      const { userId, date } = drafts[0];
      const session = this.getSession(userId, date);
      if (session) {
        drafts.forEach((d) => {
          session.inputDrafts[`${d.exName}_${d.setIndex}`] = d.draft;
        });
        this.saveSession(session, false);
      }
    });

    this.pendingDrafts.clear();
  }

  pruneExpiredSessions(): void {
    if (!this.isStorageAvailable()) return;
    const now = Date.now();
    try {
      const keysToCheck: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(SESSION_PREFIX)) {
          keysToCheck.push(key);
        }
      }
      for (const key of keysToCheck) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const session: ActiveWorkoutSession = JSON.parse(raw);
            if (now - new Date(session.lastModifiedAt).getTime() >= TTL_MS) {
              localStorage.removeItem(key);
              const pointerKey = this.getPointerKey(session.userId);
              if (localStorage.getItem(pointerKey) === session.workoutDate) {
                localStorage.removeItem(pointerKey);
              }
            }
          }
        } catch {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Renames an exercise across all active workout sessions for a user,
   * updating exercise lists, target sets/reps records, expanded state, and input drafts.
   */
  /**
   * Renames an exercise across all active workout sessions for a user (shim for).
   */
  renameExercise(userId: string, oldName: string, newName: string): void {
    this.flushPendingWrites();
    renameExerciseInSessions(
      userId,
      oldName,
      newName,
      (s, p) => this.saveSession(s, p),
      this.pendingDrafts
    );
  }

  resetForTesting(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingDrafts.clear();
  }
}

export const workoutSessionStore = new WorkoutSessionStore();
