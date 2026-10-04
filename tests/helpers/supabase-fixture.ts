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
      const rpcError = errors[`rpc:${name}`] ?? errors.rpc;
      if (rpcError) return { data: null, error: { message: rpcError } };
      if (name === 'mutate_retailer_cart_line') {
        const packId = String(args.p_pack_id);
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
          : row.pack_id === packId && row.retailer_id === retailerId);
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
