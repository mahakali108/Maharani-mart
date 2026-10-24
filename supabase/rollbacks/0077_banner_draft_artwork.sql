-- ============================================================================
-- Rollback 0077 — DELIBERATELY NON-DESTRUCTIVE.
--
-- REVIEW ONLY. Not executed anywhere.
--
-- Owner decision: draft images must be preserved, including across a rollback.
-- This file therefore performs NO schema change and NO storage change:
--
--   * no storage object is deleted;
--   * the `banner-drafts` bucket and its four policies stay in place;
--   * both additive columns stay in place, because dropping `draft_image_path`
--     would discard the only mapping from a banner row to its draft object and
--     orphan artwork that still exists in Storage;
--   * no existing public `banners` object, URL or policy is touched.
--
-- Once the application stops reading the draft columns they are inert: both are
-- nullable and nothing else references them.
--
-- A full removal (the "drop it completely" path) is a SEPARATE, manually
-- approved procedure — deliberately not automated here:
--
--   1. export draft_image_path / draft_image_mobile_path for every row;
--   2. download or re-attach every referenced object;
--   3. only then delete the objects, the four policies, the bucket and the
--      two columns, in that order.
--
-- That procedure destroys data. It must never run as part of a rollback.
-- ============================================================================

do $$
begin
  raise notice 'Rollback 0077 is intentionally a no-op. The banner-drafts bucket, its policies and the draft_image_path columns are preserved so unpublished artwork is never lost. See the manual-removal procedure documented at the top of this file.';
end;
$$;
