import { describe, expect, it, vi } from 'vitest';

/**
 * 🪙 COIN SPENDING + REFUNDS through the real modules, against a small Supabase
 * double. These pin the guarantees the checkout depends on:
 *
 *   - the amount is recomputed from the live balance (a client number is
 *     impossible: no function accepts one),
 *   - a concurrent spend that shrinks the balance mid-checkout is absorbed by
 *     recomputation, not by overdrawing,
 *   - a zero balance never blocks the order — it just pays 0 coins,
 *   - a failure to write the ledger FAILS the order instead of silently
 *     skipping the deduction,
 *   - refunds are linked to the original debit and cannot run twice.
 */

interface LedgerRow {
  id: string;
  retailer_id: string;
  transaction_type: string;
  amount_paise: number;
  direction: string;
  reference_type: string | null;
  reference_id: string | null;
  description: string;
  reason: string | null;
  created_by: string | null;
  notes: string | null;
  idempotency_key: string | null;
  is_reversed: boolean;
  reversed_by: string | null;
  reversal_of: string | null;
  metadata: Record<string, unknown> | null;
}

interface FakeDb {
  /** Funded coins (the wallet "limit"). */
  limitPaise: number;
  /** Coins still available; outstanding = limit − balance. */
  balancePaise: number;
  ledger: LedgerRow[];
  rpcErrors: string[];
  insertError?: { message: string; code?: string };
  /** Simulate a database that has not run migration 0053 yet. */
  missingRefundRpc?: boolean;
  rpcCalls: { name: string; args: Record<string, unknown> }[];
}

function fakeSupabase(db: FakeDb) {
  let sequence = 0;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ name, args });
      // The authoritative wallet position the coin balance is derived from.
      if (name === 'get_retailer_credit_limit_paise') return { data: db.limitPaise, error: null };
      if (name === 'get_retailer_outstanding_paise') return { data: db.limitPaise - db.balancePaise, error: null };
      // 0053: the atomic, RLS-safe refund path used by every cancel/return.
      if (name === 'refund_order_coins') {
        if (db.missingRefundRpc) {
          return {
            data: null,
            error: { message: 'function public.refund_order_coins(uuid, text, uuid) does not exist' },
          };
        }
        const forcedRefundError = db.rpcErrors.shift();
        if (forcedRefundError) return { data: null, error: { message: forcedRefundError } };
        const orderId = String(args.p_order_id);
        const original = db.ledger.find(
          (row) => row.reference_id === orderId && row.transaction_type === 'ORDER_DEBIT'
        );
        if (!original || original.is_reversed) return { data: 0, error: null };
        if (db.insertError) return { data: null, error: db.insertError };
        const key = `reversal:${original.id}`;
        if (db.ledger.some((row) => row.idempotency_key === key)) return { data: 0, error: null };
        sequence += 1;
        db.ledger.push({
          id: `ledger-${sequence}`,
          retailer_id: original.retailer_id,
          transaction_type: 'ORDER_REVERSAL',
          amount_paise: original.amount_paise,
          direction: 'credit',
          reference_type: 'order',
          reference_id: orderId,
          description: `Reversal of order ${orderId}`,
          reason: String(args.p_reason),
          created_by: (args.p_created_by as string | null) ?? null,
          notes: `Reverses ORDER_DEBIT ${original.id}`,
          idempotency_key: key,
          is_reversed: false,
          reversed_by: null,
          reversal_of: original.id,
          metadata: { reversal_of: original.id, order_id: orderId },
        });
        db.balancePaise += original.amount_paise;
        return { data: original.amount_paise, error: null };
      }
      if (name !== 'check_and_debit_retailer_wallet') {
        return { data: null, error: { message: `unknown rpc ${name}` } };
      }
      const forced = db.rpcErrors.shift();
      if (forced) return { data: null, error: { message: forced } };
      const amount = Number(args.p_amount_paise);
      const key = String(args.p_idempotency_key ?? '');
      // Idempotency first: the unique key means the same call never deducts twice.
      const existing = db.ledger.find((row) => row.idempotency_key === key);
      if (existing) return { data: existing.id, error: null };
      if (amount > db.balancePaise) {
        return { data: null, error: { message: `Insufficient credit: available ${db.balancePaise} paise` } };
      }
      sequence += 1;
      const row: LedgerRow = {
        id: `ledger-${sequence}`,
        retailer_id: String(args.p_retailer_id),
        transaction_type: 'ORDER_DEBIT',
        amount_paise: amount,
        direction: 'debit',
        reference_type: 'order',
        reference_id: String(args.p_order_id),
        description: String(args.p_description),
        reason: null,
        created_by: String(args.p_created_by),
        notes: null,
        idempotency_key: key,
        is_reversed: false,
        reversed_by: null,
        reversal_of: null,
        metadata: null,
      };
      db.ledger.push(row);
      db.balancePaise -= amount;
      return { data: row.id, error: null };
    },
    from: (table: string) => {
      const filters: ((row: LedgerRow) => boolean)[] = [];
      let insertPayload: Partial<LedgerRow> | null = null;
      let updatePayload: Partial<LedgerRow> | null = null;
      const matches = () => db.ledger.filter((row) => filters.every((filter) => filter(row)));
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => (row as unknown as Record<string, unknown>)[column] === value);
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'retailer_credit_accounts') return { data: { id: 'account-1' }, error: null };
          if (updatePayload) {
            const target = matches();
            target.forEach((row) => Object.assign(row, updatePayload));
            return { data: target[0] ?? null, error: null };
          }
          return { data: matches()[0] ?? null, error: null };
        },
        order: () => chain,
        limit: () => chain,
        returns: () => chain,
        then: (resolve: (value: { data: unknown; error: unknown; count: number | null }) => unknown) => {
          if (table === 'retailer_wallet_ledger' && updatePayload) {
            const target = matches();
            target.forEach((row) => Object.assign(row, updatePayload));
            return Promise.resolve({ data: target, error: null, count: target.length }).then(resolve);
          }
          if (table === 'retailer_wallet_ledger' && insertPayload) {
            if (db.insertError) return Promise.resolve({ data: null, error: db.insertError, count: null }).then(resolve);
            const existing = db.ledger.find(
              (row) => insertPayload?.idempotency_key && row.idempotency_key === insertPayload.idempotency_key
            );
            if (existing) {
              return Promise.resolve({
                data: null,
                error: { message: 'duplicate key value violates unique constraint', code: '23505' },
                count: null,
              }).then(resolve);
            }
            sequence += 1;
            const row = { id: `ledger-${sequence}`, is_reversed: false, ...insertPayload } as LedgerRow;
            db.ledger.push(row);
            if (row.direction === 'credit') db.balancePaise += row.amount_paise;
            else db.balancePaise -= row.amount_paise;
            return Promise.resolve({ data: [row], error: null, count: 1 }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
        },
        insert: (payload: Partial<LedgerRow>) => {
          insertPayload = payload;
          return chain;
        },
        update: (payload: Partial<LedgerRow>) => {
          updatePayload = payload;
          return chain;
        },
      };
      return chain;
    },
  };
  return client as never;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => activeClient,
}));

let activeClient: unknown;

async function loadModules(db: FakeDb) {
  const client = fakeSupabase(db);
  activeClient = client;
  const coins = await import('@/lib/coins/server');
  const reversal = await import('@/lib/orders/wallet-reversal');
  return { coins, reversal, client };
}

function newDb(balancePaise: number, limitPaise = balancePaise): FakeDb {
  return { limitPaise, balancePaise, ledger: [], rpcErrors: [], rpcCalls: [] };
}

describe('debitCoinsForOrder', () => {
  it('spends min(balance, total) and records ONE ledger row keyed to the order', async () => {
    const db = newDb(80_000);
    const { coins, client } = await loadModules(db);

    const result = await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-1',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #1',
    });

    expect(result).toMatchObject({ ok: true, usedPaise: 50_000, remainingPaise: 0, balancePaise: 30_000 });
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]).toMatchObject({
      transaction_type: 'ORDER_DEBIT',
      amount_paise: 50_000,
      direction: 'debit',
      idempotency_key: 'order:order-1',
    });
    expect(db.balancePaise).toBe(30_000);
  });

  it('cannot be replayed: the same order debits once', async () => {
    const db = newDb(80_000);
    const { coins, client } = await loadModules(db);
    const args = {
      retailerId: 'retailer-1',
      orderId: 'order-1',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #1',
    };

    await coins.debitCoinsForOrder(client as never, args);
    await coins.debitCoinsForOrder(client as never, args);

    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_DEBIT')).toHaveLength(1);
    expect(db.balancePaise).toBe(30_000);
  });

  it('spends nothing (and writes nothing) when the shop has no coins — the order still goes through', async () => {
    const db = newDb(0);
    const { coins, client } = await loadModules(db);

    const result = await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-1',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #1',
    });

    expect(result).toEqual({ ok: true, usedPaise: 0, remainingPaise: 50_000, balancePaise: 0 });
    expect(db.ledger).toHaveLength(0);
  });

  it('absorbs a concurrent spend by recomputing, never by overdrawing', async () => {
    const db = newDb(60_000);
    const { coins, client } = await loadModules(db);
    // Another checkout spends 40,000 between our first read and the RPC.
    db.rpcErrors.push('Insufficient credit: available 20000 paise, required 60000 paise');
    db.balancePaise = 20_000;

    const result = await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-2',
      orderTotalPaise: 60_000,
      createdBy: null,
      description: 'Order #2',
    });

    expect(result).toMatchObject({ ok: true, usedPaise: 20_000, remainingPaise: 40_000, balancePaise: 0 });
    expect(db.balancePaise).toBe(0);
  });

  it('fails the order when the ledger cannot be written (never silently skips the deduction)', async () => {
    const db = newDb(80_000);
    const { coins, client } = await loadModules(db);
    db.rpcErrors.push('permission denied for function check_and_debit_retailer_wallet');

    const result = await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-3',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #3',
    });

    expect(result.ok).toBe(false);
    expect(db.ledger).toHaveLength(0);
    expect(db.balancePaise).toBe(80_000);
  });

  it('takes the amount from the server calculation, not from the caller', async () => {
    const db = newDb(500_000);
    const { coins, client } = await loadModules(db);
    await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-4',
      // The only monetary input is the ORDER TOTAL, which the quote produced.
      orderTotalPaise: 12_345,
      createdBy: null,
      description: 'Order #4',
    });
    expect(db.ledger[0]?.amount_paise).toBe(12_345);
    expect(db.balancePaise).toBe(487_655);
  });
});

describe('refunds', () => {
  async function withDebit(balancePaise = 100_000, orderTotalPaise = 40_000) {
    const db = newDb(balancePaise);
    const modules = await loadModules(db);
    await modules.coins.debitCoinsForOrder(modules.client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-1',
      orderTotalPaise,
      createdBy: null,
      description: 'Order #1',
    });
    return { db, ...modules };
  }

  it('refunds exactly what was spent, linked to the original ledger row', async () => {
    const { db, reversal } = await withDebit();
    const before = db.balancePaise;

    const result = await reversal.reverseOrderWalletDebit('order-1', 'retailer-1', 'cancelled', 'admin-1');

    expect(result).toEqual({ success: true, refundedPaise: 40_000 });
    const refund = db.ledger.find((row) => row.transaction_type === 'ORDER_REVERSAL');
    expect(refund).toMatchObject({
      amount_paise: 40_000,
      direction: 'credit',
      reference_id: 'order-1',
      reversal_of: db.ledger[0]?.id,
      idempotency_key: `reversal:${db.ledger[0]?.id}`,
      created_by: 'admin-1',
    });
    expect(db.ledger[0]?.is_reversed).toBe(false);
    expect(db.balancePaise).toBe(before + 40_000);
  });

  it('is impossible to execute twice — a second cancellation refunds nothing more', async () => {
    const { db, reversal } = await withDebit();
    await reversal.reverseOrderWalletDebit('order-1', 'retailer-1', 'cancelled', 'admin-1');
    const afterFirst = db.balancePaise;

    const second = await reversal.reverseOrderWalletDebit('order-1', 'retailer-1', 'cancelled again', 'admin-1');

    expect(second).toEqual({ success: true, refundedPaise: 0 });
    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_REVERSAL')).toHaveLength(1);
    expect(db.balancePaise).toBe(afterFirst);
  });

  it('never refunds more than was spent (order ₹500 → debit −500 → refund +500 → net 0)', async () => {
    const db = newDb(50_000);
    const { coins, reversal, client } = await loadModules(db);
    await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-500',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #500',
    });
    expect(db.balancePaise).toBe(0);

    await reversal.reverseOrderWalletDebit('order-500', 'retailer-1', 'cancelled', 'admin-1');

    expect(db.balancePaise).toBe(50_000);
    const movements = db.ledger.reduce((sum, row) => sum + (row.direction === 'credit' ? row.amount_paise : -row.amount_paise), 0);
    expect(movements).toBe(0);
  });

  it('a refund for an order that spent no coins is a no-op', async () => {
    const db = newDb(0);
    const { coins, reversal, client } = await loadModules(db);
    await coins.debitCoinsForOrder(client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-0',
      orderTotalPaise: 50_000,
      createdBy: null,
      description: 'Order #0',
    });

    const result = await reversal.reverseOrderWalletDebit('order-0', 'retailer-1', 'cancelled', 'admin-1');
    expect(result).toEqual({ success: true, refundedPaise: 0 });
    expect(db.ledger).toHaveLength(0);
  });

  it('surfaces a ledger failure instead of pretending the refund happened', async () => {
    const { db, reversal } = await withDebit();
    db.insertError = { message: 'connection reset' };

    const result = await reversal.reverseOrderWalletDebit('order-1', 'retailer-1', 'cancelled', 'admin-1');

    expect('error' in result).toBe(true);
    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_REVERSAL')).toHaveLength(0);
  });
});

describe('refund path (0053 database function)', () => {
  it('calls refund_order_coins so a retailer or staff cancellation can refund', async () => {
    const { db, reversal } = await (async () => {
      const database = newDb(50_000);
      const modules = await loadModules(database);
      await modules.coins.debitCoinsForOrder(modules.client as never, {
        retailerId: 'retailer-1',
        orderId: 'order-fn',
        orderTotalPaise: 50_000,
        createdBy: null,
        description: 'Order #fn',
      });
      return { db: database, ...modules };
    })();

    const result = await reversal.reverseOrderWalletDebit('order-fn', 'retailer-1', 'cancelled', null);

    expect(result).toEqual({ success: true, refundedPaise: 50_000 });
    expect(db.rpcCalls.map((call) => call.name)).toContain('refund_order_coins');
    expect(db.balancePaise).toBe(50_000);
  });

  it('fails closed without direct writes when the refund function is missing', async () => {
    const db = newDb(50_000);
    const modules = await loadModules(db);
    await modules.coins.debitCoinsForOrder(modules.client as never, {
      retailerId: 'retailer-1', orderId: 'order-old-db', orderTotalPaise: 50_000,
      createdBy: null, description: 'Order #old',
    });
    db.missingRefundRpc = true;
    const result = await modules.reversal.reverseOrderWalletDebit('order-old-db', 'retailer-1', 'returned', 'admin-1');
    expect(result).toHaveProperty('error');
    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_REVERSAL')).toHaveLength(0);
    expect(db.ledger[0]?.is_reversed).toBe(false);
    expect(db.balancePaise).toBe(0);
  });

  it('does not use the multi-request fallback when cancellation requires the refund RPC', async () => {
    const db = newDb(50_000);
    const modules = await loadModules(db);
    await modules.coins.debitCoinsForOrder(modules.client as never, {
      retailerId: 'retailer-1', orderId: 'order-no-rpc', orderTotalPaise: 10_000,
      createdBy: null, description: 'Order #no-rpc',
    });
    db.missingRefundRpc = true;
    const result = await modules.reversal.reverseOrderWalletDebit('order-no-rpc', 'retailer-1', 'cancelled', 'admin-1', modules.client as never, { requireRefundRpc: true });
    expect(result).toHaveProperty('error');
    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_REVERSAL')).toHaveLength(0);
    expect(db.ledger[0]?.is_reversed).toBe(false);
  });

  it('surfaces a real database error instead of falling back silently', async () => {
    const db = newDb(50_000);
    const modules = await loadModules(db);
    await modules.coins.debitCoinsForOrder(modules.client as never, {
      retailerId: 'retailer-1',
      orderId: 'order-error',
      orderTotalPaise: 10_000,
      createdBy: null,
      description: 'Order #error',
    });
    db.rpcErrors.push('42501: Access denied: you cannot refund coins for this order.');

    const result = await modules.reversal.reverseOrderWalletDebit('order-error', 'retailer-1', 'cancelled', null);
    expect('error' in result).toBe(true);
    expect(db.ledger.filter((row) => row.transaction_type === 'ORDER_REVERSAL')).toHaveLength(0);
  });
});

describe('coin source guarantees', () => {
  it('the coins module exposes no function that accepts a client amount', async () => {
    const { readFile } = await import('node:fs/promises');
    const server = await readFile('lib/coins/server.ts', 'utf8');
    // The deduction amount is always derived from the order total + live
    // balance; only `orderTotalPaise` (from the server quote) is passed in.
    expect(server).toContain('p_amount_paise: payment.usedPaise');
    expect(server).toContain('coinDebitKey(orderId)');
    expect(server).toContain('getRetailerCoinPosition');
  });

  it('order placement applies Coins and stock in the atomic transaction, so a debit failure cannot leave a partial order', async () => {
    const { readFile } = await import('node:fs/promises');
    const createOrder = await readFile('lib/orders/create-order.ts', 'utf8');
    const atomicOrder = await readFile('supabase/migrations/0056_mobile_checkout_atomic.sql', 'utf8');
    expect(createOrder).toContain('p_expected_coins_used_paise: quote.coins.usedPaise');
    expect(atomicOrder).toContain('public.check_and_debit_retailer_wallet(');
    expect(atomicOrder).toContain("'order:' || v_order.id::text");
    expect(atomicOrder).toContain('request_completed_at = now()');
    expect(atomicOrder).not.toContain('Coin debit failed');
    // No credit gate left in the TypeScript order path.
    expect(createOrder).not.toContain('exceedsLimit');
    expect(createOrder).not.toContain('order:${order.id}');
  });
});
