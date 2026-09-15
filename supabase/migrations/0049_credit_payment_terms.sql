-- ============================================================================
-- 0049: Credit payment terms (Net-15 / Net-30 / …)
--
-- WHY
-- ---
-- The wallet ledger showed limit / outstanding / available but not the
-- payment TERMS. A B2B retailer needs to know "Net 15" or "Net 30" and the
-- resulting DUE DATE. The due date itself is derived in the app from the
-- oldest still-outstanding ledger debit + the terms — nothing is stored per
-- debit, so a terms change never rewrites history.
--
-- MODEL
-- * ONE nullable `payment_terms_days` on the existing
--   `retailer_credit_accounts` row (which is already admin-writable and
--   retailer-self-readable — no new RLS surface).
-- * NULL = no terms configured (the common case today). The retailer UI then
--   shows "Terms not set" and never invents a due date.
-- * 0 = due on order (cash terms). 1..365 = Net-N.
--
-- SAFETY: additive & re-runnable; one nullable column + one check constraint;
--   no existing column touched; no data seeded; no RLS weakened.
-- ============================================================================

alter table retailer_credit_accounts
  add column if not exists payment_terms_days int;

-- Re-runnable: drop+add so a partial earlier run can never leave a
-- malformed constraint behind.
alter table retailer_credit_accounts
  drop constraint if exists retailer_credit_accounts_payment_terms_check;

alter table retailer_credit_accounts
  add constraint retailer_credit_accounts_payment_terms_check
  check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 365));

comment on column retailer_credit_accounts.payment_terms_days is
  'Payment terms in days (Net-N). NULL = no terms configured; 0 = due on order; 1..365 = Net-N. Due dates are derived by the app from the oldest still-outstanding ledger debit + this value.';

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
