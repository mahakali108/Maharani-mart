-- ============================================================================
-- ROLLBACK for 0081 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- This restores the pre-0081 API surface. It deliberately does NOT delete the
-- audit trail or the application history: those rows are business evidence and
-- a rollback of the feature is not a licence to destroy records. Choose the
-- retention option explicitly with the owner before running anything.
--
-- Order matters (functions -> triggers -> tables -> column).
-- ============================================================================

begin;

-- Feature surface
drop function if exists public.retailer_resubmit_application(text, text, text, uuid);
drop function if exists public.admin_set_retailer_access(uuid, text, text);
drop function if exists public.admin_set_retailer_category(uuid, text, text);
drop function if exists public.admin_review_retailer_application(uuid, text, text, text);
drop function if exists public.admin_update_approval_settings(int, int);

drop trigger if exists trg_guard_retailer_sensitive_columns on public.retailers;
drop function if exists public.guard_retailer_sensitive_columns();
drop trigger if exists trg_ensure_retailer_application on public.retailers;
drop function if exists public.ensure_retailer_application();
drop trigger if exists trg_retailer_approval_events_immutable on public.retailer_approval_events;
drop function if exists public.retailer_approval_events_immutable();

-- Data (EXPLICIT OWNER DECISION REQUIRED — commented out by default)
-- drop table if exists public.retailer_approval_events;
-- drop table if exists public.retailer_applications;
-- delete from public.retailers where false; -- never mass-delete retailers

drop table if exists public.retailer_approval_settings;

alter table public.retailers drop column if exists retailer_category;
-- The enum is left in place: dropping a type that other objects may reference
-- is riskier than leaving an unused type behind.
-- drop type if exists public.retailer_category;

-- restore 0083's dependency-free state is not required: 0083 owns membership.

commit;
