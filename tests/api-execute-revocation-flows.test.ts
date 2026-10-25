/**
 * The 0079 revocations must not break AUTHORIZED inventory work.
 *
 * 0079 withdraws `anon` EXECUTE from fourteen inventory/cost helpers and
 * withdraws both API grants from `ensure_fefo_coverage`. `authenticated` keeps
 * every grant it had. This file proves the second half is real: a staff/admin
 * session still drives a full goods receipt, a stock transfer, a batch loss and
 * a stock adjustment through the very functions that were touched — executed
 * against PostgreSQL with all 76 migrations applied.
 *
 * If a future migration over-revokes (the usual way this breaks), these cases
 * fail with "permission denied for function ..." instead of silently turning
 * the inventory screens into error pages.
 *
 * Run: corepack pnpm exec vitest run tests/api-execute-revocation-flows.test.ts
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createArea, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let admin: string;
let staff: string;
let warehouseId: string;
let otherWarehouseId: string;
let productId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  const area = await createArea(db);
  admin = await createUser(db, 'admin');
  staff = await createUser(db, 'staff');

  const wh = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ('Flow WH A', $1, true),
            ('Flow WH B', $1, true) returning id`,
    [area]
  );
  warehouseId = wh.rows[0]!.id;
  otherWarehouseId = wh.rows[1]!.id;

  // Staff works in warehouse A only — 0037's scoping policies depend on this.
  await db.query(`insert into staff_assignments (staff_id, warehouse_id) values ($1, $2)`, [
    staff,
    warehouseId,
  ]);

  const product = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price) values ($1, 'Flow Product', 'pcs', 100) returning id`,
    [`FLOW-${randomUUID().slice(0, 8)}`]
  );
  productId = product.rows[0]!.id;
}, 180_000);

async function draftGrn(quantity: number, batchNumber: string): Promise<string> {
  return as(db, 'service', async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into grns (warehouse_id, status) values ($1, 'draft') returning id`,
      [warehouseId]
    );
    await tx.query(
      `insert into grn_items (grn_id, product_id, batch_number, received_quantity, unit_cost)
       values ($1, $2, $3, $4, 50)`,
      [rows[0]!.id, productId, batchNumber, quantity]
    );
    return rows[0]!.id;
  });
}

const stockOf = async () => {
  const { rows } = await db.query<{ q: number }>(
    `select coalesce(sum(current_quantity), 0)::int q from inventory_batches where product_id = $1`,
    [productId]
  );
  return rows[0]!.q;
};

describe('goods receipt (confirm_grn / cancel_grn)', () => {
  it('staff confirms a GRN and stock lands in the batch ledger', async () => {
    const grnId = await draftGrn(10, `B-${randomUUID().slice(0, 6)}`);
    const result = await as(db, staff, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string; units_received: number } }>(
        `select public.confirm_grn($1) as r`,
        [grnId]
      );
      return rows[0]!.r;
    });
    expect(result.status).toBe('confirmed');
    expect(await stockOf()).toBe(10);
  });

  it('confirming twice is idempotent (already_confirmed, no double stock)', async () => {
    const grnId = await draftGrn(5, `B-${randomUUID().slice(0, 6)}`);
    await as(db, staff, (tx) => tx.query(`select public.confirm_grn($1)`, [grnId]));
    const before = await stockOf();
    const again = await as(db, staff, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(`select public.confirm_grn($1) as r`, [
        grnId,
      ]);
      return rows[0]!.r;
    });
    expect(again.status).toBe('already_confirmed');
    expect(await stockOf()).toBe(before);
  });

  it('staff can cancel a draft GRN', async () => {
    const grnId = await draftGrn(3, `B-${randomUUID().slice(0, 6)}`);
    const result = await as(db, staff, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(
        `select public.cancel_grn($1, 'delivery rejected at dock') as r`,
        [grnId]
      );
      return rows[0]!.r;
    });
    expect(['cancelled', 'canceled']).toContain(result.status);
  });

  it('anon still cannot reach confirm_grn (0079)', async () => {
    const grnId = await draftGrn(1, `B-${randomUUID().slice(0, 6)}`);
    expect(
      await errorOf(db, 'anon', (tx) => tx.query(`select public.confirm_grn($1)`, [grnId]))
    ).toMatch(/permission denied for function confirm_grn/);
  });

  it('a retailer cannot confirm a GRN (caller check, not just the grant)', async () => {
    const retailer = await createUser(db, 'retailer', 'GRN Retailer', { areaId: await createArea(db) });
    const grnId = await draftGrn(1, `B-${randomUUID().slice(0, 6)}`);
    expect(
      await errorOf(db, retailer, (tx) => tx.query(`select public.confirm_grn($1)`, [grnId]))
    ).toMatch(/permission|inventory/i);
  });
});

describe('stock transfer (execute_stock_transfer / cancel_stock_transfer)', () => {
  async function draftTransfer(quantity: number): Promise<string> {
    // Stock first: an FEFO batch in the source warehouse.
    const grnId = await draftGrn(quantity, `T-${randomUUID().slice(0, 6)}`);
    await as(db, staff, (tx) => tx.query(`select public.confirm_grn($1)`, [grnId]));

    return as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into stock_transfers (source_warehouse_id, destination_warehouse_id, status)
         values ($1, $2, 'pending') returning id`,
        [warehouseId, otherWarehouseId]
      );
      // A transfer line moves a specific FEFO batch, so take the newest one.
      const batch = await tx.query<{ id: string }>(
        `select id from inventory_batches where product_id = $1 and warehouse_id = $2
           and current_quantity >= $3 order by expiry_date nulls last, created_at limit 1`,
        [productId, warehouseId, quantity]
      );
      await tx.query(
        `insert into stock_transfer_items (transfer_id, product_id, batch_id, quantity) values ($1, $2, $3, $4)`,
        [rows[0]!.id, productId, batch.rows[0]!.id, quantity]
      );
      return rows[0]!.id;
    });
  }

  it('admin executes a pending transfer', async () => {
    const transferId = await draftTransfer(2);
    const result = await as(db, admin, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(
        `select public.execute_stock_transfer($1) as r`,
        [transferId]
      );
      return rows[0]!.r;
    });
    expect(result.status).toBe('completed');
  });

  it('staff can cancel a pending transfer with a reason', async () => {
    const transferId = await draftTransfer(1);
    const result = await as(db, staff, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(
        `select public.cancel_stock_transfer($1, 'van unavailable') as r`,
        [transferId]
      );
      return rows[0]!.r;
    });
    expect(result.status).toBe('cancelled');
  });

  it('anon cannot execute a transfer', async () => {
    const transferId = await draftTransfer(1);
    expect(
      await errorOf(db, 'anon', (tx) =>
        tx.query(`select public.execute_stock_transfer($1)`, [transferId])
      )
    ).toMatch(/permission denied for function execute_stock_transfer/);
  });
});

describe('batch loss and stock adjustment (record_batch_loss / adjust_product_stock)', () => {
  it('staff records a batch loss against a real batch', async () => {
    const grnId = await draftGrn(4, `L-${randomUUID().slice(0, 6)}`);
    await as(db, staff, (tx) => tx.query(`select public.confirm_grn($1)`, [grnId]));
    const batch = await db.query<{ id: string; current_quantity: number }>(
      `select id, current_quantity from inventory_batches where product_id = $1 order by created_at desc limit 1`,
      [productId]
    );
    const result = await as(db, staff, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(
        `select public.record_batch_loss($1, 1, 'damage', 'crushed in transit') as r`,
        [batch.rows[0]!.id]
      );
      return rows[0]!.r;
    });
    expect(result.status).toBe('recorded');
  });

  it('admin adjusts stock upward with a reason', async () => {
    const batch = await db.query<{ id: string; current_quantity: number }>(
      `select id, current_quantity from inventory_batches where product_id = $1 order by created_at desc limit 1`,
      [productId]
    );
    const result = await as(db, admin, async (tx) => {
      const { rows } = await tx.query<{ r: { status: string } }>(
        `select public.adjust_product_stock($1, $2, 3, 'cycle count correction', $3) as r`,
        [productId, warehouseId, batch.rows[0]!.id]
      );
      return rows[0]!.r;
    });
    expect(result.status).toBe('adjusted');
  });

  it('anon cannot adjust stock or record a loss', async () => {
    const batch = await db.query<{ id: string }>(
      `select id from inventory_batches where product_id = $1 limit 1`,
      [productId]
    );
    expect(
      await errorOf(db, 'anon', (tx) =>
        tx.query(`select public.adjust_product_stock($1, $2, 1, 'x', $3)`, [
          productId,
          warehouseId,
          batch.rows[0]!.id,
        ])
      )
    ).toMatch(/permission denied for function adjust_product_stock/);
    expect(
      await errorOf(db, 'anon', (tx) =>
        tx.query(`select public.record_batch_loss($1, 1, 'damage', 'x')`, [batch.rows[0]!.id])
      )
    ).toMatch(/permission denied for function record_batch_loss/);
  });
});
