-- ============================================================================
-- Rollback of 0105: removes ONLY the pages this seed created (by slug), together
-- with their sections, internal notes and revision rows (ON DELETE CASCADE).
--
-- A page that no longer exactly matches the seeded content is left in place:
-- once an editor has changed it, it is their content, not the seed's. Pages
-- created in /admin/content are never touched.
-- ============================================================================

delete from public.site_pages
 where slug in ($seed$terms$seed$, $seed$privacy$seed$, $seed$returns$seed$, $seed$shipping$seed$, $seed$damaged-goods$seed$, $seed$seller-agreement$seed$, $seed$retailer-terms$seed$, $seed$marketplace-disclaimer$seed$, $seed$grievance$seed$, $seed$business-disclosure$seed$, $seed$gst-pricing-invoice$seed$, $seed$product-safety$seed$, $seed$prohibited-products$seed$, $seed$ip-complaints$seed$, $seed$suspension-termination$seed$, $seed$cookies$seed$, $seed$coins-loyalty$seed$, $seed$about$seed$, $seed$contact$seed$)
   and is_system = true;
