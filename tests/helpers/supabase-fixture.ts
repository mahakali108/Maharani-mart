/** Small fluent query double, not an RLS emulator. Tests assert the caller's
 * owner/active filters and returned-data handling; live RLS needs Supabase. */
export interface FixtureQuery {
  table: string;
  select: string;
  filters: { op: string; column: string; value: unknown }[];
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: Record<string, unknown>;
  conflictColumn?: string;
  limit?: number;
}
type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null; count: number | null };

/** Split an `or=(a,b,and(c,d))` expression on top-level commas. */
function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of expression) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function unquoteValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function matchClause(row: Row, clause: string): boolean {
  const match = /^([\w.]+)\.(ilike|eq|in|gt|lt|lte|gte|is)\.(.*)$/.exec(clause.trim());
  if (!match) return true;
  const [, column, op, rawValue] = match;
  // A dotted column is a nested relation this double does not model.
  if (column!.includes('.')) return true;
  const cell = row[column!];
  const value = unquoteValue(rawValue ?? '');
  if (op === 'ilike') return String(cell ?? '').toLowerCase().includes(value.replace(/%/g, '').toLowerCase());
  if (op === 'in') return value.trim().replace(/^\(|\)$/g, '').split(',').map(unquoteValue).includes(String(cell));
  if (op === 'eq') return String(cell) === value;
  if (op === 'gt') return String(cell ?? '') > value;
  if (op === 'lt') return String(cell ?? '') < value;
  if (op === 'lte') return String(cell ?? '') <= value;
  if (op === 'gte') return String(cell ?? '') >= value;
  if (op === 'is') return value === 'null' ? cell === null || cell === undefined : String(cell) === value;
  return true;
}

/**
 * PostgREST `or=(a,b,and(c,d))` is `a OR b OR (c AND d)`: commas at the top
 * level are OR, a nested `and(...)` group is AND. Keyset continuations are
 * expressed exactly this way, so the double has to honour it or a pagination
 * test would silently re-serve the first batch.
 */
function matchOrExpression(row: Row, expression: string): boolean {
  // `or()` receives the expression without the `or=(...)` wrapper. Only that
  // prefix is stripped: blanket-stripping a trailing `)` would unbalance the
  // LAST `and(...)` group and make it match every row (which would silently
  // turn a keyset continuation back into "return the first batch again").
  const trimmed = expression.trim().replace(/^or=/, '');
  return splitTopLevel(trimmed).some((part) => {
    const clause = part.trim();
    if (clause.startsWith('and(') && clause.endsWith(')')) {
      return splitTopLevel(clause.slice(4, -1)).every((inner) => matchClause(row, inner));
    }
    return matchClause(row, clause);
  });
}

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
        // Nested (aggregate/relation) columns are recorded for contract
        // assertions but not modelled; OR expressions are matched properly
        // because keyset continuations depend on them.
        if (op === 'or') return matchOrExpression(row, String(value));
        if (column.includes('.')) return true;
        if (op === 'eq') return row[column] === value;
        if (op === 'neq') return row[column] !== value;
        if (op === 'in') return (value as unknown[]).includes(row[column]);
        if (op === 'is') return value === null ? row[column] === null || row[column] === undefined : row[column] === value;
        if (op === 'ilike') {
          // Case-insensitive contains; `%`/`_` are the only wildcards the
          // mobile routes use, and `_` never appears in a sanitized term.
          const needle = String(value).replace(/[%_]/g, '').toLowerCase();
          return String(row[column] ?? '').toLowerCase().includes(needle);
        }
        if (op === 'lte') return String(row[column]) <= String(value);
        if (op === 'gte') return String(row[column]) >= String(value);
        if (op === 'gt') return String(row[column] ?? '') > String(value);
        if (op === 'lt') return String(row[column] ?? '') < String(value);
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
      } else if (query.operation === 'upsert') {
        const existing = query.conflictColumn
          ? all.find((row) => row[query.conflictColumn!] === query.payload?.[query.conflictColumn!])
          : undefined;
        if (existing) { Object.assign(existing, query.payload); rows = [existing]; }
        else {
          const row = { ...query.payload, id: query.payload?.id ?? `inserted-${all.length}` };
          tables[table] = [...all, row];
          rows = [row];
        }
      } else if (query.operation === 'update') rows.forEach((row) => Object.assign(row, query.payload));
      else if (query.operation === 'delete') tables[table] = all.filter((row) => !matching(row));
      rows = [...rows].sort((a, b) => {
        for (const sort of sorts) {
          const left = a[sort.column];
          const right = b[sort.column];
          const compare = typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right));
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
      ilike: (column: string, value: unknown) => { query.filters.push({ op: 'ilike', column, value }); return chain; },
      neq: (column: string, value: unknown) => { query.filters.push({ op: 'neq', column, value }); return chain; },
      in: (column: string, value: unknown[]) => { query.filters.push({ op: 'in', column, value }); return chain; },
      is: (column: string, value: unknown) => { query.filters.push({ op: 'is', column, value }); return chain; },
      lte: (column: string, value: unknown) => { query.filters.push({ op: 'lte', column, value }); return chain; },
      gte: (column: string, value: unknown) => { query.filters.push({ op: 'gte', column, value }); return chain; },
      gt: (column: string, value: unknown) => { query.filters.push({ op: 'gt', column, value }); return chain; },
      lt: (column: string, value: unknown) => { query.filters.push({ op: 'lt', column, value }); return chain; },
      or: (value: string) => { query.filters.push({ op: 'or', column: '', value }); return chain; },
      order: (column: string, options?: { ascending?: boolean }) => { sorts.push({ column, asc: options?.ascending !== false }); return chain; },
      limit: (limit: number) => { query.limit = limit; return chain; },
      range: (from: number, to: number) => { query.limit = Math.max(0, to - from + 1); return chain; },
      returns: () => chain,
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      update: (payload: Row) => { query.operation = 'update'; query.payload = payload; return chain; },
      insert: (payload: Row) => { query.operation = 'insert'; query.payload = payload; return chain; },
      upsert: (payload: Row, options?: { onConflict?: string }) => { query.operation = 'upsert'; query.payload = payload; query.conflictColumn = options?.onConflict; return chain; },
      delete: () => { query.operation = 'delete'; return chain; },
      then: (resolve: (result: Result) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return chain;
  }
  return {
    from, queries, tables, rpcs,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      const rpcError = errors[`rpc:${name}`] ?? errors.rpc;
      if (rpcError) return { data: null, error: { message: rpcError } };
      if (name === 'mutate_retailer_cart_line' || name === 'mutate_retailer_cart_line_ex') {
        const packId = String(args.p_pack_id);
        const offerId = args.p_seller_offer_id == null ? null : String(args.p_seller_offer_id);
        const lineId = args.p_cart_item_id == null ? null : String(args.p_cart_item_id);
        const expected = Number(args.p_expected_quantity);
        const quantity = Number(args.p_quantity);
        const cartRead = [...queries].reverse().find((query) =>
          query.table === 'cart_items' && query.operation === 'select'
        );
        const ownerFilter = cartRead?.filters.find((filter) => filter.column === 'retailer_id');
        const retailerId = ownerFilter?.value;
        const rows = tables.cart_items ?? [];
        const existing = rows.find((row) => lineId
          ? row.id === lineId && row.retailer_id === retailerId
          : row.pack_id === packId && row.retailer_id === retailerId && (row.seller_offer_id ?? null) === offerId);
        if ((existing?.quantity ?? 0) !== expected) {
          return { data: null, error: { message: 'CART_CHANGED: cart quantity no longer matches.' } };
        }
        if (lineId && !existing) {
          return { data: null, error: { message: 'CART_CHANGED: cart line no longer exists.' } };
        }
        if (existing) existing.quantity = quantity;
        else {
          const pack = (tables.product_packs ?? []).find((row) => row.id === packId);
          rows.push({
            id: `inserted-cart-${rows.length}`,
            retailer_id: retailerId,
            product_id: pack?.product_id,
            pack_id: packId,
            ...(offerId ? { seller_offer_id: offerId, source_type: 'seller' } : {}),
            quantity,
          });
          tables.cart_items = rows;
        }
        return { data: quantity, error: null };
      }
      return { data: availability, error: null };
    },
  };
}
