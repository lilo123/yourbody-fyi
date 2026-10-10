import type { PrMode } from '../lib/prComparator';
import type { WeightUnit } from "../utils/weight";
import type { NutritionItem } from '../utils/itemModel';

export type UserRole = 'coach' | 'athlete';

export interface UserProfile {
  id: string;
  email: string | null;
  username: string | null;
  role: UserRole;
  target_calories: number;
  target_protein: number;
  target_carbs: number;
  target_fat: number;
  target_fiber?: number;
  auto_rest_timer?: boolean;
  timezone?: string | null;
  is_coach_mode?: boolean;
  coach_code?: string | null;
  coach_tier?: 'free' | 'pro' | 'enterprise';
  max_athletes?: number;
  weight_unit?: WeightUnit;
  pr_mode?: PrMode;
  trial_ends_at?: string | null;
  created_at?: string;
  terms_version?: string | null;
  terms_accepted_at?: string | null;
}

export interface AiUsage {
  user_id: string;
  period_kind: 'day' | 'month';
  period_start: string;
  count: number;
  updated_at: string;
}

export interface CoachAthleteLink {
  id: string;
  coach_id: string;
  athlete_id: string;
  status: 'active' | 'disconnected';
  linked_at: string;
  disconnected_at?: string | null;
  coach?: UserProfile;
  athlete?: UserProfile;
}

export interface Exercise {
  id: string;
  name: string;
  body_parts?: string[] | null;
  equipment?: string | null;
  user_id?: string | null;
  is_master?: boolean;
  is_archived?: boolean;
  created_at?: string;
  [key: string]: any;
}

export type SetType = 'warmup' | 'working' | 'drop';

export interface WorkoutSet {
  id?: string;
  workout_id?: string;
  exercise_id: string;
  exercise_name?: string;
  exercise?: {
    id?: string;
    name: string;
    body_parts?: string[] | null;
  } | null;
  workouts?: {
    date?: string;
    name?: string | null;
  } | null;
  workout_date?: string;
  workout_name?: string;
  set_index: number;
  set_type: SetType;
  weight: number;
  reps: number;
  rpe?: number | null;
  client_id?: string;
  created_at?: string;
}

export interface Workout {
  id: string;
  user_id: string;
  name: string | null;
  date: string;
  created_at?: string;
  sets?: WorkoutSet[];
}

export interface NutritionLog {
  id: string;
  user_id: string;
  food_name: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  meal_type?: string | null;
  serving_size?: number | null;
  serving_unit?: string | null;
  healthConnectRecordId?: string | null;
  logged_at: string;
  logged_date?: string | null;
  created_at?: string;
  /**
   * Level-2 breakdown. NULL (not `[]`) when the log has no meaningful
   * hierarchy — a one-component meal is not a hierarchy. When present, the
   * five parent macros above are Σ(items) and the DB enforces it.
   */
  items?: NutritionItem[] | null;
  /**
   * Maintained automatically by DB as a stored generated column.
   * True if items has >= 2 components (level 1 / expandable).
   */
  has_components?: boolean | null;
  /**
   * Optional user notes for this logged meal (snapshot copy at log time, max 500 characters).
   * Optional because current SELECT projections do not request it yet;
   * tightened in the next phase when query projections include it.
   */
  notes?: string | null;
}

export type CustomDishKind = 'food' | 'recipe';

export interface CustomDishRow {
  id: string;
  user_id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber?: number | null;
  created_at?: string;
  /**
   * User-declared dish classification: 'food' (atomic food) or 'recipe' (composed meal).
   */
  kind: CustomDishKind;
  /**
   * Total times this custom dish has been logged (>= 0).
   */
  use_count: number;
  /**
   * Optional user notes or preparation instructions for the custom dish (max 500 characters).
   * Optional because current SELECT projections do not request it yet;
   * tightened in the next phase when query projections include it.
   */
  notes?: string | null;
}

export type CustomDish = CustomDishRow;

export interface CustomDishDetail extends CustomDishRow {
  /** @deprecated Legacy free-text breakdown. Read for backfill only; never write it. */
  ingredients?: string | null;
  /** See {@link NutritionLog.items}. */
  items?: NutritionItem[] | null;
}


export interface RoutineTemplate {
  id: string;
  user_id: string;
  name: string;
  is_master: boolean;
  assigned_to: string | null;
  days_of_week?: string[] | null;
  created_at?: string;
  exercises?: TemplateExercise[];
}

export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  exercise?: { name: string } | null;
  exercise_name?: string;
  order_index: number;
  target_sets: number;
  target_reps: number | null;
  created_at?: string;
}

export interface GhostSetValues {
  weight: number | '';
  reps: number | '';
  hintText: string;
  isFromPrevious: boolean;
}

export interface ExerciseBenchmarks {
  lastSession: {
    date: string;
    summaryText: string;
    sets: WorkoutSet[];
  } | null;
  pr: {
    weight: number;
    reps: number;
    date: string;
  } | null;
}
