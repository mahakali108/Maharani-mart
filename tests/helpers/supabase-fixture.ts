/** Small fluent query double, not an RLS emulator. Tests assert the caller's
 * owner/active filters and returned-data handling; live RLS needs Supabase. */
export interface FixtureQuery {
  table: string;
  select: string;
  filters: { op: string; column: string; value: unknown }[];
  operation: 'select' | 'insert' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  limit?: number;
}
type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null; count: number | null };

export function supabaseFixture(
  initial: Record<string, object[]> = {},
  errors: Record<string, string> = {},
  availability: object[] = []
) {
  const tables = structuredClone(initial) as Record<string, Row[]>;
  const queries: FixtureQuery[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  function from(table: string) {
    const query: FixtureQuery = { table, select: '', filters: [], operation: 'select' };
    const sorts: { column: string; asc: boolean }[] = [];
    function matching(row: Row) {
      return query.filters.every(({ op, column, value }) => {
        // Nested aggregates and OR syntax are recorded for contract assertions.
        if (column.includes('.') || op === 'or') return true;
        if (op === 'eq') return row[column] === value;
        if (op === 'neq') return row[column] !== value;
        if (op === 'in') return (value as unknown[]).includes(row[column]);
        if (op === 'is') return row[column] === value;
        if (op === 'lte') return String(row[column]) <= String(value);
        if (op === 'gte') return String(row[column]) >= String(value);
        return true;
      });
    }
    function run(): Result {
      queries.push(query);
      const error = errors[`${table}:${query.operation}`] ?? errors[table];
      if (error) return { data: null, error: { message: error }, count: null };
      const all = tables[table] ?? [];
      let rows = all.filter(matching);
      if (query.operation === 'insert') {
        const row = { ...query.payload, id: query.payload?.id ?? `inserted-${all.length}` };
        tables[table] = [...all, row];
        rows = [row];
      } else if (query.operation === 'update') rows.forEach((row) => Object.assign(row, query.payload));
      else if (query.operation === 'delete') tables[table] = all.filter((row) => !matching(row));
      rows = [...rows].sort((a, b) => {
        for (const sort of sorts) {
          const compare = String(a[sort.column]).localeCompare(String(b[sort.column]));
          if (compare) return sort.asc ? compare : -compare;
        }
        return 0;
      });
      const count = rows.length;
      return { data: query.limit == null ? rows : rows.slice(0, query.limit), error: null, count };
    }
    const chain = {
      select: (select: string) => { query.select = select; return chain; },
      eq: (column: string, value: unknown) => { query.filters.push({ op: 'eq', column, value }); return chain; },
      neq: (column: string, value: unknown) => { query.filters.push({ op: 'neq', column, value }); return chain; },
      in: (column: string, value: unknown[]) => { query.filters.push({ op: 'in', column, value }); return chain; },
      is: (column: string, value: unknown) => { query.filters.push({ op: 'is', column, value }); return chain; },
      lte: (column: string, value: unknown) => { query.filters.push({ op: 'lte', column, value }); return chain; },
      gte: (column: string, value: unknown) => { query.filters.push({ op: 'gte', column, value }); return chain; },
      or: (value: string) => { query.filters.push({ op: 'or', column: '', value }); return chain; },
      order: (column: string, options?: { ascending?: boolean }) => { sorts.push({ column, asc: options?.ascending !== false }); return chain; },
      limit: (limit: number) => { query.limit = limit; return chain; },
      returns: () => chain,
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      update: (payload: Row) => { query.operation = 'update'; query.payload = payload; return chain; },
      insert: (payload: Row) => { query.operation = 'insert'; query.payload = payload; return chain; },
      delete: () => { query.operation = 'delete'; return chain; },
      then: (resolve: (result: Result) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return chain;
  }
  return {
    from, queries, tables, rpcs,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return { data: errors.rpc ? null : availability, error: errors.rpc ? { message: errors.rpc } : null };
    },
  };
}
