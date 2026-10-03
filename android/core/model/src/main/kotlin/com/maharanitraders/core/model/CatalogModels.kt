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
 */
data class CatalogQuery(
  val search: String = "",
  val categoryId: String? = null,
  val brandId: String? = null,
  val sort: CatalogSort = CatalogSort.RECOMMENDED,
  val inStockOnly: Boolean = false,
) {
  /** Blank-for-default, so a parameter is only sent when it means something. */
  val searchParam: String? get() = search.trim().ifEmpty { null }
  val sortParam: String? get() = sort.takeIf { it != CatalogSort.RECOMMENDED }?.wireValue
  val inStockParam: String? get() = if (inStockOnly) "1" else null

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
  /** False when the pack may only be sold in whole cases. */
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
)
