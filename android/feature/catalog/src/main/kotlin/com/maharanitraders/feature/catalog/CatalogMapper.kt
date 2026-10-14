package com.maharanitraders.feature.catalog

import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.HomeScheme
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.PriceTier
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import com.maharanitraders.core.model.PromoBanner
import com.maharanitraders.core.model.RetailerHome
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.model.SearchSuggestions
import com.maharanitraders.core.network.dto.CatalogBrandDto
import com.maharanitraders.core.network.dto.CatalogCategoryDto
import com.maharanitraders.core.network.dto.CatalogPackDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CatalogSearchDto
import com.maharanitraders.core.network.dto.PriceTierDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.ProductPackDetailDto
import com.maharanitraders.core.network.dto.PromoBannerDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.MobileSchemeDto

/**
 * Wire model to domain model, written out field by field.
 *
 * The mapping is explicit rather than automatic on purpose: a server-side rename
 * is a compile error here instead of a silently empty field on a product card.
 *
 * Two rules the mapping enforces:
 *  - an unrecognised availability string becomes [PackAvailability.UNKNOWN], so
 *    a new server value can never be displayed as "in stock";
 *  - blank strings become `null`, so the UI has one way to say "not provided"
 *    and never renders an empty chip next to a product name.
 */
object CatalogMapper {

  private fun String?.orNullIfBlank(): String? = this?.trim()?.ifEmpty { null }

  fun tier(dto: PriceTierDto): PriceTier = PriceTier(
    minQuantity = dto.minQuantity,
    maxQuantity = dto.maxQuantity,
    unitPricePaise = dto.pricePerPiecePaise,
  )

  fun pack(dto: CatalogPackDto): CatalogPack = CatalogPack(
    packId = dto.packId,
    packName = dto.packName.orNullIfBlank(),
    unitsPerCase = dto.unitsPerCase,
    moq = dto.moq,
    unitPricePaise = dto.unitPricePaise,
    mrpPaise = dto.mrpPaise,
    derivedCasePricePaise = dto.derivedCasePricePaise,
    tiers = dto.tiers.map(::tier),
    availability = PackAvailability.fromWire(dto.availability),
  )

  fun product(dto: CatalogProductDto): CatalogProduct = CatalogProduct(
    id = dto.id,
    name = dto.name,
    brandName = dto.brandName.orNullIfBlank(),
    imageUrl = dto.imageUrl.orNullIfBlank(),
    isNewLaunch = dto.isNewLaunch,
    categoryId = dto.categoryId.orNullIfBlank(),
    brandId = dto.brandId.orNullIfBlank(),
    hasOffer = dto.hasOffer,
    isFavorite = dto.isFavorite,
    pack = dto.pack?.let(::pack),
  )

  fun products(dtos: List<CatalogProductDto>): List<CatalogProduct> = dtos.map(::product)

  fun category(dto: CatalogCategoryDto): CatalogCategory = CatalogCategory(
    id = dto.id,
    name = dto.name,
    imageUrl = dto.imageUrl.orNullIfBlank(),
    productCount = dto.productCount,
    parentName = dto.parentName,
  )

  fun brand(dto: CatalogBrandDto): CatalogBrand = CatalogBrand(
    id = dto.id,
    name = dto.name,
    logoUrl = dto.logoUrl.orNullIfBlank(),
    productCount = dto.productCount,
  )

  fun banner(dto: PromoBannerDto): PromoBanner = PromoBanner(
    id = dto.id,
    title = dto.title,
    subtitle = dto.subtitle.orNullIfBlank(),
    imageUrl = dto.imageUrl.orNullIfBlank(),
    ctaLabel = dto.ctaLabel.orNullIfBlank(),
    linkUrl = dto.linkUrl.orNullIfBlank(),
  )

  /**
   * One live offer row.
   *
   * The same DTO the offers screen decodes (`MobileSchemeDto`), so the home rail
   * and that screen are reading one shape and cannot drift.
   */
  fun scheme(dto: MobileSchemeDto): HomeScheme = HomeScheme(
    id = dto.id,
    name = dto.name,
    description = dto.description.orNullIfBlank(),
    isFestival = dto.isFestival,
    startsAt = dto.startsAt,
    endsAt = dto.endsAt,
  )

  fun home(dto: RetailerHomeDto): RetailerHome = RetailerHome(
    banners = dto.banners.map(::banner),
    categories = dto.categories.map(::category),
    brands = dto.brands.map(::brand),
    products = products(dto.products),
    nextCursor = dto.nextCursor.orNullIfBlank(),
    schemes = dto.schemes.map(::scheme),
    schemesUnavailable = dto.schemesUnavailable,
  )

  /**
   * One search-suggestion answer, flattened into the order the UI draws it:
   * products first (what a shopper usually means), then categories, then brands.
   *
   * A row whose id or label came back blank is DROPPED rather than rendered as
   * an unlabelled tap target — a suggestion the shopper cannot read is worse
   * than one fewer suggestion.
   */
  fun searchSuggestions(dto: CatalogSearchDto): SearchSuggestions {
    val products = dto.products.mapNotNull { row ->
      val id = row.id.orNullIfBlank() ?: return@mapNotNull null
      val label = row.name.orNullIfBlank() ?: return@mapNotNull null
      SearchSuggestion.Product(
        id = id,
        label = label,
        brandName = row.brandName.orNullIfBlank(),
        packName = row.packName.orNullIfBlank(),
        imageUrl = row.imageUrl.orNullIfBlank(),
        matchedBarcode = row.matchKind.trim().lowercase() == "barcode",
      )
    }
    val categories = dto.categories.mapNotNull { row ->
      val id = row.id.orNullIfBlank() ?: return@mapNotNull null
      val label = row.name.orNullIfBlank() ?: return@mapNotNull null
      SearchSuggestion.Category(id = id, label = label, parentName = row.parentName.orNullIfBlank())
    }
    val brands = dto.brands.mapNotNull { row ->
      val id = row.id.orNullIfBlank() ?: return@mapNotNull null
      val label = row.name.orNullIfBlank() ?: return@mapNotNull null
      SearchSuggestion.Brand(id = id, label = label, logoUrl = row.logoUrl.orNullIfBlank())
    }
    return SearchSuggestions(
      query = dto.query.trim(),
      searched = dto.searched,
      suggestions = products + categories + brands,
    )
  }

  fun packDetail(dto: ProductPackDetailDto): ProductPackDetail = ProductPackDetail(
    packId = dto.packId,
    packName = dto.packName,
    unitsPerCase = dto.unitsPerCase,
    moq = dto.moq,
    allowLoosePieces = dto.allowLoosePieces,
    unitPricePaise = dto.unitPricePaise,
    lineTotalAtMoqPaise = dto.lineTotalAtMoqPaise,
    gstPercent = dto.gstPercent,
    mrpPaise = dto.mrpPaise,
    derivedCasePricePaise = dto.derivedCasePricePaise,
    tiers = dto.tiers.map(::tier),
    availability = PackAvailability.fromWire(dto.availability),
    selected = dto.selected,
    // A blank entry is dropped rather than handed to the image loader, which
    // would otherwise show a broken tile in the middle of the gallery.
    images = dto.images.mapNotNull { it.orNullIfBlank() },
    message = dto.message.orNullIfBlank(),
  )

  fun detail(dto: ProductDetailDto): ProductDetail = ProductDetail(
    id = dto.id,
    name = dto.name,
    brandName = dto.brandName.orNullIfBlank(),
    categoryId = dto.categoryId.orNullIfBlank(),
    categoryName = dto.categoryName.orNullIfBlank(),
    unit = dto.unit,
    hsnCode = dto.hsnCode.orNullIfBlank(),
    gstPercent = dto.gstPercent,
    leadTimeDays = dto.leadTimeDays,
    isNewLaunch = dto.isNewLaunch,
    isFavorite = dto.isFavorite,
    hasOffer = dto.hasOffer,
    images = dto.images.mapNotNull { it.orNullIfBlank() },
    packs = dto.packs.map(::packDetail),
  )
}
