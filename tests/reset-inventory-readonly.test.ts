import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMigratedDb } from './helpers/pg-harness';

type Inventory = {
  tables: { schema_name: string; table_name: string; rls_enabled: boolean }[];
  foreign_keys: { source_schema: string; source_table: string; target_schema: string; target_table: string }[];
  triggers: { schema_name: string; table_name: string; trigger_name: string }[];
};

describe('read-only reset inventory (not a reset)', () => {
  it('reports actual migrated dependencies and leaves representative data unchanged', async () => {
    const db = await createMigratedDb();
    try {
      await db.exec("insert into public.areas (name) values ('Inventory control'); create schema external_dependency; create table external_dependency.area_refs (area_id uuid references public.areas(id));");
      const sql = readFileSync('scripts/reset-inventory-readonly.sql', 'utf8');
      const before = await db.query<{ count: number }>('select count(*)::int as count from public.areas');
      // Enforce read-only at the database level as well as reviewing the SQL.
      const result = await db.transaction(async (tx) => {
        await tx.exec('set transaction read only');
        return tx.query<{ inventory: Inventory }>(sql);
      });
      const after = await db.query<{ count: number }>('select count(*)::int as count from public.areas');
      expect(after.rows).toEqual(before.rows);
      const inventory = result.rows[0]!.inventory;
      expect(inventory.tables).toEqual(expect.arrayContaining([
        expect.objectContaining({ schema_name: 'public', table_name: 'profiles', rls_enabled: true }),
        expect.objectContaining({ schema_name: 'auth', table_name: 'users' }),
        expect.objectContaining({ schema_name: 'storage', table_name: 'buckets' }),
      ]));
      expect(inventory.foreign_keys).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_schema: 'public', source_table: 'profiles', target_schema: 'auth', target_table: 'users' }),
        expect.objectContaining({ source_schema: 'external_dependency', source_table: 'area_refs', target_schema: 'public', target_table: 'areas' }),
      ]));
      expect(inventory.triggers.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  }, 60000);
});
