import { useState, useEffect } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import { invalidateExerciseDomain, type InvalidationClient } from './invalidate';
import { normalizeSearch, parseBodyPartTokens } from '../utils/normalizeSearch';
import { isValidUUID } from '../utils/uuid';
import type { Exercise } from '../types/database';

export const EXERCISE_SUMMARY_PROJECTION = 'id, name, body_parts, is_master';
export const EXERCISE_LIBRARY_PROJECTION =
  'id, name, body_parts, is_master, is_archived, user_id, created_at';

export interface VisibleExerciseFilters {
  isArchived?: boolean;
  userId?: string | null;
  applyQuery?: (query: any) => any;
  pageSize?: number;
}

/**
 * Shared paging helper that exhaustively fetches all visible exercises via .range()
 * until a short page (< pageSize) is encountered, eliminating silent catalog truncation.
 */
export async function fetchAllVisibleExercises<T = Exercise>(
  selectOrFilters?: string | VisibleExerciseFilters,
  maybeFilters?: VisibleExerciseFilters
): Promise<T[]> {
  let select = EXERCISE_SUMMARY_PROJECTION;
  let filters: VisibleExerciseFilters = {};
  if (typeof selectOrFilters === 'string') {
    select = selectOrFilters;
    if (maybeFilters) filters = maybeFilters;
  } else if (selectOrFilters && typeof selectOrFilters === 'object') {
    filters = selectOrFilters;
  }

  const { isArchived, applyQuery, pageSize = 200 } = filters;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query: any =
      select === EXERCISE_LIBRARY_PROJECTION
        ? supabase.from('exercises').select(EXERCISE_LIBRARY_PROJECTION)
        : select === EXERCISE_SUMMARY_PROJECTION
        ? supabase.from('exercises').select(EXERCISE_SUMMARY_PROJECTION)
        : (supabase.from('exercises') as any)['select'](select);

    if (isArchived !== undefined) {
      query = query.eq('is_archived', isArchived);
    }

    if ('userId' in filters) {
      if (filters.userId && isValidUUID(filters.userId)) {
        query = query.or(`is_master.eq.true,user_id.eq.${filters.userId}`);
      } else {
        query = query.eq('is_master', true);
      }
    }

    if (applyQuery) {
      query = applyQuery(query);
    }

    const { data, error } = await query
      .order('name')
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export interface CatalogExercise {
  id: string;
  name: string;
  body_parts: string[] | null;
  equipment: string | null;
  is_master: boolean;
  user_id: string | null;
  is_archived: boolean;
  is_hidden: boolean;
  total_count?: number | bigint;
}

export class DuplicateExerciseError extends Error {
  readonly code = 'DUPLICATE_EXERCISE' as const;
  readonly exerciseName?: string;
  readonly equipment?: string | null;
  readonly existingId?: string;

  constructor(
    message = 'An exercise with this name and equipment already exists.',
    exerciseName?: string,
    equipment?: string | null,
    existingId?: string
  ) {
    super(message);
    this.name = 'DuplicateExerciseError';
    this.exerciseName = exerciseName;
    this.equipment = equipment;
    this.existingId = existingId;
  }
}

export interface ExerciseCatalogPage {
  items: CatalogExercise[];
  nextCursor: string | null;
  totalCount: number;
}

export function encodeCatalogCursor(name: string, id: string): string {
  try {
    return btoa(unescape(encodeURIComponent(`${name}::${id}`)));
  } catch {
    return `${name}::${id}`;
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    if (delay <= 0) return;
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return delay <= 0 ? value : debouncedValue;
}

export async function fetchExerciseCatalogPage({
  search,
  scope = 'all',
  equipment,
  includeHidden = false,
  limit = 50,
  cursor = null,
}: {
  search?: string;
  scope?: string;
  equipment?: string | null;
  includeHidden?: boolean;
  limit?: number;
  cursor?: string | null;
}): Promise<ExerciseCatalogPage> {
  const normalizedSearch = search ? normalizeSearch(search) : null;
  const pEquipment = equipment && equipment !== 'all' ? equipment.toLowerCase().trim() : null;
  const pLimit = Math.min(Math.max(limit, 1), 200);

  const { data, error } = await (supabase.rpc as any)('get_exercise_catalog', {
    p_search: normalizedSearch || null,
    p_scope: scope || 'all',
    p_equipment: pEquipment,
    p_include_hidden: includeHidden ?? false,
    p_limit: pLimit,
    p_cursor: cursor || null,
  });

  if (error) throw error;

  const rows = ((data || []) as unknown) as CatalogExercise[];
  const totalCount =
    rows.length > 0 && rows[0].total_count != null ? Number(rows[0].total_count) : 0;

  let nextCursor: string | null = null;
  if (rows.length >= pLimit) {
    const lastRow = rows[rows.length - 1];
    nextCursor = encodeCatalogCursor(lastRow.name, lastRow.id);
  }

  return {
    items: rows,
    nextCursor,
    totalCount,
  };
}

export interface UseExerciseCatalogOptions {
  search?: string;
  scope?: string;
  equipment?: string | null;
  includeHidden?: boolean;
  limit?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export function useExerciseCatalog(options: UseExerciseCatalogOptions = {}) {
  const {
    search = '',
    scope = 'all',
    equipment = null,
    includeHidden = false,
    limit = 50,
    debounceMs = 250,
    enabled = true,
  } = options;

  const debouncedSearch = useDebounce(search.trim(), debounceMs);
  const normalizedEquipment =
    equipment && equipment !== 'all' ? equipment.toLowerCase().trim() : null;

  return useInfiniteQuery({
    queryKey: queryKeys.exerciseCatalog.infinite({
      search: debouncedSearch,
      scope,
      equipment: normalizedEquipment || undefined,
      includeHidden,
      limit,
    }),
    initialPageParam: null as string | null,
    enabled,
    queryFn: ({ pageParam }) =>
      fetchExerciseCatalogPage({
        search: debouncedSearch,
        scope,
        equipment: normalizedEquipment,
        includeHidden,
        limit,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? null,
  });
}

export function flattenCatalogPages(data?: InfiniteData<ExerciseCatalogPage> | null): CatalogExercise[] {
  if (!data?.pages) return [];
  return data.pages.flatMap((page) => page.items);
}

export interface InsertCustomExerciseParams {
  name: string;
  bodyParts?: string[] | string;
  equipment?: string | null;
  targetUserId?: string;
}

/**
 * Single custom-exercise insert path with client duplicate check (L35)
 * and typed DuplicateExerciseError.
 */
export async function insertCustomExercise(
  params: InsertCustomExerciseParams,
  queryClient?: InvalidationClient,
  existingCatalog?: Array<{ name: string; equipment?: string | null }>
): Promise<CatalogExercise> {
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    throw new Error('Exercise name cannot be empty.');
  }

  const normalizedCandidateName = normalizeSearch(trimmedName);
  const candidateEquipment =
    params.equipment && params.equipment !== 'all'
      ? params.equipment.toLowerCase().trim()
      : null;

  // 1. Client-side duplicate check (L35: (normalized name, equipment))
  if (existingCatalog && existingCatalog.length > 0) {
    const isDuplicate = existingCatalog.some((ex) => {
      const existingName = normalizeSearch(ex.name);
      const existingEq = ex.equipment ? ex.equipment.toLowerCase().trim() : null;
      const sameName = existingName === normalizedCandidateName;
      if (!sameName) return false;
      return !candidateEquipment || !existingEq || existingEq === candidateEquipment;
    });

    if (isDuplicate) {
      throw new DuplicateExerciseError(
        `An exercise named "${trimmedName}"${candidateEquipment ? ` (${candidateEquipment})` : ''} already exists in your catalog.`,
        trimmedName,
        candidateEquipment
      );
    }
  }

  // 2. Format body parts
  const bodyPartsArray = Array.isArray(params.bodyParts)
    ? params.bodyParts
    : params.bodyParts
    ? parseBodyPartTokens(params.bodyParts)
    : [];

  // 3. Resolve user_id
  let userId = params.targetUserId;
  if (!userId) {
    const authRes = await supabase.auth.getUser();
    userId = authRes.data?.user?.id;
  }

  // 4. Insert into exercises table (Rule: single explicit bound for check-query-bounds)
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      name: trimmedName,
      body_parts: bodyPartsArray.length > 0 ? bodyPartsArray : null,
      equipment: candidateEquipment,
      user_id: userId || null,
      is_master: false,
    } as any)
    .select()
    .single();

  if (error) {
    if (
      error.code === '23505' ||
      (error as any).status === 409 ||
      error.message === 'duplicate_exercise_name' ||
      error.message?.includes('duplicate') ||
      error.message?.includes('unique')
    ) {
      const existingId = (error as any).details || (error as any).detail;
      throw new DuplicateExerciseError(
        `An exercise named "${trimmedName}" already exists.`,
        trimmedName,
        candidateEquipment,
        typeof existingId === 'string' && existingId.length > 0 ? existingId : undefined
      );
    }
    throw error;
  }

  // 5. Invalidate caches (RP-1, C8)
  if (queryClient) {
    await invalidateExerciseDomain(queryClient, userId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.exerciseCatalog.all });
  }

  return (data as unknown) as CatalogExercise;
}
