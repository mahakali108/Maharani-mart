-- Rollback for 0060_supplier_application_rate_limit.sql.
-- Safe by construction: the table contains only SHA-256 key hashes,
-- bucket names, window timestamps and counters — no supplier application
-- data, no PII, and it is referenced by no other object. Dropping it
-- removes rate-limit state only (throttling resets; the public form
-- falls back to its in-memory limiter). It touches no other table,
-- bucket, policy or function.
revoke all on function consume_supplier_application_rate_limit(text, text, int, int) from service_role, anon, authenticated;
drop function if exists consume_supplier_application_rate_limit(text, text, int, int);
drop table if exists supplier_application_rate_limits;
