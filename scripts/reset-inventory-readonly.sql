-- READ-ONLY RESET INVENTORY — NOT A RESET SCRIPT.
-- Returns metadata only for public, auth and storage tables, foreign keys,
-- row-security flags and non-internal triggers. Output can contain sensitive
-- schema names: store it in an access-controlled location. This intentionally
-- cannot delete data, export Storage bytes, certify a backup, classify tables,
-- discover external writers, or authorize a reset. Review against the actual
-- deployed project and supplement with policies, routines, configuration and a
-- separately verified data/object inventory before any destructive design.
-- Do not replace this with retention cleanup: even its dry run writes audit data.
with target_tables as (
  select c.oid, n.nspname as schema_name, c.relname as table_name,
         c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'p')
), foreign_keys as (
  select sn.nspname as source_schema, src.relname as source_table,
         dn.nspname as target_schema, dst.relname as target_table,
         con.conname as constraint_name, con.confdeltype as delete_action
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class src on src.oid = con.conrelid
  join pg_catalog.pg_namespace sn on sn.oid = src.relnamespace
  join pg_catalog.pg_class dst on dst.oid = con.confrelid
  join pg_catalog.pg_namespace dn on dn.oid = dst.relnamespace
  where con.contype = 'f'
    and (con.conrelid in (select oid from target_tables)
      or con.confrelid in (select oid from target_tables))
), triggers as (
  select tbl.schema_name, tbl.table_name, t.tgname as trigger_name,
         t.tgenabled as enabled
  from pg_catalog.pg_trigger t
  join target_tables tbl on tbl.oid = t.tgrelid
  where not t.tgisinternal
)
select jsonb_build_object(
  'tables', coalesce((select jsonb_agg(to_jsonb(t) - 'oid' order by schema_name, table_name) from target_tables t), '[]'::jsonb),
  'foreign_keys', coalesce((select jsonb_agg(to_jsonb(f) order by source_schema, source_table, constraint_name) from foreign_keys f), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(to_jsonb(t) order by schema_name, table_name, trigger_name) from triggers t), '[]'::jsonb)
) as inventory;
