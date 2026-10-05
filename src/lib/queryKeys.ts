/**
 * Canonical React Query Key Registry (RP-1)
 *
 * Single source of truth for all React Query cache keys across Workout, History,
 * Library, Coach, Nutrition, and Settings domains.
 *
 * Guarantees:
 * 1. Factory functions return arrays byte-equal to existing call site literals.
 * 2. Planned query keys for upcoming redesign phases (P1-P8) are pre-registered.
 * 3. Root keys are strictly partitioned to prevent cache collision or silent eviction.
 */

export const QUERY_KEY_ROOTS = [
  // Existing domains in src/ today
  'athlete_profile',
  'coach_templates',
  'coach_athletes',
  'coach_athlete_timeline_workouts',
  'coach_athlete_timeline_nutrition',
  'coach_active_athletes_count',
  'coach_athlete_links_for_export',
  'my_coach_link',
  'exercises',
  'routine_templates',
  'routine_template_detail',
  'workout_sets',
  'workouts',
  'history_sessions',
  'session_sets',
  'exercise_stats',
  'custom_dishes',
  'nutrition_logs',

  // planned: P4 (Exercise catalog RPC & picker)
  'exercise_catalog',
  // planned: P4 (Routine catalog RPC)
  'routine_catalog',
  // planned: P2 (Exercise PR + Last benchmarks)
  'exercise_benchmarks',
  // planned: P2 (History exercise stats v2)
  'exercise_stats_v2',
  // planned: P5a (History sessions v2 keyset pagination)
  'history_sessions_v2',
  // planned: P5a (History exercise sheet sets list)
  'exercise_history',
  // planned: P6 (User weight unit preference lb/kg)
  'user_weight_unit',
  // planned: P4 (Hidden default exercises)
  'exercise_hides',
] as const;

export type QueryKeyRoot = (typeof QUERY_KEY_ROOTS)[number];

export const queryKeys = {
  // =========================================================================
  // Coach Domain
  // =========================================================================
  athleteProfile: {
    all: ['athlete_profile'] as const,
    byId: (athleteId: string | null | undefined) => ['athlete_profile', athleteId] as const,
  },

  coachTemplates: {
    all: ['coach_templates'] as const,
  },

  coachAthletes: {
    all: ['coach_athletes'] as const,
  },

  coachAthleteTimelineWorkouts: {
    all: ['coach_athlete_timeline_workouts'] as const,
    byAthlete: (
      selectedAthleteId: string | null | undefined,
      daysRange?: number,
      athleteTimeZone?: string
    ) => ['coach_athlete_timeline_workouts', selectedAthleteId, daysRange, athleteTimeZone] as const,
  },

  coachAthleteTimelineNutrition: {
    all: ['coach_athlete_timeline_nutrition'] as const,
    byAthlete: (
      selectedAthleteId: string | null | undefined,
      daysRange?: number,
      athleteTimeZone?: string
    ) => ['coach_athlete_timeline_nutrition', selectedAthleteId, daysRange, athleteTimeZone] as const,
  },

  coachActiveAthletesCount: {
    all: ['coach_active_athletes_count'] as const,
    byProfile: (profileId: string | null | undefined) =>
      ['coach_active_athletes_count', profileId] as const,
  },

  coachAthleteLinksForExport: {
    all: ['coach_athlete_links_for_export'] as const,
    byProfile: (profileId: string | null | undefined) =>
      ['coach_athlete_links_for_export', profileId] as const,
  },

  myCoachLink: {
    all: ['my_coach_link'] as const,
    byProfile: (profileId: string | null | undefined) => ['my_coach_link', profileId] as const,
  },

  // =========================================================================
  // Exercise Domain
  // =========================================================================
  exercises: {
    all: ['exercises'] as const,
    coach: () => ['exercises', 'coach'] as const,
    library: (userId: string | null | undefined) => ['exercises', 'library', userId] as const,
    workout: () => ['exercises', 'workout'] as const,
  },

  // planned: P4 (Exercise catalog search and filtering RPC)
  exerciseCatalog: {
    all: ['exercise_catalog'] as const,
    list: (params?: {
      search?: string;
      scope?: string;
      equipment?: string;
      includeHidden?: boolean;
      limit?: number;
      cursor?: string;
    }) => ['exercise_catalog', params] as const,
    infinite: (params?: {
      search?: string;
      scope?: string;
      equipment?: string;
      includeHidden?: boolean;
      limit?: number;
    }) => ['exercise_catalog', 'infinite', params] as const,
  },

  // planned: P4 (Hidden default exercises per user/coach)
  exerciseHides: {
    all: ['exercise_hides'] as const,
    byUser: (userId: string | null | undefined) => ['exercise_hides', userId] as const,
  },

  // =========================================================================
  // Routine & Template Domain
  // =========================================================================
  routineTemplates: {
    all: ['routine_templates'] as const,
    byUser: (userId: string | null | undefined) => ['routine_templates', userId] as const,
    coach: (userId: string | null | undefined) => ['routine_templates', userId, 'coach'] as const,
    exercises: (userId: string | null | undefined) =>
      ['routine_templates', userId, 'exercises'] as const,
    picker: (userId: string | null | undefined) =>
      ['routine_templates', userId, 'picker'] as const,
    workout: (userId: string | null | undefined) =>
      ['routine_templates', userId, 'workout'] as const,
  },

  routineTemplateDetail: {
    all: ['routine_template_detail'] as const,
    byId: (resolvedTemplateId: string | null | undefined) =>
      ['routine_template_detail', resolvedTemplateId] as const,
  },

  // planned: P4 (Routine catalog RPC)
  routineCatalog: {
    all: ['routine_catalog'] as const,
    list: (params?: { search?: string; scope?: string; limit?: number; cursor?: string }) =>
      ['routine_catalog', params] as const,
  },

  // =========================================================================
  // Workout & Set Domain
  // =========================================================================
  workoutSets: {
    all: ['workout_sets'] as const,
    byUser: (userId: string | null | undefined) => ['workout_sets', userId] as const,
    byDate: (userId: string | null | undefined, workoutDate: string) =>
      ['workout_sets', userId, workoutDate] as const,
    recent90d: (userId: string | null | undefined) => ['workout_sets', userId, '90d'] as const,
    allForUser: (userId: string | null | undefined) => ['workout_sets', userId, 'all'] as const,
    historyV2: (
      userId: string | null | undefined,
      range: string,
      since?: string | null
    ) => ['workout_sets', userId, 'history_v2', range, since ?? null] as const,
  },

  // planned: P2 (Workouts date key / civil date)
  workouts: {
    all: ['workouts'] as const,
    byDate: (userId: string | null | undefined, workoutDate: string) =>
      ['workouts', userId, workoutDate] as const,
  },

  // planned: P2 (PR + Last benchmarks RPC get_exercise_benchmarks)
  exerciseBenchmarks: {
    all: ['exercise_benchmarks'] as const,
    byUserAndDate: (
      userId: string | null | undefined,
      date: string,
      exerciseIds?: string[]
    ) => ['exercise_benchmarks', userId, date, exerciseIds] as const,
  },

  // =========================================================================
  // History Domain
  // =========================================================================
  historySessions: {
    all: ['history_sessions'] as const,
    byUser: (userId: string | null | undefined) => ['history_sessions', userId] as const,
  },

  // planned: P5a (History sessions v2 keyset pagination get_history_sessions)
  historySessionsV2: {
    all: ['history_sessions_v2'] as const,
    infinite: (userId: string | null | undefined, since?: string) =>
      ['history_sessions_v2', userId, since] as const,
  },

  sessionSets: {
    all: ['session_sets'] as const,
    bySession: (sessionId: string | null | undefined) => ['session_sets', sessionId] as const,
  },

  exerciseStats: {
    all: ['exercise_stats'] as const,
    byUser: (userId: string | null | undefined) => ['exercise_stats', userId] as const,
  },

  // planned: P2 (History get_exercise_stats v2)
  exerciseStatsV2: {
    all: ['exercise_stats_v2'] as const,
    byUser: (userId: string | null | undefined) => ['exercise_stats_v2', userId] as const,
  },

  // planned: P5a (History get_exercise_history RPC)
  exerciseHistory: {
    all: ['exercise_history'] as const,
    byExercise: (
      userId: string | null | undefined,
      exerciseId: string,
      params?: { since?: string; before?: string; limit?: number }
    ) => ['exercise_history', userId, exerciseId, params] as const,
  },

  // =========================================================================
  // Nutrition Domain
  // =========================================================================
  customDishes: {
    all: ['custom_dishes'] as const,
    byUser: (userId: string | null | undefined) => ['custom_dishes', userId] as const,
  },

  nutritionLogs: {
    all: ['nutrition_logs'] as const,
    byUser: (userId: string | null | undefined) => ['nutrition_logs', userId] as const,
    byDate: (
      targetUserId: string | null | undefined,
      selectedDate?: string | null,
      timeZone?: string | null
    ) =>
      [targetUserId, selectedDate, timeZone].some(Boolean)
        ? (['nutrition_logs', targetUserId, selectedDate, timeZone].filter(Boolean) as string[])
        : (['nutrition_logs'] as const),
  },

  // =========================================================================
  // Settings Domain
  // =========================================================================
  // planned: P6 (User canonical weight unit setting lb/kg)
  userWeightUnit: {
    all: ['user_weight_unit'] as const,
    byUser: (userId: string | null | undefined) => ['user_weight_unit', userId] as const,
  },
} as const;
