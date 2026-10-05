
function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  if (path in obj) return obj[path];
  const parts = path.split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr == null || typeof curr !== "object") return undefined;
    curr = curr[part];
  }
  return curr;
}

function compareValues(valA: any, valB: any, ascending: boolean = true, nullsFirst?: boolean): number {
  const isNullA = valA === null || valA === undefined;
  const isNullB = valB === null || valB === undefined;
  if (isNullA && isNullB) return 0;
  if (isNullA) {
    const first = nullsFirst !== undefined ? nullsFirst : !ascending;
    return first ? -1 : 1;
  }
  if (isNullB) {
    const first = nullsFirst !== undefined ? nullsFirst : !ascending;
    return first ? 1 : -1;
  }
  let diff = 0;
  if (typeof valA === "number" && typeof valB === "number") {
    diff = valA - valB;
  } else if (typeof valA === "boolean" && typeof valB === "boolean") {
    diff = (valA ? 1 : 0) - (valB ? 1 : 0);
  } else {
    const strA = String(valA);
    const strB = String(valB);
    diff = strA.localeCompare(strB);
  }
  return ascending ? diff : -diff;
}

import { vi } from 'vitest';

export interface RecordedSelect {
  table: string;
  projection: string;
}

export const recordedSelects: RecordedSelect[] = [];

export function getRecordedSelects(): RecordedSelect[] {
  return [...recordedSelects];
}

export function clearRecordedSelects(): void {
  recordedSelects.length = 0;
}

export const recordedTables: string[] = [];

export function getRecordedTables(): string[] {
  return [...recordedTables];
}

export function clearRecordedTables(): void {
  recordedTables.length = 0;
}

export interface RecordedUpsert {
  table: string;
  data: any;
  options?: any;
}

export const recordedUpserts: RecordedUpsert[] = [];

export function getRecordedUpserts(): RecordedUpsert[] {
  return [...recordedUpserts];
}

export function clearRecordedUpserts(): void {
  recordedUpserts.length = 0;
}

export function clearMockHistory(): void {
  recordedSelects.length = 0;
  recordedTables.length = 0;
  recordedUpserts.length = 0;
}

export function assertSelectRecorded(table: string, projection: string): void {
  const match = recordedSelects.find(
    (s) => s.table === table && s.projection.trim() === projection.trim()
  );
  if (!match) {
    const existing = recordedSelects.map((s) => `[${s.table}: "${s.projection}"]`).join(', ');
    throw new Error(
      `Expected select on table "${table}" with projection "${projection}", but recorded selects were: ${existing || 'none'}`
    );
  }
}

export function assertTableQueried(table: string): void {
  if (!recordedTables.includes(table)) {
    throw new Error(
      `Expected table "${table}" to be queried, but recorded tables were: [${recordedTables.join(', ')}]`
    );
  }
}

export interface FilterRecord {
  method: string;
  column?: string;
  value?: any;
  args: any[];
}

export type TableDataResolver =
  | { data?: any; error?: any }
  | any[]
  | any
  | ((builder: SupabaseQueryBuilderMock) => any | Promise<any>);

export interface BuilderOptions {
  table?: string;
  data?: any;
  error?: any;
  resolver?: (builder: SupabaseQueryBuilderMock) => any;
}

export class SupabaseQueryBuilderMock implements PromiseLike<{ data: any; error: any }> {
  public tableName: string;
  public projection: string = '*';
  public filters: FilterRecord[] = [];
  public orderParams: Array<{ column: string; options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string } }> = [];
  public limitValue?: number;
  public limitCalls: { count: number; referencedTable?: string }[] = [];
  public rangeBounds?: { from: number; to: number; options?: { foreignTable?: string } };
  public isSingle = false;
  public isMaybeSingle = false;
  public insertedData?: any;
  public updatedData?: any;
  public upsertedData?: any;
  public isDeleted = false;

  private _resolvedData?: any;
  private _resolvedError?: any;
  private _hasExplicitResolution = false;
  private _resolver?: (builder: SupabaseQueryBuilderMock) => any;
  private _onceQueue: Array<{ data?: any; error?: any }> = [];

  constructor(tableName: string = 'unknown', options?: BuilderOptions) {
    this.tableName = tableName;
    if (tableName && tableName !== 'unknown') {
      recordedTables.push(tableName);
    }
    if (options) {
      if (options.data !== undefined || options.error !== undefined) {
        this._resolvedData = options.data ?? null;
        this._resolvedError = options.error ?? null;
        this._hasExplicitResolution = true;
      }
      if (options.resolver) {
        this._resolver = options.resolver;
      }
    }
  }

  select(columns?: string, _options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' }): this {
    const projection = (columns === undefined || columns === '') ? 'WILDCARD_MUTATION_RETURN' : columns;
    this.projection = projection;
    recordedSelects.push({
      table: this.tableName,
      projection,
    });
    return this;
  }

  eq(...args: unknown[]): this {
    const column = args[0] as string;
    const value = args[1] as any;
    this.filters.push({ method: 'eq', column, value, args: [column, value] });
    return this;
  }

  neq(column: string, value: any): this {
    this.filters.push({ method: 'neq', column, value, args: [column, value] });
    return this;
  }

  or(filters: string, options?: { foreignTable?: string }): this {
    this.filters.push({ method: 'or', args: [filters, options] });
    return this;
  }

  in(column: string, values: any[]): this {
    this.filters.push({ method: 'in', column, value: values, args: [column, values] });
    return this;
  }

  gte(column: string, value: any): this {
    this.filters.push({ method: 'gte', column, value, args: [column, value] });
    return this;
  }

  lte(column: string, value: any): this {
    this.filters.push({ method: 'lte', column, value, args: [column, value] });
    return this;
  }

  gt(column: string, value: any): this {
    this.filters.push({ method: 'gt', column, value, args: [column, value] });
    return this;
  }

  lt(column: string, value: any): this {
    this.filters.push({ method: 'lt', column, value, args: [column, value] });
    return this;
  }

  like(column: string, pattern: string): this {
    this.filters.push({ method: 'like', column, value: pattern, args: [column, pattern] });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ method: 'ilike', column, value: pattern, args: [column, pattern] });
    return this;
  }

  is(column: string, value: any): this {
    this.filters.push({ method: 'is', column, value, args: [column, value] });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string }): this {
    this.orderParams.push({ column, options });
    return this;
  }

  // Mirrors postgrest-js: limit(count, { foreignTable, referencedTable }).
  // A top-level limit and an embedded limit are different query parameters
  // (limit=100 vs sets.limit=200) and do not clobber each other on the wire, so
  // limitValue alone, being last-write-wins, cannot tell them apart. Tests that care
  // about an embedded cap must read limitCalls. limitValue keeps its old behaviour.
  limit(count: number, options?: { foreignTable?: string; referencedTable?: string }): this {
    this.limitValue = count;
    this.limitCalls.push({
      count,
      referencedTable: options?.referencedTable ?? options?.foreignTable,
    });
    return this;
  }

  range(from: number, to: number, options?: { foreignTable?: string }): this {
    this.rangeBounds = { from, to, options };
    return this;
  }

  single(): this {
    this.isSingle = true;
    return this;
  }

  maybeSingle(): this {
    this.isMaybeSingle = true;
    return this;
  }

  insert(values: any, _options?: any): this {
    this.insertedData = values;
    return this;
  }

  update(values: any, _options?: any): this {
    this.updatedData = values;
    return this;
  }

  upsert(values: any, options?: any): this {
    this.upsertedData = values;
    recordedUpserts.push({
      table: this.tableName,
      data: values,
      options,
    });
    if (
      this.insert !== SupabaseQueryBuilderMock.prototype.insert &&
      this.upsert === SupabaseQueryBuilderMock.prototype.upsert
    ) {
      try {
        this.insert(Array.isArray(values) ? values : [values], options);
      } catch {
        // ignore if mock throws or returns non-builder
      }
    }
    return this;
  }

  delete(_options?: any): this {
    this.isDeleted = true;
    return this;
  }

  mockResolvedValue(result: { data?: any; error?: any }): this {
    this._resolvedData = result.data ?? null;
    this._resolvedError = result.error ?? null;
    this._hasExplicitResolution = true;
    return this;
  }

  mockResolvedValueOnce(result: { data?: any; error?: any }): this {
    this._onceQueue.push(result);
    return this;
  }

  resolveWith(data: any, error: any = null): this {
    this._resolvedData = data;
    this._resolvedError = error;
    this._hasExplicitResolution = true;
    return this;
  }

  async resolve(): Promise<{ data: any; error: any }> {
    if (this._onceQueue.length > 0) {
      const next = this._onceQueue.shift()!;
      return this.formatResult(next.data ?? null, next.error ?? null);
    }

    if (this._resolver) {
      const res = await this._resolver(this);
      if (res && typeof res === 'object' && ('data' in res || 'error' in res)) {
        return this.formatResult(res.data ?? null, res.error ?? null);
      }
      return this.formatResult(res, null);
    }

    if (this._resolvedError) {
      return this.formatResult(null, this._resolvedError);
    }

    // Mutation handling fallback
    if (this.insertedData !== undefined) {
      if (Array.isArray(this.insertedData)) {
        const rows = this.insertedData.map((row: any, idx: number) => ({
          id: row.id || `mock-id-${idx + 1}`,
          created_at: new Date().toISOString(),
          ...row,
        }));
        return this.formatResult(rows, null);
      }
      const row = {
        id: this.insertedData?.id || 'mock-id-1',
        created_at: new Date().toISOString(),
        ...this.insertedData,
      };
      return this.formatResult(row, null);
    }

    if (this.updatedData !== undefined) {
      return this.formatResult(this.updatedData, null);
    }

    if (this.upsertedData !== undefined) {
      if (Array.isArray(this.upsertedData)) {
        const rows = this.upsertedData.map((row: any, idx: number) => ({
          id: row.id || `mock-id-${idx + 1}`,
          created_at: new Date().toISOString(),
          ...row,
        }));
        return this.formatResult(rows, null);
      }
      const row = {
        id: this.upsertedData?.id || 'mock-id-1',
        created_at: new Date().toISOString(),
        ...this.upsertedData,
      };
      return this.formatResult([row], null);
    }

    if (this.isDeleted) {
      return this.formatResult(null, null);
    }

    if (this._hasExplicitResolution) {
      return this.formatResult(this._resolvedData, this._resolvedError);
    }

    // Default query returns empty array
    return this.formatResult([], null);
  }

  private formatResult(rawData: any, rawError: any): { data: any; error: any } {
    let data = rawData;
    let error = rawError;

    if (Array.isArray(data) && !error) {
      // 1. Order (PostgREST evaluates ORDER BY before LIMIT/OFFSET)
      const topLevelOrders = this.orderParams.filter((o) => !o.options?.foreignTable);
      if (topLevelOrders.length > 0) {
        data = [...data].sort((a, b) => {
          for (const order of topLevelOrders) {
            const valA = getNestedValue(a, order.column);
            const valB = getNestedValue(b, order.column);
            const cmp = compareValues(valA, valB, order.options?.ascending !== false, order.options?.nullsFirst);
            if (cmp !== 0) return cmp;
          }
          return 0;
        });
      }

      // 2. Range (PostgREST Range header: from-to inclusive)
      if (this.rangeBounds && !this.rangeBounds.options?.foreignTable) {
        const from = Math.max(0, this.rangeBounds.from);
        const to = this.rangeBounds.to;
        if (to < from) {
          data = [];
        } else {
          data = data.slice(from, to + 1);
        }
      }

      // 3. Limit (PostgREST limit query parameter)
      const topLevelLimits = this.limitCalls.filter((c) => !c.referencedTable);
      const topLevelLimit = topLevelLimits.length > 0
        ? topLevelLimits[topLevelLimits.length - 1].count
        : (this.limitCalls.length === 0 ? this.limitValue : undefined);

      if (typeof topLevelLimit === "number" && topLevelLimit >= 0) {
        data = data.slice(0, topLevelLimit);
      }
    }

    if (this.isSingle) {
      if (Array.isArray(data)) {
        if (data.length === 1) {
          data = data[0];
        } else if (data.length === 0) {
          data = null;
          if (!error) {
            error = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
          }
        } else {
          data = null;
          if (!error) {
            error = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
          }
        }
      }
    } else if (this.isMaybeSingle) {
      if (Array.isArray(data)) {
        data = data.length > 0 ? data[0] : null;
      }
    }

    return { data, error };
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<any | TResult> {
    return this.then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<{ data: any; error: any }> {
    return this.resolve().finally(onfinally);
  }
}

export interface MockSupabaseOptions {
  tables?: Record<string, TableDataResolver>;
  auth?: any;
  rpc?: any;
  functions?: any;
}

export function createSupabaseBuilder(
  table: string,
  optionsOrData?: BuilderOptions | TableDataResolver
): SupabaseQueryBuilderMock {
  if (
    optionsOrData &&
    typeof optionsOrData === 'object' &&
    ('resolver' in optionsOrData || 'data' in optionsOrData || 'error' in optionsOrData)
  ) {
    return new SupabaseQueryBuilderMock(table, optionsOrData as BuilderOptions);
  }

  if (typeof optionsOrData === 'function') {
    return new SupabaseQueryBuilderMock(table, { resolver: optionsOrData as any });
  }

  if (optionsOrData !== undefined) {
    return new SupabaseQueryBuilderMock(table, { data: optionsOrData });
  }

  return new SupabaseQueryBuilderMock(table);
}

export function createSupabaseMock(options?: MockSupabaseOptions) {
  const tableData = { ...(options?.tables || {}) };
  const builders = new Map<string, SupabaseQueryBuilderMock[]>();

  const from = vi.fn((table: string) => {
    let builder: SupabaseQueryBuilderMock;
    const config = tableData[table];
    if (config !== undefined) {
      if (typeof config === 'function') {
        builder = new SupabaseQueryBuilderMock(table, { resolver: config as any });
      } else if (config && typeof config === 'object' && ('data' in config || 'error' in config)) {
        builder = new SupabaseQueryBuilderMock(table, {
          data: config.data,
          error: config.error,
        });
      } else {
        builder = new SupabaseQueryBuilderMock(table, { data: config });
      }
    } else {
      builder = new SupabaseQueryBuilderMock(table);
    }

    const list = builders.get(table) || [];
    list.push(builder);
    builders.set(table, list);
    return builder;
  });

  return {
    from,
    rpc: options?.rpc || vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      ...(options?.auth || {}),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
      ...(options?.functions || {}),
    },
    setTableData(table: string, data: any, error: any = null) {
      tableData[table] = { data, error };
    },
    getBuilders(table: string): SupabaseQueryBuilderMock[] {
      return builders.get(table) || [];
    },
    getLastBuilder(table: string): SupabaseQueryBuilderMock | undefined {
      const list = builders.get(table);
      return list && list.length > 0 ? list[list.length - 1] : undefined;
    },
    getRecordedSelects,
    clearRecordedSelects,
    getRecordedTables,
    clearRecordedTables,
    getRecordedUpserts,
    clearRecordedUpserts,
  };
}
