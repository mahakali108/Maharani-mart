# Powder products

Powder is a normal top-level row in `categories`, provisioned idempotently by migration `0027_powder_category_and_catalog_constraints.sql`. No product or price is seeded.

A Powder product uses the existing catalog model: one `products` row, one or more `product_packs` rows for sizes such as `100g`, `250g`, or `1.5kg`, and `product_pricing_tiers` rows for configurable piece quantities. Pack labels are the retailer-facing variant identity and active duplicate labels are rejected.

`product_packs.case_price` is the GST-inclusive source of truth. Retailers order pieces; the shared case/loose pricing engine derives the applicable piece price and the server recalculates it during quote and order creation. The client never supplies trusted money values. GST is extracted from the inclusive total exactly once for invoices.

Purchase cost, generated internal pack identifiers, and case/warehouse data remain admin-only. Product images use the existing Supabase Storage media flow. A pack image is preferred and falls back to the parent product gallery.

Availability continues to use the existing inventory model and its known limitation: inventory is currently tracked at product/warehouse and batch level, not as a separate pack-level stock ledger. Retailers see catalog availability without internal stock identifiers.
