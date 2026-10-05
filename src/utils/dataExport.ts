import { supabase } from '../lib/supabase';
import type {
  Workout,
  NutritionLog,
  CustomDishDetail,
  RoutineTemplate,
  UserProfile,
} from '../types/database';
import type { NutritionItem } from './itemModel';
import {
  getLocalDateStr,
  normalizeDateStr,
  getDayBounds,
} from './date';

export type ExportDomain = 'workouts' | 'nutrition_logs' | 'custom_dishes' | 'routines' | 'profile';
export type ExportFormat = 'json' | 'csv';
export type DateRangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

export interface DateBounds {
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
}

export interface DataExportOptions {
  targetUserId: string;
  targetUsername: string;
  targetEmail: string | null;
  exportedByRole: 'athlete' | 'coach';
  isSelfExport: boolean;
  domains: ExportDomain[];
  format: ExportFormat;
  preset: DateRangePreset;
  customStartDate?: string;
  customEndDate?: string;
  now?: Date;
}

export interface ExportBundle {
  schema_version: '1.0';
  exported_at: string;
  target_user: {
    id: string;
    username: string;
    email: string | null;
    exported_by_role: 'athlete' | 'coach';
  };
  filters: {
    preset: DateRangePreset;
    start_date: string | null;
    end_date: string | null;
    domains: ExportDomain[];
  };
  data: {
    profile?: Partial<UserProfile> | null;
    workouts?: Workout[];
    nutrition_logs?: NutritionLog[];
    custom_dishes?: CustomDishDetail[];
    routines?: RoutineTemplate[];
  };
}

export interface GeneratedExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

export const EXPORT_PAGE_SIZE = 250;

export const WORKOUT_EXPORT_PROJECTION =
  'id, user_id, name, date, created_at, sets(id, exercise_id, set_index, set_type, weight, reps, rpe, created_at, exercise:exercises(name, body_parts))';

export const NUTRITION_EXPORT_PROJECTION =
  'id, user_id, food_name, meal_type, calories, protein, carbs, fat, fiber, serving_size, serving_unit, logged_at, created_at, notes, has_components, items';

export const CUSTOM_DISH_EXPORT_PROJECTION =
  'id, user_id, name, kind, calories, protein, carbs, fat, fiber, use_count, notes, created_at, items';

export const ROUTINE_EXPORT_PROJECTION =
  'id, user_id, name, is_master, assigned_to, days_of_week, created_at, exercises:template_exercises(id, exercise_id, order_index, target_sets, target_reps, exercise:exercises(name, body_parts))';

export function resolveDateBounds(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  referenceDate?: Date
): DateBounds {
  if (preset === 'all') {
    return { startDate: null, endDate: null };
  }

  if (preset === 'custom') {
    const parseCustomDate = (d?: string): string | null => {
      if (!d) return null;
      const norm = normalizeDateStr(d);
      return /^\d{4}-\d{2}-\d{2}$/.test(norm) ? norm : null;
    };
    let startDate = parseCustomDate(customStart);
    let endDate = parseCustomDate(customEnd);
    if (startDate && endDate && startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }
    return { startDate, endDate };
  }

  const ref = referenceDate && !isNaN(referenceDate.getTime()) ? referenceDate : new Date();
  const endDate = normalizeDateStr(ref) || getLocalDateStr(ref);
  const [year, month, day] = endDate.split('-').map(Number);
  const start = new Date(year, month - 1, day);

  const daysBack = preset === '7d' ? 7 : preset === '90d' ? 90 : 30;
  start.setDate(start.getDate() - daysBack);
  const startDate = getLocalDateStr(start);

  return { startDate, endDate };
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '';
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }

  let str = typeof value === 'string' ? value : String(value);
  // Trim spaces only (preserve leading \t and \r so formula injection is detected)
  const spaceTrimmed = str.replace(/^[ ]+/, '');
  const formulaChars = ['=', '+', '-', '@', '\t', '\r'];

  if (formulaChars.some((ch) => spaceTrimmed.startsWith(ch))) {
    const isPureNumericString = /^[+-]?\d+(\.\d+)?$/.test(spaceTrimmed.trim());
    if (!isPureNumericString) {
      str = `'${str}`;
    }
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function formatItemsSummary(items?: NutritionItem[] | null): string {
  if (!items || items.length === 0) {
    return '';
  }
  return items
    .map((item) => {
      const name = item.name || 'Item';
      const amount = (item as any).amount ?? item.quantity ?? 0;
      const unit = item.unit || '';
      const cal = item.calories ?? 0;
      const protein = item.protein ?? 0;
      const carbs = item.carbs ?? 0;
      const fat = item.fat ?? 0;
      return `${name} (${amount}${unit}: ${cal}kcal, ${protein}P/${carbs}C/${fat}F)`;
    })
    .join('; ');
}

export function serializeToExportJson(bundle: ExportBundle): GeneratedExportFile {
  const rawUsername = bundle.target_user.username || bundle.target_user.id || 'user';
  const safeUsername = rawUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const dateStamp = (bundle.exported_at ? bundle.exported_at.slice(0, 10) : '') || getLocalDateStr();
  const filename = `yourbody-export-${safeUsername}-${dateStamp}.json`;

  return {
    filename,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(bundle, null, 2),
  };
}

export function serializeToExportCsvFiles(bundle: ExportBundle, dateStamp: string): GeneratedExportFile[] {
  const files: GeneratedExportFile[] = [];

  for (const domain of bundle.filters.domains) {
    if (domain === 'workouts') {
      const headers = [
        'workout_id',
        'workout_date',
        'workout_name',
        'set_index',
        'set_type',
        'exercise_name',
        'body_part',
        'weight',
        'reps',
        'rpe',
        'set_created_at',
      ];
      const rows: string[] = [headers.join(',')];
      const workouts = bundle.data.workouts || [];

      for (const w of workouts) {
        const sets = w.sets || [];
        if (sets.length === 0) {
          const cells = [
            w.id,
            w.date,
            w.name ?? '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ];
          rows.push(cells.map(escapeCsvCell).join(','));
        } else {
          for (const s of sets) {
            const cells = [
              w.id,
              w.date,
              w.name ?? '',
              s.set_index ?? '',
              s.set_type ?? '',
              s.exercise?.name ?? s.exercise_name ?? '',
              Array.isArray((s.exercise as any)?.body_parts) ? (s.exercise as any).body_parts.join(', ') : '',
              s.weight ?? '',
              s.reps ?? '',
              s.rpe ?? '',
              s.created_at ?? '',
            ];
            rows.push(cells.map(escapeCsvCell).join(','));
          }
        }
      }

      files.push({
        filename: `yourbody-workouts-${dateStamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: rows.join('\n'),
      });
    } else if (domain === 'nutrition_logs') {
      const headers = [
        'log_id',
        'logged_at',
        'meal_type',
        'food_name',
        'calories',
        'protein_g',
        'carbs_g',
        'fat_g',
        'fiber_g',
        'serving_size',
        'serving_unit',
        'has_components',
        'components_breakdown',
        'notes',
      ];
      const rows: string[] = [headers.join(',')];
      const logs = bundle.data.nutrition_logs || [];

      for (const l of logs) {
        const hasComponents = l.has_components ?? (Boolean(l.items && l.items.length >= 2));
        const cells = [
          l.id,
          l.logged_at,
          l.meal_type ?? '',
          l.food_name,
          l.calories ?? '',
          l.protein ?? '',
          l.carbs ?? '',
          l.fat ?? '',
          l.fiber ?? '',
          l.serving_size ?? '',
          l.serving_unit ?? '',
          hasComponents,
          formatItemsSummary(l.items),
          l.notes ?? '',
        ];
        rows.push(cells.map(escapeCsvCell).join(','));
      }

      files.push({
        filename: `yourbody-nutrition-${dateStamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: rows.join('\n'),
      });
    } else if (domain === 'custom_dishes') {
      const headers = [
        'dish_id',
        'name',
        'kind',
        'use_count',
        'calories',
        'protein_g',
        'carbs_g',
        'fat_g',
        'fiber_g',
        'components_breakdown',
        'notes',
        'created_at',
      ];
      const rows: string[] = [headers.join(',')];
      const dishes = bundle.data.custom_dishes || [];

      for (const d of dishes) {
        const cells = [
          d.id,
          d.name,
          d.kind ?? 'food',
          d.use_count ?? 0,
          d.calories ?? '',
          d.protein ?? '',
          d.carbs ?? '',
          d.fat ?? '',
          d.fiber ?? '',
          formatItemsSummary(d.items),
          d.notes ?? '',
          d.created_at ?? '',
        ];
        rows.push(cells.map(escapeCsvCell).join(','));
      }

      files.push({
        filename: `yourbody-custom-dishes-${dateStamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: rows.join('\n'),
      });
    } else if (domain === 'routines') {
      const headers = [
        'template_id',
        'routine_name',
        'days_of_week',
        'is_master',
        'assigned_to',
        'order_index',
        'exercise_name',
        'body_part',
        'target_sets',
        'target_reps',
      ];
      const rows: string[] = [headers.join(',')];
      const routines = bundle.data.routines || [];

      for (const r of routines) {
        const days = Array.isArray(r.days_of_week) ? r.days_of_week.join(';') : (r.days_of_week ?? '');
        const exercises = r.exercises || [];
        if (exercises.length === 0) {
          const cells = [
            r.id,
            r.name,
            days,
            r.is_master ?? false,
            r.assigned_to ?? '',
            '',
            '',
            '',
            '',
            '',
          ];
          rows.push(cells.map(escapeCsvCell).join(','));
        } else {
          for (const ex of exercises) {
            const cells = [
              r.id,
              r.name,
              days,
              r.is_master ?? false,
              r.assigned_to ?? '',
              ex.order_index ?? '',
              (ex as any).exercise?.name ?? ex.exercise_name ?? '',
              Array.isArray((ex as any).exercise?.body_parts) ? (ex as any).exercise.body_parts.join(', ') : '',
              ex.target_sets ?? '',
              ex.target_reps ?? '',
            ];
            rows.push(cells.map(escapeCsvCell).join(','));
          }
        }
      }

      files.push({
        filename: `yourbody-routines-${dateStamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: rows.join('\n'),
      });
    } else if (domain === 'profile') {
      const headers = [
        'user_id',
        'username',
        'email',
        'role',
        'target_calories',
        'target_protein_g',
        'target_carbs_g',
        'target_fat_g',
        'target_fiber_g',
        'auto_rest_timer',
        'weight_unit',
        'pr_mode',
      ];
      const rows: string[] = [headers.join(',')];
      const p = bundle.data.profile;
      const cells = [
        p?.id ?? bundle.target_user.id,
        p?.username ?? bundle.target_user.username,
        p?.email ?? bundle.target_user.email ?? '',
        p?.role ?? bundle.target_user.exported_by_role,
        p?.target_calories ?? '',
        p?.target_protein ?? '',
        p?.target_carbs ?? '',
        p?.target_fat ?? '',
        p?.target_fiber ?? '',
        p?.auto_rest_timer !== undefined ? p.auto_rest_timer : '',
        p?.weight_unit ?? '',
        p?.pr_mode ?? '',
      ];
      rows.push(cells.map(escapeCsvCell).join(','));

      files.push({
        filename: `yourbody-profile-${dateStamp}.csv`,
        mimeType: 'text/csv;charset=utf-8',
        content: rows.join('\n'),
      });
    }
  }

  return files;
}

export async function fetchProfileForExport(targetUserId: string): Promise<Partial<UserProfile> | null> {
  let query = supabase
    .from('users')
    .select('id, username, email, role, target_calories, target_protein, target_carbs, target_fat, target_fiber, auto_rest_timer, timezone, weight_unit')
    .eq('id', targetUserId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as unknown as Partial<UserProfile>) || null;
}

export async function fetchWorkoutsPage(
  targetUserId: string,
  bounds: DateBounds,
  from: number,
  to: number
): Promise<Workout[]> {
  // payload-gate: detail-fetch — user-initiated full data export
  let query = supabase
    .from('workouts')
    .select(WORKOUT_EXPORT_PROJECTION)
    .eq('user_id', targetUserId)
    .order('date', { ascending: false });

  if (bounds.startDate) {
    query = query.gte('date', bounds.startDate);
  }
  if (bounds.endDate) {
    query = query.lte('date', bounds.endDate);
  }

  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as Workout[]) : [];
}

export async function fetchNutritionLogsPage(
  targetUserId: string,
  bounds: DateBounds,
  from: number,
  to: number
): Promise<NutritionLog[]> {
  const startIso = bounds.startDate ? getDayBounds(bounds.startDate).startOfDay : null;
  const endIso = bounds.endDate ? getDayBounds(bounds.endDate).endOfDay : null;

  // payload-gate: detail-fetch — user-initiated full data export
  let query = supabase
    .from('nutrition_logs')
    .select(NUTRITION_EXPORT_PROJECTION)
    .eq('user_id', targetUserId)
    .order('logged_at', { ascending: false });

  if (startIso) {
    query = query.gte('logged_at', startIso);
  }
  if (endIso) {
    query = query.lte('logged_at', endIso);
  }

  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as NutritionLog[]) : [];
}

export async function fetchCustomDishesPage(
  targetUserId: string,
  from: number,
  to: number
): Promise<CustomDishDetail[]> {
  // payload-gate: detail-fetch — user-initiated full data export
  let query = supabase
    .from('custom_dishes')
    .select(CUSTOM_DISH_EXPORT_PROJECTION)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false });

  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as CustomDishDetail[]) : [];
}

export async function fetchRoutinesPage(
  targetUserId: string,
  from: number,
  to: number
): Promise<RoutineTemplate[]> {
  // payload-gate: detail-fetch — user-initiated full data export
  let query = supabase
    .from('routine_templates')
    .select(ROUTINE_EXPORT_PROJECTION)
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false });

  const { data, error } = await query.range(from, to);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as RoutineTemplate[]) : [];
}

export async function fetchExportBundle(
  options: DataExportOptions,
  onProgress?: (message: string) => void
): Promise<ExportBundle> {
  const bounds = resolveDateBounds(
    options.preset,
    options.customStartDate,
    options.customEndDate,
    options.now
  );

  // Defense-in-depth: linked athletes cannot access owner-only custom_dishes
  const effectiveDomains = options.isSelfExport
    ? [...options.domains]
    : options.domains.filter((d) => d !== 'custom_dishes');

  const bundleData: ExportBundle['data'] = {};

  // 1. Profile domain
  if (effectiveDomains.includes('profile')) {
    onProgress?.('Fetching user profile...');
    bundleData.profile = await fetchProfileForExport(options.targetUserId);
  }

  // 2. Workouts domain
  if (effectiveDomains.includes('workouts')) {
    let from = 0;
    let hasMore = true;
    const workouts: Workout[] = [];

    while (hasMore) {
      const to = from + EXPORT_PAGE_SIZE - 1;
      onProgress?.(`Fetching workouts (${from + 1}–${to + 1})...`);
      const rows = await fetchWorkoutsPage(options.targetUserId, bounds, from, to);
      workouts.push(...rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        hasMore = false;
      } else {
        from += EXPORT_PAGE_SIZE;
      }
    }
    bundleData.workouts = workouts;
  }

  // 3. Nutrition logs domain
  if (effectiveDomains.includes('nutrition_logs')) {
    let from = 0;
    let hasMore = true;
    const nutritionLogs: NutritionLog[] = [];

    while (hasMore) {
      const to = from + EXPORT_PAGE_SIZE - 1;
      onProgress?.(`Fetching nutrition logs (${from + 1}–${to + 1})...`);
      const rows = await fetchNutritionLogsPage(options.targetUserId, bounds, from, to);
      nutritionLogs.push(...rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        hasMore = false;
      } else {
        from += EXPORT_PAGE_SIZE;
      }
    }
    bundleData.nutrition_logs = nutritionLogs;
  }

  // 4. Custom dishes domain
  if (effectiveDomains.includes('custom_dishes')) {
    let from = 0;
    let hasMore = true;
    const customDishes: CustomDishDetail[] = [];

    while (hasMore) {
      const to = from + EXPORT_PAGE_SIZE - 1;
      onProgress?.(`Fetching custom dishes (${from + 1}–${to + 1})...`);
      const rows = await fetchCustomDishesPage(options.targetUserId, from, to);
      customDishes.push(...rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        hasMore = false;
      } else {
        from += EXPORT_PAGE_SIZE;
      }
    }
    bundleData.custom_dishes = customDishes;
  }

  // 5. Routines domain
  if (effectiveDomains.includes('routines')) {
    let from = 0;
    let hasMore = true;
    const routines: RoutineTemplate[] = [];

    while (hasMore) {
      const to = from + EXPORT_PAGE_SIZE - 1;
      onProgress?.(`Fetching routine templates (${from + 1}–${to + 1})...`);
      const rows = await fetchRoutinesPage(options.targetUserId, from, to);
      routines.push(...rows);
      if (rows.length < EXPORT_PAGE_SIZE) {
        hasMore = false;
      } else {
        from += EXPORT_PAGE_SIZE;
      }
    }
    bundleData.routines = routines;
  }

  return {
    schema_version: '1.0',
    exported_at: (options.now || new Date()).toISOString(),
    target_user: {
      id: options.targetUserId,
      username: options.targetUsername,
      email: options.targetEmail,
      exported_by_role: options.exportedByRole,
    },
    filters: {
      preset: options.preset,
      start_date: bounds.startDate,
      end_date: bounds.endDate,
      domains: effectiveDomains,
    },
    data: bundleData,
  };
}

export function downloadExportFiles(files: GeneratedExportFile[]): void {
  if (typeof document === 'undefined') return;

  for (const file of files) {
    const blob = new Blob([file.content], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
  }
}

export async function executeDataExport(
  options: DataExportOptions,
  onProgress?: (message: string) => void
): Promise<GeneratedExportFile[]> {
  const bundle = await fetchExportBundle(options, onProgress);
  if (options.format === 'json') {
    return [serializeToExportJson(bundle)];
  }
  const dateStamp = (bundle.exported_at ? bundle.exported_at.slice(0, 10) : '') || getLocalDateStr();
  return serializeToExportCsvFiles(bundle, dateStamp);
}
