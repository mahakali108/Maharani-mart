import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  createArea,
  createMigratedDb,
  createPack,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type PackFixture,
  type RetailerFixture,
} from './helpers/pg-harness';

let db: Db;
let admin: string;
let staff: string;
let retailer: RetailerFixture;
let pack: PackFixture;
let activeWarehouseId: string;
let inactiveWarehouseId: string;

async function warehouse(name: string, areaId: string, isActive: boolean): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into warehouses (name, area_id, is_active) values ($1, $2, $3) returning id`,
    [name, areaId, isActive]
  );
  return rows[0]!.id;
}

async function setPackStock(quantity: number) {
  await as(db, admin, (tx) => tx.query(
    `select public.admin_set_product_pack_stock($1, $2)`,
    [pack.packId, quantity]
  ));
}

async function createSimpleOrder({
  quantity,
  requestKey = randomUUID(),
  requestedWarehouse = inactiveWarehouseId,
  withLine = true,
}: {
  quantity?: number;
  requestKey?: string | null;
  requestedWarehouse?: string | null;
  withLine?: boolean;
}) {
  return as(db, retailer.id, async (tx) => {
    const { rows } = await tx.query<{ id: string; warehouse_id: string; simple_stock_mode: boolean }>(
      `insert into orders (retailer_id, warehouse_id, simple_stock_mode, request_key)
       values ($1, $2, false, $3)
       returning id, warehouse_id, simple_stock_mode`,
      [retailer.id, requestedWarehouse, requestKey]
    );
    const order = rows[0]!;
    let itemId: string | null = null;
    if (withLine && quantity !== undefined) {
      const { rows: items } = await tx.query<{ id: string; stock_deducted_quantity: number; stock_restored_quantity: number }>(
        `insert into order_items
           (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total,
            quantity_unit, quantity_pieces, units_per_case)
         values ($1, $2, $3, $4::integer, 1, 0, ($4::integer)::numeric, 'pieces', $4::integer, 1)
         returning id, stock_deducted_quantity, stock_restored_quantity`,
        [order.id, pack.productId, pack.packId, quantity]
      );
      itemId = items[0]!.id;
    }
    return { ...order, itemId, requestKey };
  });
}

async function readPackStock(): Promise<number> {
  const { rows } = await db.query<{ stock_quantity: number }>(
    `select stock_quantity from product_packs where id = $1`,
    [pack.packId]
  );
  return rows[0]!.stock_quantity;
}

async function readOrderItem(orderItemId: string) {
  const { rows } = await db.query<{ stock_deducted_quantity: number; stock_restored_quantity: number }>(
    `select stock_deducted_quantity, stock_restored_quantity from order_items where id = $1`,
    [orderItemId]
  );
  return rows[0]!;
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  staff = await createUser(db, 'staff');
  const areaId = await createArea(db);
  retailer = await createRetailer(db, { areaId });
  pack = await createPack(db);
  activeWarehouseId = await warehouse('Current fulfilment site', areaId, true);
  inactiveWarehouseId = await warehouse('Historical fulfilment site', areaId, false);
}, 120_000);

beforeEach(async () => {
  await setPackStock(5);
});

describe('new pack-stock orders', () => {
  it('requires exactly one active warehouse and overwrites a posted warehouse/mode', async () => {
    await db.query(`update warehouses set is_active = false`);
    const zero = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into orders (retailer_id, warehouse_id) values ($1, $2)`,
      [retailer.id, inactiveWarehouseId]
    ));
    expect(zero).toMatch(/Warehouse configuration error: exactly one active warehouse is required \(found 0\)/);

    await db.query(`update warehouses set is_active = true where id = $1`, [activeWarehouseId]);
    const anotherActive = await warehouse('Second active site', retailer.areaId, true);
    const multiple = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into orders (retailer_id, warehouse_id) values ($1, $2)`,
      [retailer.id, inactiveWarehouseId]
    ));
    expect(multiple).toMatch(/Warehouse configuration error: exactly one active warehouse is required \(found 2\)/);
    await db.query(`update warehouses set is_active = false where id = $1`, [anotherActive]);

    const created = await createSimpleOrder({ quantity: 2, requestedWarehouse: inactiveWarehouseId });
    expect(created.simple_stock_mode).toBe(true);
    expect(created.warehouse_id).toBe(activeWarehouseId);
  });

  it('forces newly inserted variants to start with zero sellable stock', async () => {
    const sku = `ADMIN-${randomUUID().slice(0, 8)}`;
    await as(db, admin, (tx) => tx.query(
      `insert into product_packs (product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity)
       values ($1, 'Admin-created variant', $2, 100, 100, 77)`,
      [pack.productId, sku]
    ));
    const { rows } = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from product_packs where pack_sku_code = $1`, [sku]
    );
    expect(Number(rows[0]!.stock_quantity)).toBe(0);
  });

  it('atomically deducts per pack, rejects excess stock, and refuses duplicate lines/retries', async () => {
    const order = await createSimpleOrder({ quantity: 4 });
    expect(order.simple_stock_mode).toBe(true);
    expect(await readPackStock()).toBe(1);
    expect(await readOrderItem(order.itemId!)).toEqual({ stock_deducted_quantity: 4, stock_restored_quantity: 0 });

    const retryOrder = await createSimpleOrder({ withLine: false });
    const shortage = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into order_items
         (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total,
          quantity_unit, quantity_pieces, units_per_case)
       values ($1, $2, $3, 2, 1, 0, 2, 'pieces', 2, 1)`,
      [retryOrder.id, pack.productId, pack.packId]
    ));
    expect(shortage).toMatch(/INSUFFICIENT_STOCK: Only 1 available/);
    expect(await readPackStock()).toBe(1);

    const duplicateLine = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into order_items
         (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total,
          quantity_unit, quantity_pieces, units_per_case)
       values ($1, $2, $3, 1, 1, 0, 1, 'pieces', 1, 1)`,
      [order.id, pack.productId, pack.packId]
    ));
    expect(duplicateLine).toMatch(/This pack is already present in the order/);
    expect(await readPackStock()).toBe(1);

    const replayedKey = await errorOf(db, retailer.id, (tx) => tx.query(
      `insert into orders (retailer_id, request_key) values ($1, $2)`,
      [retailer.id, order.requestKey]
    ));
    // The unique partial index—not a second deduction—blocks the same form key.
    expect(replayedKey).toMatch(/duplicate key value violates unique constraint/);
    expect(await readPackStock()).toBe(1);
  });

  it('restores cancelled stock exactly once using per-line counters', async () => {
    const order = await createSimpleOrder({ quantity: 3 });
    expect(await readPackStock()).toBe(2);
    await as(db, admin, (tx) => tx.query(`update orders set status = 'cancelled' where id = $1`, [order.id]));
    expect(await readPackStock()).toBe(5);
    expect(await readOrderItem(order.itemId!)).toEqual({ stock_deducted_quantity: 3, stock_restored_quantity: 3 });

    const again = await db.query<{ restore_simple_order_stock: number }>(
      `select public.restore_simple_order_stock($1, null) as restore_simple_order_stock`,
      [order.id]
    );
    expect(Number(again.rows[0]!.restore_simple_order_stock)).toBe(0);
    expect(await readPackStock()).toBe(5);
  });

  it('restores a delivered return once, and exposes status—not exact counts—to retailers', async () => {
    const order = await createSimpleOrder({ quantity: 2 });
    expect(await readPackStock()).toBe(3);
    await as(db, admin, async (tx) => {
      await tx.query(`update orders set status = 'confirmed' where id = $1`, [order.id]);
      await tx.query(`update orders set status = 'dispatched' where id = $1`, [order.id]);
      await tx.query(`update orders set status = 'delivered' where id = $1`, [order.id]);
    });

    const first = await as(db, admin, (tx) => tx.query<{ result: { units: number } }>(
      `select public.return_order_stock($1, null) as result`, [order.id]
    ));
    expect(first.rows[0]!.result.units).toBe(2);
    const second = await as(db, admin, (tx) => tx.query<{ result: { units: number } }>(
      `select public.return_order_stock($1, null) as result`, [order.id]
    ));
    expect(second.rows[0]!.result.units).toBe(0);
    expect(await readPackStock()).toBe(5);

    await db.query(`update product_packs set cost_price = 5 where id = $1`, [pack.packId]);
    const visiblePack = await as(db, retailer.id, (tx) => tx.query<{ id: string; pack_name: string; case_price: number }>(
      `select id, pack_name, case_price from product_packs where id = $1`, [pack.packId]
    ));
    expect(visiblePack.rows[0]).toMatchObject({ id: pack.packId, pack_name: '1 pc' });
    const { rows: availability } = await as(db, retailer.id, (tx) => tx.query<{ pack_id: string; stock_status: string }>(
      `select * from public.get_retailer_pack_availability(array[$1]::uuid[])`, [pack.packId]
    ));
    expect(availability).toEqual([{ pack_id: pack.packId, stock_status: 'in_stock' }]);
    const stockReadDenied = await errorOf(db, retailer.id, (tx) => tx.query(
      `select stock_quantity from product_packs where id = $1`, [pack.packId]
    ));
    expect(JSON.stringify(stockReadDenied)).toMatch(/permission denied/);
    await as(db, retailer.id, (tx) => tx.query(
      `update product_packs set stock_quantity = 99 where id = $1`, [pack.packId]
    ));
    expect(await readPackStock()).toBe(5);
    expect(JSON.stringify(await errorOf(db, staff, (tx) => tx.query(
      `update product_packs set stock_quantity = 99 where id = $1`, [pack.packId]
    )))).toMatch(/Only an Admin can change stock_quantity/);
    expect(JSON.stringify(await errorOf(db, retailer.id, (tx) => tx.query(
      `select public.admin_set_product_pack_stock($1, 99)`, [pack.packId]
    )))).toMatch(/Only an Admin can change pack stock/);
    const stockRpcDenied = await errorOf(db, retailer.id, (tx) => tx.query(
      `select * from public.admin_product_pack_stock(array[$1]::uuid[])`, [pack.productId]
    ));
    expect(JSON.stringify(stockRpcDenied)).toMatch(/Only an Admin can view exact pack stock/);
    expect(JSON.stringify(await errorOf(db, retailer.id, (tx) => tx.query(
      `select cost_price from product_packs where id = $1`, [pack.packId]
    )))).toMatch(/permission denied/);
    const adminCost = await as(db, admin, (tx) => tx.query<{ pack_id: string; cost_price: number | null }>(
      `select pack_id, cost_price from public.admin_pack_costs($1)`, [pack.productId]
    ));
    const costRow = adminCost.rows.find((row) => row.pack_id === pack.packId);
    expect(costRow).toBeTruthy();
    expect(Number(costRow!.cost_price)).toBe(5);
    const adminStock = await as(db, admin, (tx) => tx.query<{ pack_id: string; stock_quantity: number }>(
      `select pack_id, stock_quantity from public.admin_product_pack_stock(array[$1]::uuid[])`, [pack.productId]
    ));
    expect(adminStock.rows.find((row) => row.pack_id === pack.packId)).toEqual({ pack_id: pack.packId, stock_quantity: 5 });
  });

  it('keeps product purchase cost behind the Admin accessor without breaking catalog reads', async () => {
    await db.query(`update products set cost_price = 7 where id = $1`, [pack.productId]);
    const visibleProduct = await as(db, retailer.id, (tx) => tx.query<{ id: string; name: string; min_stock: number }>(
      `select id, name, min_stock from products where id = $1`, [pack.productId]
    ));
    expect(visibleProduct.rows[0]).toMatchObject({ id: pack.productId, min_stock: 0 });

    expect(JSON.stringify(await errorOf(db, retailer.id, (tx) => tx.query(
      `select cost_price from products where id = $1`, [pack.productId]
    )))).toMatch(/permission denied/);
    expect(JSON.stringify(await errorOf(db, admin, (tx) => tx.query(
      `select cost_price from products where id = $1`, [pack.productId]
    )))).toMatch(/permission denied/);

    const adminCost = await as(db, admin, (tx) => tx.query<{ product_id: string; cost_price: number }>(
      `select product_id, cost_price from public.admin_product_costs() where product_id = $1`, [pack.productId]
    ));
    expect(adminCost.rows).toHaveLength(1);
    expect(adminCost.rows[0]!.product_id).toBe(pack.productId);
    expect(Number(adminCost.rows[0]!.cost_price)).toBe(7);
  });

  it('keeps legacy orders on warehouse reservations, FEFO dispatch, and whole-item returns', async () => {
    const legacyPack = await createPack(db);
    const beforePackStock = await db.query<{ stock_quantity: number }>(
      `select stock_quantity from product_packs where id = $1`, [legacyPack.packId]
    );
    const batchNumber = `LEGACY-${randomUUID().slice(0, 8)}`;
    const { rows: batchRows } = await db.query<{ id: string }>(
      `insert into inventory_batches (product_id, warehouse_id, batch_number, received_quantity, created_by)
       values ($1, $2, $3, 10, $4) returning id`,
      [legacyPack.productId, activeWarehouseId, batchNumber, admin]
    );
    const batchId = batchRows[0]!.id;
    await db.query(
      `insert into stock_movements
         (product_id, warehouse_id, batch_id, movement_type, quantity, reference_type, reason, performed_by)
       values ($1, $2, $3, 'opening_stock', 10, 'manual', 'Legacy compatibility fixture', $4)`,
      [legacyPack.productId, activeWarehouseId, batchId, admin]
    );

    await db.query(`alter table orders disable trigger trg_prepare_simple_stock_order_insert`);
    let orderId: string;
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into orders (retailer_id, status, warehouse_id, simple_stock_mode)
         values ($1, 'confirmed', $2, false) returning id`,
        [retailer.id, activeWarehouseId]
      );
      orderId = rows[0]!.id;
    } finally {
      await db.query(`alter table orders enable trigger trg_prepare_simple_stock_order_insert`);
    }
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into order_items
         (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total,
          quantity_unit, quantity_pieces, units_per_case)
       values ($1, $2, $3, 3, 100, 0, 300, 'pieces', 3, 10) returning id`,
      [orderId, legacyPack.productId, legacyPack.packId]
    );

    const reserved = await as(db, admin, (tx) => tx.query<{ result: { status: string } }>(
      `select public.reserve_order_stock($1) as result`, [orderId]
    ));
    expect(reserved.rows[0]!.result.status).toBe('reserved');
    expect((await db.query<{ quantity: number; reserved_quantity: number }>(
      `select quantity, reserved_quantity from inventory_stock where product_id = $1 and warehouse_id = $2`,
      [legacyPack.productId, activeWarehouseId]
    )).rows[0]).toMatchObject({ quantity: 10, reserved_quantity: 3 });

    const dispatched = await as(db, admin, (tx) => tx.query<{ result: { status: string; units_consumed: number } }>(
      `select public.consume_order_stock($1) as result`, [orderId]
    ));
    expect(dispatched.rows[0]!.result).toMatchObject({ status: 'consumed', units_consumed: 3 });
    expect((await db.query<{ current_quantity: number; reserved_quantity: number }>(
      `select current_quantity, reserved_quantity from inventory_batches where id = $1`, [batchId]
    )).rows[0]).toMatchObject({ current_quantity: 7, reserved_quantity: 0 });

    await db.query(`update orders set status = 'dispatched' where id = $1`, [orderId]);
    await db.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    const returned = await as(db, admin, (tx) => tx.query<{ result: { status: string; units: number } }>(
      `select public.return_order_stock($1, $2) as result`, [orderId, itemRows[0]!.id]
    ));
    expect(returned.rows[0]!.result).toMatchObject({ status: 'returned', units: 3 });
    expect((await db.query<{ current_quantity: number }>(
      `select current_quantity from inventory_batches where id = $1`, [batchId]
    )).rows[0]!.current_quantity).toBe(10);
    expect((await db.query<{ quantity: number }>(
      `select quantity from inventory_stock where product_id = $1 and warehouse_id = $2`,
      [legacyPack.productId, activeWarehouseId]
    )).rows[0]!.quantity).toBe(10);
    expect((await db.query<{ simple_stock_mode: boolean }>(
      `select simple_stock_mode from orders where id = $1`, [orderId]
    )).rows[0]!.simple_stock_mode).toBe(false);
    expect((await db.query<{ stock_quantity: number }>(
      `select stock_quantity from product_packs where id = $1`, [legacyPack.packId]
    )).rows[0]!.stock_quantity).toBe(beforePackStock.rows[0]!.stock_quantity);

    const returnRequestColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'return_requests'`
    );
    expect(returnRequestColumns.rows.map((row) => row.column_name)).not.toContain('quantity');
  });

  it('does not deduct legacy inventory again at simple-order dispatch', async () => {
    const order = await createSimpleOrder({ quantity: 2 });
    await as(db, admin, (tx) => tx.query(`update orders set status = 'confirmed' where id = $1`, [order.id]));
    await db.query(
      `insert into inventory_stock (product_id, warehouse_id, quantity, reserved_quantity)
       values ($1, $2, 12, 0)`,
      [pack.productId, activeWarehouseId]
    );
    const beforeMovements = (await db.query<{ count: number }>(`select count(*)::int as count from stock_movements`)).rows[0]!.count;

    const consumed = await as(db, admin, (tx) => tx.query<{ result: { status: string } }>(
      `select public.consume_order_stock($1) as result`, [order.id]
    ));
    expect(consumed.rows[0]!.result.status).toBe('simple_stock_already_deducted');
    expect(await readPackStock()).toBe(3);
    expect((await db.query<{ quantity: number }>(
      `select quantity from inventory_stock where product_id = $1 and warehouse_id = $2`,
      [pack.productId, activeWarehouseId]
    )).rows[0]!.quantity).toBe(12);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from stock_movements`)).rows[0]!.count).toBe(beforeMovements);
  });
});

describe('request-key completion safety', () => {
  it('never finalizes on insert, rejects forged/incomplete retries, and marks a completed capture once', async () => {
    const salesman = await createUser(db, 'salesman');
    const requestKey = randomUUID();
    const { rows } = await db.query<{ id: string; request_completed_at: string | null }>(
      `insert into orders (retailer_id, collected_by, request_key, request_completed_at)
       values ($1, $2, $3, now()) returning id, request_completed_at`,
      [retailer.id, salesman, requestKey]
    );
    const orderId = rows[0]!.id;
    expect(rows[0]!.request_completed_at).toBeNull();
    await db.query(
      `insert into order_items
         (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total,
          quantity_unit, quantity_pieces, units_per_case)
       values ($1, $2, $3, 1, 1, 0, 1, 'pieces', 1, 1)`,
      [orderId, pack.productId, pack.packId]
    );

    const clientCall = await errorOf(db, retailer.id, (tx) => tx.query(
      `select public.complete_order_request($1, $2, $3)`, [orderId, requestKey, salesman]
    ));
    expect(clientCall).toMatch(/permission denied/);
    const wrongOwner = await errorOf(db, 'service', (tx) => tx.query(
      `select public.complete_order_request($1, $2, $3)`, [orderId, requestKey, retailer.id]
    ));
    expect(wrongOwner).toMatch(/Capturing salesman does not match/);
    const forgedUpdate = await errorOf(db, salesman, (tx) => tx.query(
      `update orders set request_completed_at = now() where id = $1`, [orderId]
    ));
    expect(forgedUpdate).toMatch(/only be written through the finalization RPC/);
    expect((await db.query<{ request_completed_at: string | null }>(
      `select request_completed_at from orders where id = $1`, [orderId]
    )).rows[0]!.request_completed_at).toBeNull();

    const completed = await as(db, 'service', (tx) => tx.query<{ complete_order_request: boolean }>(
      `select public.complete_order_request($1, $2, $3) as complete_order_request`, [orderId, requestKey, salesman]
    ));
    expect(completed.rows[0]!.complete_order_request).toBe(true);
    const firstTimestamp = (await db.query<{ request_completed_at: string }>(
      `select request_completed_at from orders where id = $1`, [orderId]
    )).rows[0]!.request_completed_at;
    expect(firstTimestamp).toBeTruthy();

    await as(db, 'service', (tx) => tx.query(
      `select public.complete_order_request($1, $2, $3)`, [orderId, requestKey, salesman]
    ));
    const secondTimestamp = (await db.query<{ request_completed_at: string }>(
      `select request_completed_at from orders where id = $1`, [orderId]
    )).rows[0]!.request_completed_at;
    expect(Date.parse(secondTimestamp)).toBe(Date.parse(firstTimestamp));
    expect(await readPackStock()).toBe(4);
  });
});

describe('legacy order stock compatibility', () => {
  it('keeps historical warehouse FEFO consumption on the original inventory path', async () => {
    const legacyProduct = await createPack(db);
    await setPackStock(5);
    await db.query(
      `insert into inventory_stock (product_id, warehouse_id, quantity, reserved_quantity)
       values ($1, $2, 10, 0)`,
      [legacyProduct.productId, inactiveWarehouseId]
    );

    await db.exec(`alter table orders disable trigger trg_prepare_simple_stock_order_insert`);
    let orderId = '';
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into orders (retailer_id, warehouse_id, status, simple_stock_mode)
         values ($1, $2, 'confirmed', false) returning id`,
        [retailer.id, inactiveWarehouseId]
      );
      orderId = rows[0]!.id;
    } finally {
      await db.exec(`alter table orders enable trigger trg_prepare_simple_stock_order_insert`);
    }
    const { rows: items } = await db.query<{ id: string }>(
      `insert into order_items
         (order_id, product_id, pack_id, quantity, unit_price, gst_percent, line_total, quantity_unit, quantity_pieces, units_per_case)
       values ($1, $2, $3, 2, 1, 0, 2, 'packs', 2, 1) returning id`,
      [orderId, legacyProduct.productId, legacyProduct.packId]
    );
    expect(items[0]?.id).toBeTruthy();
    expect(Number((await db.query<{ stock_quantity: number }>(`select stock_quantity from product_packs where id = $1`, [legacyProduct.packId])).rows[0]!.stock_quantity)).toBe(0);

    await as(db, admin, (tx) => tx.query(`select public.consume_order_stock($1)`, [orderId]));

    const legacyStock = await db.query<{ quantity: number }>(
      `select quantity from inventory_stock where product_id = $1 and warehouse_id = $2`,
      [legacyProduct.productId, inactiveWarehouseId]
    );
    expect(legacyStock.rows[0]!.quantity).toBe(8);
    expect(Number((await db.query<{ stock_quantity: number }>(`select stock_quantity from product_packs where id = $1`, [legacyProduct.packId])).rows[0]!.stock_quantity)).toBe(0);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from stock_movements where product_id = $1`, [legacyProduct.productId])).rows[0]!.count).toBeGreaterThan(0);
    expect((await db.query<{ warehouse_id: string }>(`select warehouse_id from orders where id = $1`, [orderId])).rows[0]!.warehouse_id).toBe(inactiveWarehouseId);
  });
});
