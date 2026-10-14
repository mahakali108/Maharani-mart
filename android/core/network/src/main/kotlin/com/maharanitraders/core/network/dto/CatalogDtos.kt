package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Wire models for the Phase D catalogue (`/api/mobile/v1/catalog`, `/home`).
 *
 * Field names match the route handlers exactly
 * (`app/api/mobile/v1/catalog/products/route.ts` and friends). Everything is
 * defaulted so an additive server change cannot crash an installed app, and the
 * shared `Json` ignores unknown keys.
 *
 * Money arrives as integer paise and is carried as [Long]: no float ever touches
 * a price on the way to the screen. Availability arrives as a string and is
 * mapped to an enum in the domain layer, where an unrecognised value becomes
 * UNKNOWN instead of silently reading as "in stock".
 */

@Serializable
data class PriceTierDto(
  val minQuantity: Int,
  val maxQuantity: Int? = null,
  val pricePerPiecePaise: Long,
)

@Serializable
data class CatalogPackDto(
  val packId: String,
  val packName: String? = null,
  val unitsPerCase: Int? = null,
  val moq: Int? = null,
  val unitPricePaise: Long? = null,
  val mrpPaise: Long? = null,
  val derivedCasePricePaise: Long? = null,
  val tiers: List<PriceTierDto> = emptyList(),
  val availability: String = "unknown",
)

@Serializable
data class CatalogProductDto(
  val id: String,
  val name: String,
  val brandName: String? = null,
  val imageUrl: String? = null,
  val isNewLaunch: Boolean = false,
  val categoryId: String? = null,
  val brandId: String? = null,
  val createdAt: String? = null,
  val hasOffer: Boolean = false,
  val isFavorite: Boolean = false,
  val pack: CatalogPackDto? = null,
)

@Serializable
data class CatalogCategoryDto(
  val id: String,
  val name: String,
  val imageUrl: String? = null,
  val parentName: String? = null,
  val productCount: Int? = null,
)

@Serializable
data class CatalogCategoriesDto(
  val categories: List<CatalogCategoryDto> = emptyList(),
)

@Serializable
data class CatalogBrandDto(
  val id: String,
  val name: String,
  val logoUrl: String? = null,
  val productCount: Int? = null,
)

@Serializable
data class CatalogBrandsDto(
  val brands: List<CatalogBrandDto> = emptyList(),
)

@Serializable
data class PromoBannerDto(
  val id: String,
  val title: String,
  val subtitle: String? = null,
  val imageUrl: String? = null,
  val ctaLabel: String? = null,
  val linkUrl: String? = null,
)

@Serializable
data class RetailerHomeDto(
  val banners: List<PromoBannerDto> = emptyList(),
  val categories: List<CatalogCategoryDto> = emptyList(),
  val brands: List<CatalogBrandDto> = emptyList(),
  val products: List<CatalogProductDto> = emptyList(),
  val nextCursor: String? = null,
  /**
   * The admin's LIVE offers, soonest-ending first.
   *
   * The same rows `GET /schemes` answers ([MobileSchemeDto]), so the home offers
   * rail and the offers screen cannot disagree. Empty is a normal answer: no
   * offer is running right now.
   */
  val schemes: List<MobileSchemeDto> = emptyList(),
  /**
   * True when the offer read itself FAILED, as opposed to returning nothing.
   *
   * The two must stay apart: an empty list means "no offer is live" (the rail is
   * simply not drawn), while a failed read must never let the app announce that
   * the shop has no offers. Defaults to false so a server that predates the
   * field still decodes.
   */
  val schemesUnavailable: Boolean = false,
)

/**
 * One cross-entity search suggestion (`GET /catalog/search`).
 *
 * NAVIGATION TARGETS ONLY: an id and a display name. There is deliberately no
 * price, stock or MOQ field here, so a suggestion cannot quote a number that
 * checkout would reject — opening one loads the priced catalogue row instead.
 */
@Serializable
data class CatalogSearchProductDto(
  val id: String,
  val name: String,
  val brandName: String? = null,
  /** The variant/pack name, when a PACK (not the product) matched the term. */
  val packName: String? = null,
  val imageUrl: String? = null,
  /** `name`, `barcode` or `pack` — why this row matched, so the UI can say so. */
  val matchKind: String = "name",
)

@Serializable
data class CatalogSearchBrandDto(
  val id: String,
  val name: String,
  val logoUrl: String? = null,
)

@Serializable
data class CatalogSearchCategoryDto(
  val id: String,
  val name: String,
  /** The parent category's real name, or null for a parent / an unresolved link. */
  val parentName: String? = null,
)

@Serializable
data class CatalogSearchDto(
  /** The sanitized term actually matched; the client drops an answer for a stale term. */
  val query: String = "",
  /** False when the term was below the server's floor and nothing was read. */
  val searched: Boolean = false,
  val products: List<CatalogSearchProductDto> = emptyList(),
  val brands: List<CatalogSearchBrandDto> = emptyList(),
  val categories: List<CatalogSearchCategoryDto> = emptyList(),
)

@Serializable
data class ProductPackDetailDto(
  val packId: String,
  val packName: String,
  val unitsPerCase: Int = 1,
  val moq: Int = 1,
  val allowLoosePieces: Boolean = true,
  val unitPricePaise: Long? = null,
  val lineTotalAtMoqPaise: Long? = null,
  val gstPercent: Double = 0.0,
  val mrpPaise: Long? = null,
  val derivedCasePricePaise: Long? = null,
  val tiers: List<PriceTierDto> = emptyList(),
  val availability: String = "unknown",
  val selected: Boolean = false,
  val images: List<String> = emptyList(),
  val message: String? = null,
)

@Serializable
data class ProductDetailDto(
  val id: String,
  val name: String,
  val brandName: String? = null,
  val brandId: String? = null,
  val categoryId: String? = null,
  val categoryName: String? = null,
  val unit: String = "",
  val hsnCode: String? = null,
  val gstPercent: Double = 0.0,
  val leadTimeDays: Int = 0,
  val isNewLaunch: Boolean = false,
  val isFavorite: Boolean = false,
  val hasOffer: Boolean = false,
  val images: List<String> = emptyList(),
  val packs: List<ProductPackDetailDto> = emptyList(),
)
