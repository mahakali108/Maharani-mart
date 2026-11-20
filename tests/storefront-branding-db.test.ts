import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { as, createMigratedDb, createUser } from './helpers/pg-harness';

it('keeps draft history private and publishes immutable admin-attributed snapshots', async () => {
  const db = await createMigratedDb();
  try {
    const admin = await createUser(db, 'super_admin'), retailer = await createUser(db, 'retailer');
    const draft = "select record_storefront_brand('Store','Hello',null)";
    await expect(as(db, retailer, tx => tx.query(draft))).rejects.toThrow();
    await as(db, admin, tx => tx.query(draft));
    const ordinaryAdmin = await createUser(db, 'admin');
    const disabledAdmin = await createUser(db, 'super_admin');
    await db.query('update profiles set is_active=false where id=$1', [disabledAdmin]);
    for (const user of ['anon', ordinaryAdmin, disabledAdmin]) {
      await expect(as(db, user, tx => tx.query('select record_storefront_brand(null,null,1)'))).rejects.toThrow();
    }
    const publicView = () => as(db, retailer, tx => tx.query('select * from published_storefront_brand()'));
    expect((await publicView()).rows).toEqual([]);
    expect((await as(db, retailer, tx => tx.query('select * from storefront_brand_versions'))).rows).toEqual([]);
    await as(db, admin, tx => tx.query('select record_storefront_brand(null,null,1)'));
    expect((await publicView()).rows).toEqual([{ display_name: 'Store', tagline: 'Hello' }]);
    await expect(as(db, admin, tx => tx.query("update storefront_brand_versions set tagline='rewrite'"))).rejects.toThrow();
    expect((await as(db, admin, tx => tx.query('select actor from storefront_brand_versions order by id'))).rows).toEqual([{actor:admin},{actor:admin}]);
    // A lost RPC reply must not allow the original form to publish twice.
    await expect(as(db, admin, tx => tx.query('select record_storefront_brand(null,null,1,null)'))).rejects.toThrow('refresh history');
    await as(db, admin, tx => tx.query("select record_storefront_brand('Updated','Welcome',null)"));
    await as(db, admin, tx => tx.query('select record_storefront_brand(null,null,3,2)'));
    await as(db, admin, tx => tx.query('select record_storefront_brand(null,null,2,4)'));
    expect((await publicView()).rows).toEqual([{display_name:'Store',tagline:'Hello'}]);
    expect((await db.query('select operation,source_id from storefront_brand_versions where id=5')).rows).toEqual([{operation:'restore',source_id:2}]);
    const history = 'select * from storefront_brand_versions order by id';
    const beforeReplay = (await db.query(history)).rows;
    await db.exec(readFileSync('supabase/migrations/0111_storefront_branding.sql','utf8'));
    expect((await db.query(history)).rows).toEqual(beforeReplay);
    await expect(as(db, retailer, tx => tx.query(draft))).rejects.toThrow();
    const down = readFileSync('supabase/rollbacks/0111_storefront_branding.down.sql','utf8');
    await expect(db.exec(down)).rejects.toThrow('Refusing'); await db.exec('rollback');
    expect((await publicView()).rows).toHaveLength(1);
    await db.exec("set maharani.allow_data_loss='true'"); await db.exec(down);
    await db.exec(down); // replay after removal
    expect((await db.query("select to_regclass('public.storefront_brand_versions') as rel")).rows).toEqual([{rel:null}]);
  } finally { await db.close(); }
}, 180000);
