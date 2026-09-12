-- ============================================================================
-- 0040: schemes audit trigger (Phase 2)
--
-- WHY
-- ---
-- The `schemes` table (0001) and its RLS (0013) exist, the retailer app
-- and Maharani AI read active schemes, but no admin UI could ever manage
-- them and the table had no audit trail. Phase 2 adds the scheme
-- management UI (/admin/pricing/schemes); before that ships, every change
-- to a scheme must land in audit_logs like every other pricing surface
-- (products, price_lists, product_pricing_tiers all have triggers).
--
-- Additive & re-runnable: drop-if-exists + create, nothing else touched.
-- ============================================================================

drop trigger if exists trg_audit_schemes on schemes;
create trigger trg_audit_schemes after insert or update or delete on schemes
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
