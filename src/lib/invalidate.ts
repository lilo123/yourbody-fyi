import { queryKeys } from './queryKeys';

/**
 * Minimal QueryClient interface required for cache invalidation.
 * Compatible with standard TanStack QueryClient and mock test clients.
 */
export interface InvalidationClient {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<unknown>;
}

/**
 * Invalidates all queries derived from workout and set writes (log, batch log, edit, delete).
 *
 * Union of query keys mapped from existing mutation onSuccess handlers:
 * - 'workout_sets' (src/components/sets/EditSetSheet.tsx:77, 106)
 * - 'history_sessions' (src/components/sets/EditSetSheet.tsx:78, 107)
 * - 'exercise_stats' (src/components/sets/EditSetSheet.tsx:79, 108)
 * - 'session_sets' (src/components/sets/EditSetSheet.tsx:80, 109)
 *
 * When target userId is present, also invalidates user-scoped queries:
 * - ['workout_sets', userId] (src/components/workout/useWorkoutMutations.ts:105, 170, 187; src/components/sets/EditSetSheet.tsx:82, 111)
 * - ['history_sessions', userId] (src/components/sets/EditSetSheet.tsx:83, 112)
 * - ['exercise_stats', userId] (src/components/sets/EditSetSheet.tsx:84, 113)
 *
 * @param queryClient - The TanStack QueryClient instance
 * @param userId - Optional target user/athlete UUID
 */
export async function invalidateWorkoutDerived(
  queryClient: InvalidationClient,
  userId?: string
): Promise<void> {
  const promises: Promise<unknown>[] = [
    // src/components/sets/EditSetSheet.tsx:77, 106
    queryClient.invalidateQueries({ queryKey: queryKeys.workoutSets.all }),
    // src/components/sets/EditSetSheet.tsx:78, 107
    queryClient.invalidateQueries({ queryKey: queryKeys.historySessions.all }),
    // src/components/sets/EditSetSheet.tsx:79, 108
    queryClient.invalidateQueries({ queryKey: queryKeys.exerciseStats.all }),
    // src/components/sets/EditSetSheet.tsx:80, 109
    queryClient.invalidateQueries({ queryKey: queryKeys.sessionSets.all }),
    // Workouts civil date, benchmarks, and stats v2
    queryClient.invalidateQueries({ queryKey: queryKeys.workouts.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.exerciseBenchmarks.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.exerciseStatsV2.all }),
  ];

  if (userId) {
    // src/components/workout/useWorkoutMutations.ts:105, 170, 187; src/components/sets/EditSetSheet.tsx:82, 111
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.workoutSets.byUser(userId) })
    );
    // src/components/sets/EditSetSheet.tsx:83, 112
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.historySessions.byUser(userId) })
    );
    // src/components/sets/EditSetSheet.tsx:84, 113
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.exerciseStats.byUser(userId) })
    );
    // Exercise_stats_v2 scoped by user
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.exerciseStatsV2.byUser(userId) })
    );
  }

  await Promise.all(promises);
}

/**
 * Invalidates all queries in the exercise and template domain after an exercise or template write.
 *
 * Union of query keys mapped from existing exercise/template mutation onSuccess handlers:
 * - 'exercises' (src/components/exercises/EditExerciseModal.tsx:103; src/components/exercises/ExercisesView.tsx:150, 174, 522)
 * - 'routine_templates' (src/components/exercises/EditExerciseModal.tsx:104; src/components/exercises/ExercisesView.tsx:185, 538; src/components/coach/CoachCockpit.tsx:357)
 * - 'workout_sets' (src/components/exercises/EditExerciseModal.tsx:105)
 *
 * When target userId is present, also invalidates user-scoped queries:
 * - ['workout_sets', userId] (src/components/workout/useWorkoutMutations.ts:105, 170, 187; src/components/sets/EditSetSheet.tsx:82, 111)
 * - ['routine_templates', userId] (src/components/exercises/ExercisesView.tsx:88; src/components/workout/RoutinePickerModal.tsx:37)
 *
 * @param queryClient - The TanStack QueryClient instance
 * @param userId - Optional target user/athlete UUID
 */
export async function invalidateExerciseDomain(
  queryClient: InvalidationClient,
  userId?: string
): Promise<void> {
  const promises: Promise<unknown>[] = [
    // src/components/exercises/EditExerciseModal.tsx:103; src/components/exercises/ExercisesView.tsx:150, 174, 522
    queryClient.invalidateQueries({ queryKey: queryKeys.exercises.all }),
    // src/components/exercises/EditExerciseModal.tsx:104; src/components/exercises/ExercisesView.tsx:185, 538; src/components/coach/CoachCockpit.tsx:357
    queryClient.invalidateQueries({ queryKey: queryKeys.routineTemplates.all }),
    // src/components/exercises/EditExerciseModal.tsx:105
    queryClient.invalidateQueries({ queryKey: queryKeys.workoutSets.all }),
    // src/components/exercises/ExerciseListTab.tsx: catalog search and filtering RPC
    queryClient.invalidateQueries({ queryKey: queryKeys.exerciseCatalog.all }),
  ];

  if (userId) {
    // src/components/workout/useWorkoutMutations.ts:105, 170, 187; src/components/sets/EditSetSheet.tsx:82, 111
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.workoutSets.byUser(userId) })
    );
    // src/components/exercises/ExercisesView.tsx:88; src/components/workout/RoutinePickerModal.tsx:37
    promises.push(
      queryClient.invalidateQueries({ queryKey: queryKeys.routineTemplates.byUser(userId) })
    );
  }

  await Promise.all(promises);
}
