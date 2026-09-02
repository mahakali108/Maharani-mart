import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock,
  FileText,
  Package,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { caseLineBreakdown } from '@/lib/retailer/case-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { buildVariantSwitcher, isUuidLike, variantGalleryImages } from '@/lib/retailer/variants';
import { PackSelector } from '@/components/retailer/pack-selector';
import { VariantSwitcher } from '@/components/retailer/variant-switcher';
import { FavoriteToggle } from '@/components/retailer/favorite-toggle';
import { ProductGallery } from '@/components/retailer/product-gallery';
import { ProductRail } from '@/components/retailer/product-rail';
import { RecentlyViewedRail, RecentlyViewedTracker } from '@/components/retailer/recently-viewed';
import { loadFavoriteIds } from '@/lib/retailer/catalog';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';
import { getCoPurchasedCards, getSimilarProductCards } from '@/lib/retailer/personalization';

interface ProductDetailRow {
  id: string;
  name: string;
  unit: string;
  units_per_case: number;
  gst_percent: number;
  hsn_code: string | null;
  lead_time_days: number;
  is_new_launch: boolean;
  brand_id: string | null;
  category_id: string | null;
  brands: { name: string } | null;
  categories: { id: string; name: string } | null;
  product_images: { id: string; image_url: string; sort_order: number }[];
}

interface PackRow {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  ptr: number | null;
  case_price: number;
  mrp: number | null;
  moq: number;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
}

interface CartItemRow {
  id: string;
  pack_id: string;
  quantity: number;
  product_id: string;
  product_packs: {
    id: string;
    pack_name: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    units_per_case: number;
    mrp: number | null;
    moq: number;
    is_active: boolean;
  } | null;
  products: {
    gst_percent: number;
    is_active: boolean;
  } | null;
}

interface SchemeLinkRow {
  id: string;
  schemes: { name: string; description: string | null; ends_at: string; is_festival: boolean; is_active: boolean } | null;
}

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  if (!isUuidLike(params.id)) notFound();

  // The route identifies either the parent product (/retailer/catalog/<product>)
  // or one exact variant (/retailer/catalog/<pack>) — the URL the size
  // switcher navigates to. Both render this same product detail page; a pack
  // id additionally pins the selected variant. RLS already hides inactive
  // packs from retailers here, so an unknown/inactive variant route 404s.
  let productId = params.id;
  let requestedPackId: string | null = null;
  {
    const { data: productRef } = await supabase
      .from('products')
      .select('id')
      .eq('id', params.id)
      .eq('is_active', true)
      .maybeSingle<{ id: string }>();
    if (productRef) {
      productId = productRef.id;
    } else {
      const { data: packRef } = await supabase
        .from('product_packs')
        .select('id, product_id')
        .eq('id', params.id)
        .maybeSingle<{ id: string; product_id: string }>();
      if (!packRef) notFound();
      requestedPackId = packRef.id;
      productId = packRef.product_id;
    }
  }

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  const nowIso = new Date().toISOString();
  const [{ data: product }, { data: packData }, favoriteIds, { data: cartData }] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, name, unit, units_per_case, gst_percent, hsn_code, lead_time_days, is_new_launch, brand_id, category_id, brands ( name ), categories ( id, name ), product_images ( id, image_url, sort_order )'
      )
      .eq('id', productId)
      .eq('is_active', true)
      .maybeSingle<ProductDetailRow>(),
    supabase
      .from('product_packs')
      .select('id, pack_name, pack_sku_code, units_per_case, base_price, ptr, case_price, mrp, moq, image_url, is_active, sort_order')
      .eq('product_id', productId)
      .order('sort_order')
      .returns<PackRow[]>(),
    loadFavoriteIds(supabase, user.id),
    supabase
      .from('cart_items')
      .select(
        'id, pack_id, quantity, product_id, product_packs ( id, pack_name, base_price, ptr, case_price, units_per_case, mrp, moq, is_active ), products ( gst_percent, is_active )'
      )
      .eq('retailer_id', user.id)
      .returns<CartItemRow[]>(),
  ]);

  if (!product) notFound();

  const [{ data: schemeRows }, override, similar, together] = await Promise.all([
    supabase
      .from('price_lists')
      .select('id, schemes ( name, description, ends_at, is_festival, is_active )')
      .eq('product_id', productId)
      .in('scope', ['scheme', 'festival'])
      .eq('is_active', true)
      .lte('valid_from', nowIso)
      .returns<SchemeLinkRow[]>(),
    getProductPriceOverride(supabase, productId, user.id, retailer?.area_id ?? null),
    getSimilarProductCards(
      supabase,
      user.id,
      retailer?.area_id ?? null,
      { id: product.id, category_id: product.category_id, brand_id: product.brand_id },
      favoriteIds
    ),
    getCoPurchasedCards(supabase, user.id, retailer?.area_id ?? null, product.id, favoriteIds),
  ]);

  // Compute cart summary using existing authoritative pricing & tax rules
  const cartItems = (cartData ?? []) as CartItemRow[];
  const cartProductIds = [...new Set(cartItems.map((item) => item.product_id))];
  const cartOverrides = await getProductPriceOverrides(
    supabase,
    cartProductIds,
    user.id,
    retailer?.area_id ?? null
  );

  // Map product packs with authoritative case prices, tiers and existing cart items.
  // Only ACTIVE packs are orderable — they feed the PackSelector exactly as before.
  const rawPacks = (packData ?? []) as PackRow[];
  const activePacks = rawPacks.filter((pack) => pack.is_active);
  const packTiers = await loadPackTiers(
    supabase,
    rawPacks.map((pack) => pack.id)
  );

  let cartSubtotal = 0;
  let cartGstTotal = 0;
  let cartSavingsTotal = 0;
  let cartTotalPacks = 0;
  const cartItemByPackId = new Map<string, { id: string; quantity: number }>();

  for (const item of cartItems) {
    cartItemByPackId.set(item.pack_id, { id: item.id, quantity: item.quantity });
    cartTotalPacks += item.quantity;
    const p = item.product_packs;
    const pr = item.products;
    if (p && pr) {
      const casePrice = resolvePackPrice(p, cartOverrides.get(item.product_id) ?? null);
      const breakdown = caseLineBreakdown({
        casePrice,
        unitsPerCase: p.units_per_case ?? 1,
        tiers: packTiers.get(item.pack_id) ?? [],
        packQuantity: item.quantity,
        gstPercent: pr.gst_percent ?? 0,
      });
      cartSubtotal += breakdown.subtotal;
      cartGstTotal += breakdown.gst;
      cartSavingsTotal += calcSavings(p.mrp, breakdown.piecePrice, breakdown.pieces);
    }
  }

  const cartGrandTotal = cartSubtotal + cartGstTotal;
  const cartSummary =
    cartTotalPacks > 0
      ? {
          itemCount: cartTotalPacks,
          grandTotal: cartGrandTotal,
          savings: cartSavingsTotal,
        }
      : null;

  // Map product packs with authoritative case prices, tiers and existing cart items
  const packs = activePacks.map((pack) => {
    const effectivePrice = resolvePackPrice(pack, override);
    const cartInfo = cartItemByPackId.get(pack.id);
    return {
      ...pack,
      effectivePrice,
      casePrice: effectivePrice,
      tiers: packTiers.get(pack.id) ?? [],
      initialQuantity: cartInfo?.quantity ?? 0,
      cartItemId: cartInfo?.id ?? null,
    };
  });

  // ---------------------------------------------------------------------------
  // Selected variant (pack) — the size switcher's current size.
  //   /retailer/catalog/<packId>    -> that exact variant is highlighted
  //   /retailer/catalog/<productId> -> existing default (cheapest active pack)
  // Every variant-specific value below (image, MRP, case price, units per
  // case, tiers, discount) is read from the SELECTED pack; the product-level
  // price override still applies to all packs of the product unchanged.
  // ---------------------------------------------------------------------------
  const urlPack = requestedPackId ? rawPacks.find((pack) => pack.id === requestedPackId) ?? null : null;
  if (requestedPackId && !urlPack) notFound();

  const lowestPrice = packs.length > 0 ? Math.min(...packs.map((pack) => pack.effectivePrice)) : null;
  const defaultPack = packs.find((pack) => pack.effectivePrice === lowestPrice) ?? packs[0] ?? null;
  const selectedPack = urlPack ?? defaultPack;
  const isViewingVariant = urlPack !== null;

  // Selected variant's authoritative numbers (GST-inclusive case price is the
  // source of truth; the per-piece price is derived, never stored).
  const selectedCasePrice = selectedPack ? resolvePackPrice(selectedPack, override) : null;
  // MRP is per piece; effectivePrice is the GST-inclusive case price — compare on a per-piece basis.
  const selectedPiecePrice =
    selectedCasePrice !== null && (selectedPack?.units_per_case ?? 1) > 0
      ? selectedCasePrice / (selectedPack?.units_per_case ?? 1)
      : selectedCasePrice;
  const selectedTiers = selectedPack ? packTiers.get(selectedPack.id) ?? [] : [];
  const discount = calcDiscountPercent(selectedPack?.mrp, selectedPiecePrice);
  const saveAmount = calcSavings(selectedPack?.mrp, selectedPiecePrice);
  const selectedAvailable = selectedPack?.is_active ?? false;
  const variantSwitcher = buildVariantSwitcher(rawPacks, selectedPack?.id ?? null);

  // Main image: the selected variant's own image when it has one, otherwise
  // the parent product's existing gallery (existing fallback behaviour).
  const productImages = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);
  const images = variantGalleryImages(selectedPack, productImages);
  const galleryAlt = [product.name, selectedPack?.pack_name].filter(Boolean).join(' — ');
  const schemes = (schemeRows ?? [])
    .map((row) => row.schemes)
    .filter((scheme): scheme is NonNullable<SchemeLinkRow['schemes']> => !!scheme && scheme.is_active);

  return (
    <div className="space-y-5 pb-20 sm:space-y-6 lg:pb-8">
      <RecentlyViewedTracker productId={product.id} />

      {/* Breadcrumb Navigation */}
      <nav
        className="flex items-center gap-1.5 overflow-hidden text-[10px] font-semibold text-slate-500 sm:text-xs"
        aria-label="Breadcrumb"
      >
        <Link href="/retailer/catalog" className="flex shrink-0 items-center gap-1 hover:text-primary-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Products
        </Link>
        {product.categories ? (
          <>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <Link
              href={`/retailer/catalog?category=${product.categories.id}`}
              className="shrink-0 hover:text-primary-600"
            >
              {product.categories.name}
            </Link>
          </>
        ) : null}
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate text-slate-800">{product.name}</span>
      </nav>

      {/* Main Responsive Grid Layout */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1.15fr)] lg:gap-8">
        {/* Left Column: 1. Product Image / Gallery & Desktop Quick Summary */}
        <div className="space-y-4 lg:sticky lg:top-36">
          {/* 1. PRODUCT IMAGE / GALLERY */}
          <section aria-label="Product Gallery">
            <ProductGallery
              name={galleryAlt}
              images={images}
              badges={
                <>
                  {discount > 0 ? (
                    <span className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm">
                      {discount}% WHOLESALE SAVING
                    </span>
                  ) : null}
                  {product.is_new_launch ? (
                    <span className="rounded-lg bg-primary-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm">
                      NEW LAUNCH
                    </span>
                  ) : null}
                  {schemes.length > 0 ? (
                    <span className="rounded-lg bg-amber-400 px-2.5 py-1.5 text-[10px] font-bold text-slate-950 shadow-sm">
                      OFFER
                    </span>
                  ) : null}
                </>
              }
              favoriteSlot={<FavoriteToggle productId={product.id} initialFavorite={favoriteIds.has(product.id)} compact />}
            />
          </section>

          {/* Desktop Mini-Cart Summary Box (shown when items in cart) */}
          {cartSummary && cartSummary.itemCount > 0 ? (
            <aside
              aria-label="Desktop Cart Summary"
              className="hidden rounded-2xl border border-primary-200 bg-gradient-to-br from-white to-primary-50/40 p-4 shadow-sm lg:block"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white">
                    <ShoppingCart className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Your Cart</h3>
                    <p className="text-[10px] text-slate-500">
                      {cartSummary.itemCount} pack{cartSummary.itemCount === 1 ? '' : 's'} selected
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-base font-extrabold tracking-tight text-slate-950">
                    {formatInr(cartSummary.grandTotal)}
                  </p>
                  {cartSummary.savings > 0 ? (
                    <p className="text-[10px] font-semibold text-emerald-700">
                      Save {formatInr(cartSummary.savings)} vs MRP
                    </p>
                  ) : null}
                </div>
              </div>
              <Link
                href="/retailer/cart"
                className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
              >
                Review Cart & Checkout <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </aside>
          ) : null}
        </div>

        {/* Right Column: 2. Product Name, 3. Brand, 4. MRP, 5. Multi-Price Tiers, 6. Delivery, 7. Details */}
        <div className="space-y-5">
          {/* Header Card: Brand, Name, and MRP / Wholesale Reference Price */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            {/* 3. BRAND & AVAILABILITY */}
            <div className="flex flex-wrap items-center gap-2">
              {product.brands?.name ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                  {product.brands.name}
                </span>
              ) : null}
              {selectedAvailable ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Available to order
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                  <CircleAlert className="h-3.5 w-3.5 text-amber-600" /> Currently unavailable
                </span>
              )}
            </div>

            {/* 2. PRODUCT NAME */}
            <h1 className="mt-3 text-xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-2xl lg:text-3xl">
              {product.name}
            </h1>

            {/* SIZE / VARIANT SWITCHER — navigates to each variant's own route */}
            <VariantSwitcher model={variantSwitcher} productName={product.name} />

            {/* 4. MRP & WHOLESALE PRICE OVERVIEW — for the SELECTED variant */}
            {selectedCasePrice !== null ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {isViewingVariant ? `Case price · ${selectedPack?.pack_name}` : 'Case price from'}
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-2">
                  <p className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                    {formatInr(selectedCasePrice)}
                  </p>
                  {selectedPack && selectedPack.units_per_case > 1 ? (
                    <p className="text-sm font-semibold text-slate-500 sm:text-base">
                      {formatInr(selectedCasePrice / selectedPack.units_per_case)}/pc · {selectedPack.units_per_case} pcs
                    </p>
                  ) : null}
                  {selectedPack?.mrp && selectedPiecePrice != null && selectedPack.mrp > selectedPiecePrice ? (
                    <p className="text-sm font-medium text-slate-400 line-through sm:text-base">
                      MRP {formatInr(selectedPack.mrp)}
                    </p>
                  ) : null}
                  {discount > 0 ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                      {discount}% off MRP
                    </span>
                  ) : null}
                </div>
                {saveAmount > 0 ? (
                  <p className="mt-1 text-xs font-bold text-emerald-700 sm:text-sm">
                    You save {formatInr(saveAmount)} on wholesale pricing
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] text-slate-500">
                  GST {product.gst_percent}% included in the case price · Quantity-based bulk discounts apply automatically
                </p>
                {/* Selected variant's quantity slabs (product_pricing_tiers for THIS pack) */}
                {selectedTiers.filter((tier) => tier.is_active !== false && tier.rule_type === 'bulk').length > 0 ? (
                  <ul className="mt-2.5 space-y-1 rounded-xl bg-slate-50 p-2.5" aria-label="Quantity tier pricing for this size">
                    {selectedTiers
                      .filter((tier) => tier.is_active !== false && tier.rule_type === 'bulk')
                      .sort((a, b) => a.min_quantity - b.min_quantity)
                      .map((tier) => (
                        <li key={tier.id ?? tier.min_quantity} className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                          <span>
                            {tier.min_quantity}
                            {tier.max_quantity != null ? `–${tier.max_quantity - 1}` : '+'} pcs
                          </span>
                          <span className="text-slate-900">{formatInr(tier.price_per_piece)}/pc</span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* 5. MULTI-PRICE / MULTI-PACK TIERS */}
          <PackSelector
            packs={packs}
            gstPercent={product.gst_percent}
            productName={product.name}
            cartSummary={cartSummary}
            selectedPackId={selectedPack?.id ?? null}
          />

          {/* 6. DELIVERY INFORMATION */}
          <section
            aria-label="Delivery Information"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="mb-3 flex items-center gap-2 text-slate-900">
              <Truck className="h-4 w-4 text-primary-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">Delivery Information</h2>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <div>
                  <p className="text-xs font-bold text-slate-800">Typical lead time</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{product.lead_time_days} day(s) to store doorstep</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <div>
                  <p className="text-xs font-bold text-slate-800">Local FMCG Distribution</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Direct warehouse dispatch, Khagaria</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <div>
                  <p className="text-xs font-bold text-slate-800">MOQ Protected</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Pack minimum order verified server-side</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />
                <div>
                  <p className="text-xs font-bold text-slate-800">GST Transparent</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{product.gst_percent}% GST shown on invoice</p>
                </div>
              </div>
            </div>
          </section>

          {/* 7. PRODUCT DETAILS */}
          <section
            aria-label="Product Details"
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="mb-3 flex items-center gap-2 text-slate-900">
              <FileText className="h-4 w-4 text-primary-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">Product Details</h2>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Base unit</dt>
                <dd className="mt-1 font-bold capitalize text-slate-900">{product.unit}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Standard case</dt>
                <dd className="mt-1 font-bold text-slate-900">{product.units_per_case} unit(s)</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">GST Rate</dt>
                <dd className="mt-1 font-bold text-slate-900">{product.gst_percent}%</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">HSN code</dt>
                <dd className="mt-1 font-bold font-mono text-slate-900">{product.hsn_code ?? '—'}</dd>
              </div>
            </dl>

            {/* Active Schemes / Offers if any */}
            {schemes.length > 0 ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-amber-900">
                  <Tag className="h-3.5 w-3.5 text-amber-700" />
                  <h3 className="text-xs font-bold">Active Schemes & Offers</h3>
                </div>
                <ul className="space-y-2">
                  {schemes.map((scheme) => (
                    <li key={scheme.name} className="text-xs text-amber-950">
                      <p className="font-bold">{scheme.name}</p>
                      {scheme.description ? (
                        <p className="mt-0.5 text-[11px] text-amber-900/80">{scheme.description}</p>
                      ) : null}
                      <p className="mt-0.5 text-[10px] text-amber-800">
                        Valid till{' '}
                        {new Date(scheme.ends_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {/* 8. PEOPLE ALSO BOUGHT / RECOMMENDATIONS */}
      <section aria-label="Product Recommendations" className="space-y-5 pt-2">
        <ProductRail
          eyebrow="Often ordered together"
          title="Frequently bought together"
          products={together}
        />
        <ProductRail
          eyebrow="More like this"
          title="Similar products"
          href={product.categories ? `/retailer/catalog?category=${product.categories.id}` : '/retailer/catalog'}
          products={similar}
        />
        <RecentlyViewedRail excludeId={product.id} />
      </section>

      {/* 9. CART SUMMARY / CHECKOUT ACCESS (Full Width Section) */}
      <section
        aria-label="Cart Summary and Checkout Access"
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
              <ShoppingCart className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                {cartSummary && cartSummary.itemCount > 0
                  ? `Shopping Cart (${cartSummary.itemCount} pack${cartSummary.itemCount === 1 ? '' : 's'})`
                  : 'Your Cart is currently empty'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {cartSummary && cartSummary.itemCount > 0
                  ? `Total: ${formatInr(cartSummary.grandTotal)} (incl. GST)`
                  : 'Add any pack size above to begin checkout.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/retailer/catalog"
              className="flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"
            >
              Continue shopping
            </Link>
            <Link
              href="/retailer/cart"
              className="flex h-10 items-center gap-1.5 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
            >
              Review Cart <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Security Recheck Note */}
      <div className="flex items-center justify-center gap-2 pt-2 text-[10px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
        <span>Pricing, MOQ, and inventory are rechecked when you place the order.</span>
      </div>
    </div>
  );
}
