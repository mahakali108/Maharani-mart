package com.maharanitraders.core.network.dto

import kotlinx.serialization.Serializable

/** Server-priced shared cart snapshot. Every monetary field is in paise. */
@Serializable
data class MobileCartDto(
  val lines: List<MobileCartLineDto> = emptyList(),
  val couponCode: String? = null,
  val couponUnavailable: Boolean = false,
  /** Saved cart lines, computed by the server — the web shell's cart badge fact. */
  val lineCount: Int = 0,
  /** Total pieces across the lines, computed by the server. */
  val itemCount: Int = 0,
)

@Serializable
data class MobileCartLineDto(
  val id: String,
  val packId: String,
  val productId: String? = null,
  val productName: String? = null,
  val packName: String? = null,
  val quantity: Int,
  val quantityUnit: String = "pieces",
  /** Current retailer piece-cart step; do not infer a case-size increment locally. */
  val quantityIncrement: Int = 1,
  val moq: Int? = null,
  val unitsPerCase: Int? = null,
  val unitPricePaise: Long? = null,
  val lineTotalPaise: Long? = null,
  val gstPercent: Double? = null,
  val availability: String = "unknown",
  val orderable: Boolean = false,
  val message: String? = null,
)

@Serializable
data class CartLineRequestDto(
  val packId: String,
  /** Piece count being added; the server merges and applies MOQ rules. */
  val quantity: Int,
)

@Serializable
data class CartQuantityRequestDto(
  /** Final piece count, checked against the server's current pack MOQ. */
  val quantity: Int,
)

@Serializable
data class CouponRequestDto(val code: String)

@Serializable
data class CouponResultDto(
  val code: String,
  val discountPaise: Long,
)

@Serializable
data class CouponRemovedDto(val removed: Boolean = false)

@Serializable
data class MobileAddressesDto(
  val addresses: List<MobileAddressDto> = emptyList(),
)

/**
 * The exact fields the server accepts for a saved address.
 *
 * It is the same schema the web form validates (`addressPayloadSchema`), so a
 * rule can never apply to one surface and miss the other. The owner is
 * deliberately absent: identity comes from the verified session.
 */
@Serializable
data class AddressPayloadDto(
  val label: String,
  val receiverName: String,
  val phone: String,
  val line1: String,
  val line2: String? = null,
  val landmark: String? = null,
  val city: String,
  val district: String? = null,
  val state: String? = null,
  val pincode: String,
  val isDefault: Boolean = false,
)

/** One saved address plus the refreshed list, as every address write answers. */
@Serializable
data class MobileAddressMutationDto(
  val address: MobileAddressDto,
  val addresses: List<MobileAddressDto> = emptyList(),
)

@Serializable
data class MobileAddressDto(
  val id: String? = null,
  val label: String,
  val line: String,
  val receiverName: String? = null,
  val phone: String? = null,
  val isDefault: Boolean = false,
  /**
   * The structured fields behind [line]; the server sends them for saved
   * addresses so the address book can edit one. Absent on the synthetic
   * registered-shop option (id null), which is not editable.
   */
  val line1: String? = null,
  val line2: String? = null,
  val landmark: String? = null,
  val city: String? = null,
  val district: String? = null,
  val state: String? = null,
  val pincode: String? = null,
)

@Serializable
data class CheckoutQuoteRequestDto(
  val lines: List<CheckoutLineIntentDto>,
  val addressId: String? = null,
)

@Serializable
data class CheckoutLineIntentDto(
  val packId: String,
  val quantity: Int,
)

/** Authoritative, non-persisted checkout review. Amounts are all in paise. */
@Serializable
data class CheckoutQuoteDto(
  val lines: List<CheckoutQuoteLineDto>,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  /** Server wallet/Coins balance before this order, in paise. */
  val coinsBalancePaise: Long,
  val coinsUsedPaise: Long,
  /** Wallet/Coins balance after applying this order's Coins, not the order amount due. */
  val balanceAfterCoinsPaise: Long,
  val couponCode: String? = null,
  val address: MobileAddressDto,
)

@Serializable
data class CheckoutQuoteLineDto(
  val packId: String,
  val productId: String,
  val productName: String,
  val packName: String,
  val quantity: Int,
  val quantityUnit: String = "pieces",
  val moq: Int,
  val unitsPerCase: Int,
  val unitPricePaise: Long,
  val lineTotalPaise: Long,
  val gstPercent: Double,
  val availability: String = "unknown",
  val orderable: Boolean = false,
)

@Serializable
data class PlaceOrderRequestDto(
  val lines: List<CheckoutLineIntentDto>,
  val addressId: String? = null,
  val notes: String = "",
)

@Serializable
data class PlaceOrderResponseDto(val order: OrderConfirmationDto)

@Serializable
data class OrderConfirmationDto(
  val id: String,
  val orderNumber: String,
  val status: String,
  val placedAt: String,
  val grandTotalPaise: Long,
  val coinsUsedPaise: Long = 0,
  /** Actual Coins/wallet balance after this order debit, not the amount left on the order. */
  val balanceAfterCoinsPaise: Long? = null,
  val idempotentReplay: Boolean = false,
)

/** Actual order history/detail/recovery record; values are server snapshots. */
@Serializable
data class MobileOrderDto(
  val id: String,
  val orderNumber: String,
  val status: String,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val placedAt: String,
  val updatedAt: String,
  val notes: String? = null,
  val shippingAddress: kotlinx.serialization.json.JsonElement? = null,
  val items: List<MobileOrderItemDto> = emptyList(),
  // Present on confirmed POST/recovery responses only; absent on order history.
  val coinsUsedPaise: Long? = null,
  /** Actual Coins/wallet balance after the order debit (NULL for legacy recovery snapshots). */
  val balanceAfterCoinsPaise: Long? = null,
  // Detail-only additions. The list payload does not carry them, so they
  // default to empty here rather than being required.
  /** The order's own status history, oldest first. */
  val statusHistory: List<MobileOrderStatusEntryDto> = emptyList(),
  /** Coins this order spent (reversed debits already excluded by the server). */
  val coinsSpentPaise: Long? = null,
  /** Coins refunded for this order. */
  val coinsRefundedPaise: Long? = null,
  val coinsRefunded: Boolean = false,
)

@Serializable
data class MobileOrderItemDto(
  val id: String,
  val productId: String,
  val packId: String? = null,
  val productName: String? = null,
  val packName: String? = null,
  val quantity: Int,
  val quantityUnit: String = "packs",
  val quantityPieces: Int? = null,
  val unitsPerCase: Int? = null,
  val unitPricePaise: Long,
  val gstPercent: Double,
  val lineTotalPaise: Long,
)

@Serializable
data class OrderRequestRecoveryDto(
  val id: String,
  val orderNumber: String,
  val status: String,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val placedAt: String,
  val updatedAt: String,
  val notes: String? = null,
  val shippingAddress: kotlinx.serialization.json.JsonElement? = null,
  val items: List<MobileOrderItemDto> = emptyList(),
  val coinsUsedPaise: Long = 0,
  val balanceAfterCoinsPaise: Long? = null,
)
