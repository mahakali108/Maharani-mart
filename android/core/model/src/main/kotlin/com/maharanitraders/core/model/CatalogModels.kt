package com.maharanitraders.core.model

/**
 * Catalogue domain models (Phase D).
 *
 * Every value here is data the SERVER decided: prices in integer paise, pack
 * sizes, minimum order quantities and a two-state stock status. The app renders
 * them and never recomputes them — a total, a discount or an availability claim
 * invented on the device could disagree with checkout, and checkout is the only
 * thing that may commit an order.
 *
 * Nothing in this file is a permission. What a role may do stays with the
 * server-issued [NavigationPolicy] and is re-checked on every request.
 */

/**
 * Pack availability as the customer may be told about it.
 *
 * Mirrors the sanctioned status-only RPC (`get_retailer_pack_availability`),
 * which returns exactly two strings. Exact stock counts are deliberately not
 * part of this API at all, so there is no field here that could hold one.
 *
 * [UNKNOWN] is a first-class state, not a fallback for "in stock": when the
 * server could not read availability the app says so instead of promising a
 * product the warehouse may not have.
 */
enum class PackAvailability(val wireValue: String) {
  IN_STOCK("in_stock"),
  OUT_OF_STOCK("out_of_stock"),
  UNKNOWN("unknown");

  companion object {
    fun fromWire(value: String?): PackAvailability {
      val wire = value?.trim()?.lowercase() ?: return UNKNOWN
      return entries.firstOrNull { it.wireValue == wire } ?: UNKNOWN
    }
  }
}

/**
 * Catalogue sort orders the server accepts.
 *
 * `RECOMMENDED` is the existing deterministic ordering (new launches first, then
 * name) — there is no invented popularity signal behind it. Unknown wire values
 * fall back to [RECOMMENDED] rather than failing, so an older app keeps working
 * against a newer server.
 */
enum class CatalogSort(val wireValue: String, val label: String) {
  RECOMMENDED("recommended", "Recommended"),
  PRICE_LOW("price-low", "Price: low to high"),
  PRICE_HIGH("price-high", "Price: high to low"),
  DISCOUNT("discount", "Discount"),
  NEWEST("newest", "Newest"),
  FREQUENT("frequent", "Frequently ordered"),
  NAME("name", "Name: A to Z");

  companion object {
    fun fromWire(value: String?): CatalogSort {
      val wire = value?.trim()?.lowercase() ?: return RECOMMENDED
      return entries.firstOrNull { it.wireValue == wire } ?: RECOMMENDED
    }
  }
}

/**
 * The filters a catalogue list request carries.
 *
 * Identity is absent on purpose: there is no retailer id, area id or role here,
 * because the server derives all of them from the verified token. A filter set
 * is the only thing the client gets to choose.
 *
 * EVERY field below is a parameter the server actually reads
 * (`lib/mobile/catalog.ts` → `parseCatalogQuery`), and every derived filter is
 * resolved against the price the server computed for THIS retailer — a price
 * range, a discount floor or an MOQ ceiling is never applied to a raw pack
 * column on the device. `tests/android-project-integrity.test.ts` fails the
 * build if a `@Query` name is sent that the server does not read, which is what
 * keeps this list and the endpoint from drifting apart.
 */
data class CatalogQuery(
  val search: String = "",
  val categoryId: String? = null,
  val brandId: String? = null,
  val sort: CatalogSort = CatalogSort.RECOMMENDED,
  val inStockOnly: Boolean = false,
  /**
   * Restrict the list to this retailer's saved favourites.
   *
   * The server resolves "whose favourites" from the verified token — there is
   * no retailer id here — and answers the same priced catalogue rows, so the
   * favourites screen is the real catalogue filtered, not a second list that
   * could price a product differently.
   */
  val favoritesOnly: Boolean = false,
  /**
   * Price band in RUPEES, inclusive, against the per-piece rate the server
   * resolved for this retailer. `null` means unbounded — never zero, which the
   * server would read as a real bound.
   */
  val minPriceRupees: Int? = null,
  val maxPriceRupees: Int? = null,
  /**
   * Minimum MRP-to-price discount, in whole percent. The server computes it
   * from the pack's printed MRP and the resolved rate; a product with no MRP
   * simply does not match, so this filter can never claim a saving that is not
   * on the label.
   */
  val minDiscountPercent: Int? = null,
  /** Maximum minimum-order-quantity, in pieces: "nothing I must buy a case of". */
  val maxMoq: Int? = null,
  /** Only rows the server marked as carrying an offer or a real MRP discount. */
  val offersOnly: Boolean = false,
  /** Only the admin's `is_new_launch` rows. */
  val newOnly: Boolean = false,
) {
  /** Blank-for-default, so a parameter is only sent when it means something. */
  val searchParam: String? get() = search.trim().ifEmpty { null }
  val sortParam: String? get() = sort.takeIf { it != CatalogSort.RECOMMENDED }?.wireValue
  val inStockParam: String? get() = if (inStockOnly) "1" else null
  val favoritesParam: String? get() = if (favoritesOnly) "1" else null
  val offersParam: String? get() = if (offersOnly) "1" else null
  val newParam: String? get() = if (newOnly) "1" else null

  /**
   * Numeric parameters as the server's own `parseOptionalNumber` reads them.
   *
   * A non-positive bound is dropped rather than sent: `minPrice=0` would exclude
   * every unpriced product (the server compares `fromPrice === null` as a miss)
   * and silently empty a list the shopper never narrowed.
   */
  val minPriceParam: String? get() = minPriceRupees?.takeIf { it > 0 }?.toString()
  val maxPriceParam: String? get() = maxPriceRupees?.takeIf { it > 0 }?.toString()
  val discountParam: String? get() = minDiscountPercent?.takeIf { it > 0 }?.toString()
  val maxMoqParam: String? get() = maxMoq?.takeIf { it > 0 }?.toString()

  /**
   * True when any filter beyond the scope chips and the sort is active — the
   * signal the UI uses to badge "Filters" and to offer a one-tap clear.
   */
  val hasAdvancedFilters: Boolean
    get() = minPriceRupees != null || maxPriceRupees != null || minDiscountPercent != null ||
      maxMoq != null || offersOnly || newOnly

  /** Everything except scope and sort, so "Clear filters" cannot lose the category. */
  fun withAdvancedFiltersCleared(): CatalogQuery = copy(
    minPriceRupees = null,
    maxPriceRupees = null,
    minDiscountPercent = null,
    maxMoq = null,
    offersOnly = false,
    newOnly = false,
    inStockOnly = false,
  )

  companion object {
    val DEFAULT = CatalogQuery()
  }
}

/** One selling slab of a pack. Bounds are in PIECES. */
data class PriceTier(
  val minQuantity: Int,
  /** Exclusive upper bound; null when the engine extends the last slab. */
  val maxQuantity: Int?,
  val unitPricePaise: Long,
)

/**
 * The variant a catalogue card is priced at.
 *
 * `null` prices mean the server could not resolve a rate (pricing unavailable,
 * or no selling price configured). They are never defaulted to zero: a zero
 * would render as "free" and invite an order that checkout would reject.
 */
data class CatalogPack(
  val packId: String,
  /** Pack size as the retailer knows it: `500g`, `1L`, `5L Jar`. */
  val packName: String?,
  val unitsPerCase: Int?,
  /** Minimum order quantity, in pieces. */
  val moq: Int?,
  /** GST-inclusive per-piece rate at the pack's MOQ. */
  val unitPricePaise: Long?,
  val mrpPaise: Long?,
  /** Case price implied by the resolved pack price. Display only. */
  val derivedCasePricePaise: Long?,
  val tiers: List<PriceTier>,
  val availability: PackAvailability,
)

/** One product card in a catalogue list. */
data class CatalogProduct(
  val id: String,
  val name: String,
  val brandName: String?,
  /** Resolved public image URL, or null when the product has no usable image. */
  val imageUrl: String?,
  val isNewLaunch: Boolean,
  val categoryId: String?,
  val brandId: String?,
  val hasOffer: Boolean,
  val isFavorite: Boolean,
  /** Null when the product has no active pack: browse-only, never orderable. */
  val pack: CatalogPack?,
)

/** A category tile. `productCount` is null when the server could not count it. */
data class CatalogCategory(
  val id: String,
  val name: String,
  val imageUrl: String?,
  val productCount: Int?,
  val parentName: String? = null,
)

data class CatalogBrand(
  val id: String,
  val name: String,
  val logoUrl: String?,
  val productCount: Int?,
)

/**
 * An admin-published promotional banner.
 *
 * The app holds no banner of its own: this list is whatever the admin workspace
 * currently has active, in area and inside its schedule window. An empty list is
 * a normal answer, and the home screen then shows its own neutral header.
 *
 * [linkUrl] is a rooted app route or an http(s) URL — the server already refused
 * anything else. A value the app cannot open natively is simply not made
 * tappable; it is never passed to a browser surface.
 */
data class PromoBanner(
  val id: String,
  val title: String,
  val subtitle: String?,
  val imageUrl: String?,
  val ctaLabel: String?,
  val linkUrl: String?,
) {
  /** Only a rooted in-app route is navigable from the native shell. */
  val isNavigable: Boolean get() = linkUrl?.startsWith("/") == true && !linkUrl.startsWith("//")
}

/** One pack on the product detail screen, priced at its own MOQ. */
data class ProductPackDetail(
  val packId: String,
  val packName: String,
  val unitsPerCase: Int,
  val moq: Int,
  /** Catalog case/loose metadata; the current retailer cart uses one-piece increments regardless. */
  val allowLoosePieces: Boolean,
  val unitPricePaise: Long?,
  /** GST-inclusive line total at the MOQ — server-computed, never derived here. */
  val lineTotalAtMoqPaise: Long?,
  val gstPercent: Double,
  val mrpPaise: Long?,
  val derivedCasePricePaise: Long?,
  val tiers: List<PriceTier>,
  val availability: PackAvailability,
  /** True for the pack the navigation asked for. */
  val selected: Boolean,
  val images: List<String>,
  /** Non-null when the pricing engine refused this pack (below MOQ, no price…). */
  val message: String?,
)

/** One product with every active pack priced for this retailer. */
data class ProductDetail(
  val id: String,
  val name: String,
  val brandName: String?,
  val categoryId: String?,
  val categoryName: String?,
  val unit: String,
  val hsnCode: String?,
  val gstPercent: Double,
  val leadTimeDays: Int,
  val isNewLaunch: Boolean,
  val isFavorite: Boolean,
  val hasOffer: Boolean,
  val images: List<String>,
  val packs: List<ProductPackDetail>,
) {
  val selectedPack: ProductPackDetail? get() = packs.firstOrNull { it.selected } ?: packs.firstOrNull()

  /** Gallery for the detail hero: the chosen pack's images, then the product's. */
  val heroImages: List<String>
    get() {
      val packImages = selectedPack?.images.orEmpty()
      return if (packImages.isNotEmpty()) packImages else images
    }
}

/** The retailer home payload for Phase D. */
data class RetailerHome(
  val banners: List<PromoBanner>,
  val categories: List<CatalogCategory>,
  val brands: List<CatalogBrand>,
  /** First catalogue batch — the discovery rail. */
  val products: List<CatalogProduct>,
  val nextCursor: String?,
  /**
   * The admin's LIVE offers, soonest-ending first.
   *
   * These are the same `schemes` rows the offers screen reads, so the home rail
   * and that screen cannot disagree about what is running. Empty means no offer
   * is live — the rail is then simply not drawn, never replaced with invented
   * promotional copy.
   */
  val schemes: List<HomeScheme> = emptyList(),
  /**
   * True when the offer read FAILED rather than returning nothing.
   *
   * Kept apart on purpose: with [schemes] empty and this false the shop honestly
   * has no live offer; with this true the app must not claim that, so it draws no
   * offers rail and no "no offers" message.
   */
  val schemesUnavailable: Boolean = false,
) {
  /** The offers rail is drawn only from rows the admin actually published. */
  val hasOffers: Boolean get() = schemes.isNotEmpty()
}

/**
 * One live, admin-published offer.
 *
 * A scheme carries NO discount value: in this backend a scheme is a published
 * campaign window (`schemes` table) whose pricing effect is already inside the
 * per-retailer price the catalogue resolves. Rendering a percentage here would
 * be inventing a number the server never sent, so this type holds only what the
 * row actually says — the name, its optional copy, whether it is a festival
 * campaign, and when it ends.
 */
data class HomeScheme(
  val id: String,
  val name: String,
  val description: String?,
  val isFestival: Boolean,
  val startsAt: String,
  val endsAt: String,
)

/**
 * One cross-entity search suggestion.
 *
 * NAVIGATION ONLY: an id, a display name and why it matched. No price, no stock
 * and no MOQ — a suggestion is a shortcut to the priced row, never a second copy
 * of it. See `GET /api/mobile/v1/catalog/search`.
 */
sealed interface SearchSuggestion {
  val id: String
  val label: String

  /** A product, matched by name, by its own barcode or through one of its packs. */
  data class Product(
    override val id: String,
    override val label: String,
    val brandName: String?,
    /** The variant name when a PACK matched, so "5kg Sack" is visible. */
    val packName: String?,
    val imageUrl: String?,
    val matchedBarcode: Boolean,
  ) : SearchSuggestion

  /** A brand: opens the catalogue filtered to it. */
  data class Brand(
    override val id: String,
    override val label: String,
    val logoUrl: String?,
  ) : SearchSuggestion

  /** A category: opens the catalogue filtered to it. */
  data class Category(
    override val id: String,
    override val label: String,
    val parentName: String?,
  ) : SearchSuggestion
}

/**
 * One search-suggestion answer.
 *
 * [query] is the SANITIZED term the server matched, echoed back so a slow answer
 * for an older prefix can be dropped instead of overwriting what the shopper has
 * since typed. [searched] is false when the term was below the server's floor —
 * a normal "nothing to suggest yet", not a failure and not "no match".
 */
data class SearchSuggestions(
  val query: String,
  val searched: Boolean,
  val suggestions: List<SearchSuggestion>,
) {
  val isEmpty: Boolean get() = suggestions.isEmpty()

  companion object {
    val NONE = SearchSuggestions(query = "", searched = false, suggestions = emptyList())
  }
}
