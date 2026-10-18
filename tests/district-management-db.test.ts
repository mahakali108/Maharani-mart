import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let admin: string, owner: string, other: string, saran: string, legacy: string, address: string;
beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  const created = await as(db, admin, (tx) => tx.query<{ id: string; district: string }>(
    `insert into areas (name) values ('Verified fixture area') returning id, district`));
  saran = created.rows[0]!.id;
  const old = await as(db, admin, (tx) => tx.query<{ id: string }>(
    `insert into areas (name, district) values ('Legacy fixture area', 'Khagaria') returning id`));
  legacy = old.rows[0]!.id;
  owner = (await createRetailer(db, { areaId: legacy })).id;
  other = (await createRetailer(db, { areaId: saran })).id;
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('district persistence and real PostgreSQL boundaries', () => {
  it('creates new areas in Gaya without rewriting legacy districts', async () => {
    const { rows } = await as(db, admin, (tx) => tx.query<{ id: string; district: string }>('select id, district from areas where id in ($1, $2)', [saran, legacy]));
    expect(rows.find((r) => r.id === saran)?.district).toBe('Gaya');
    expect(rows.find((r) => r.id === legacy)?.district).toBe('Khagaria');
  });
  it('registration derives district from the selected active area, not client metadata', async () => {
    const id = await createUser(db, 'retailer', 'New registration', { areaId: legacy });
    const { rows } = await db.query<{ district: string; status: string }>(
      'select a.district, r.status from retailers r join areas a on a.id=r.area_id where r.id=$1', [id]);
    expect(rows[0]).toEqual({ district: 'Khagaria', status: 'pending_approval' });
  });
  it('admin reassignment survives a fresh authenticated transaction and filters correctly', async () => {
    await as(db, admin, (tx) => tx.query('update retailers set area_id=$1 where id=$2', [saran, owner]));
    const read = () => as(db, owner, (tx) => tx.query<{ district: string }>(
      'select a.district from retailers r join areas a on a.id=r.area_id where r.id=$1', [owner]));
    expect((await read()).rows[0]?.district).toBe('Gaya');
    expect((await read()).rows[0]?.district).toBe('Gaya');
    const filtered = await as(db, admin, (tx) => tx.query<{ id: string }>(
      'select r.id from retailers r join areas a on a.id=r.area_id where a.district=$1', ['Gaya']));
    expect(filtered.rows.map((r) => r.id)).toContain(owner);
  });
  it('retailers cannot self-reassign service areas', async () => {
    const result = await as(db, owner, (tx) => tx.query('update retailers set area_id=$1 where id=$2 returning id', [legacy, owner]));
    expect(result.rows).toEqual([]);
    const reloaded = await as(db, owner, (tx) => tx.query<{ area_id: string }>('select area_id from retailers where id=$1', [owner]));
    expect(reloaded.rows[0]?.area_id).toBe(saran);
  });
  it('retailers and anonymous callers cannot create or edit the area directory', async () => {
    expect(await errorOf(db, owner, (tx) => tx.query("insert into areas (name, district) values ('Forged area', 'Saran')"))).toBeTruthy();
    expect(await errorOf(db, 'anon', (tx) => tx.query("insert into areas (name, district) values ('Anonymous area', 'Saran')"))).toBeTruthy();
    const { rows } = await as(db, owner, (tx) => tx.query('update areas set district=$1 where id=$2 returning id', ['Wrong', saran]));
    expect(rows).toEqual([]);
  });
  it('owner can create, edit and reload an independent delivery district', async () => {
    const { rows } = await as(db, owner, (tx) => tx.query<{ id: string }>(
      `insert into retailer_addresses (retailer_id, receiver_name, phone, line1, city, district, pincode)
       values ($1, 'Fixture owner', '9000000000', 'Fixture road', 'Town', 'Patna', '800001') returning id`, [owner]));
    address = rows[0]!.id;
    await as(db, owner, (tx) => tx.query('update retailer_addresses set district=$1 where id=$2', ['Khagaria', address]));
    const reloaded = await as(db, owner, (tx) => tx.query<{ district: string }>('select district from retailer_addresses where id=$1', [address]));
    expect(reloaded.rows[0]?.district).toBe('Khagaria');
    const assigned = await as(db, owner, (tx) => tx.query<{ area_id: string }>('select area_id from retailers where id=$1', [owner]));
    expect(assigned.rows[0]?.area_id).toBe(saran);
  });
  it('another retailer cannot read, edit or take ownership of that address', async () => {
    expect((await as(db, other, (tx) => tx.query('select * from retailer_addresses where id=$1', [address]))).rows).toEqual([]);
    expect((await as(db, other, (tx) => tx.query('update retailer_addresses set district=$1 where id=$2 returning id', ['Wrong', address]))).rows).toEqual([]);
    expect(await errorOf(db, owner, (tx) => tx.query('update retailer_addresses set retailer_id=$1 where id=$2', [other, address]))).toBeTruthy();
  });
});
