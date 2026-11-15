# Supabase security-advisor repair — migration 0103

## Scope

This repair follows the read-only audit of the official Supabase project
`fhrmsrumsraprvutrpeo` on 2026-11-15. The repository and remote migration
history matched exactly: 99 files and 99 applied versions, through 0102.
There are no unapplied repository migrations. Version labels 0061, 0075 and
0076 are absent from both sides; they are numbering gaps, not failed runs.

## Changes

- Convert four staff-only analytics views to PostgreSQL 15+ SECURITY INVOKER
  views. Remove anonymous SELECT and retain authenticated SELECT. Grant
  authenticated SELECT on `products`; the existing 0102 RLS policy remains
  the row gate, and the view predicate remains staff-only.
- Pin search_path on the 14 functions reported by the live advisor.
- Revoke API EXECUTE on 12 trigger-only SECURITY DEFINER functions and the
  `rls_auto_enable()` event-trigger function. Trigger execution is not
  gated by caller EXECUTE privileges.
- Preserve anonymous EXECUTE on functions referenced by PUBLIC RLS policies,
  the public registration pre-check, and public supplier application endpoint.
- Keep the five service_role-only tables without policies. They have RLS
  enabled and no anon/authenticated table grants; this is the intended
  fail-closed configuration, not a missing access policy.
- Do not attempt to relocate `pg_net`: the live extension reports
  `extrelocatable = false`.

## Deliberate remaining advisor findings

This migration does not suppress or weaken legitimate linter notices:

- Public SECURITY DEFINER RLS predicates and the public registration and
  supplier application endpoints remain callable by anon where current
  policy/application behaviour requires it. In particular,
  `is_phone_registered(text)` may reveal whether a phone is registered;
  rate-limiting and privacy-safe registration UX need a separate product change.
- `pg_net` remains in `public` because the installed extension is not
  relocatable. Resolve only through a supported Supabase extension migration.
- The five no-policy tables remain service_role-only by design.
- Performance advisor warnings (multiple permissive policies, auth RLS
  initplans, unindexed foreign keys and unused indexes) are not blindly
  rewritten here. They require per-table query plans and behaviour-preserving
  consolidation; unused indexes must be evaluated against write workload.

## Deployment order

1. Review this PR and its CI.
2. Back up the official project and apply migration 0103 through the normal
   Supabase migration workflow only after explicit owner approval.
3. Run the read-only verification queries and Supabase Security Advisor.
4. Keep rollback 0103 available. Rollback restores the pre-0103 grants/options
   and search_path settings; it does not touch application data.

This PR does not apply SQL to Supabase, deploy Vercel, or change production.
