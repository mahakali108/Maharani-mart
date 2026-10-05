package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/**
 * Wire models for the native quick-order endpoints
 * (`/api/mobile/v1/quick-order` and `/match`), which mirror the web quick-order
 * page and bulk panel.
 *
 * Money is integer paise and availability is the two-state string the rest of
 * the catalogue uses; a value this build does not recognise reads as unknown
 * rather than as a promise of stock.
 */

@Serializable
data class MobileQuickOrderPackDto(
  val packId: String,
  val packName: String = "",
  val unitsPerCase: Int = 1,
  val moq: Int = 1,
  val allowLoosePieces: Boolean = true,
  /** Priced at the pack's MOQ by the server; null when the engine refused it. */
  val unitPricePaise: Long? = null,
  val derivedPiecePricePaise: Long? = null,
  val mrpPaise: Long? = null,
  val tiers: List<PriceTierDto> = emptyList(),
  val availability: String = "unknown",
)

@Serializable
data class MobileQuickOrderProductDto(
  val id: String,
  val name: String,
  val brandName: String? = null,
  val imageUrl: String? = null,
  val gstPercent: Double = 0.0,
  val packs: List<MobileQuickOrderPackDto> = emptyList(),
)

@Serializable
data class MobileQuickOrderDto(
  val term: String = "",
  val products: List<MobileQuickOrderProductDto> = emptyList(),
)

@Serializable
data class MobileBulkMatchRequestDto(
  val raw: String,
)

@Serializable
data class MobileBulkMatchPackDto(
  val packId: String,
  val packName: String = "",
  val moq: Int = 1,
  val allowLoosePieces: Boolean = true,
  val unitPricePaise: Long? = null,
  val availability: String = "unknown",
)

@Serializable
data class MobileBulkMatchLineDto(
  val line: String = "",
  val quantity: Int? = null,
  val productId: String = "",
  val productName: String = "",
  val brandName: String? = null,
  val matches: List<MobileBulkMatchPackDto> = emptyList(),
  val error: String? = null,
)

@Serializable
data class MobileBulkMatchDto(
  val matches: List<MobileBulkMatchLineDto> = emptyList(),
)
