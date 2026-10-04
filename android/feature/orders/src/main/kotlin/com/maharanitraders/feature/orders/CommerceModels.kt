package com.maharanitraders.feature.orders

/** Intent sent to quote and submit endpoints; it contains no client price data. */
data class CartLineIntent(val packId: String, val quantity: Int)

data class CartSnapshot(
  val lines: List<CartLine>,
  val couponCode: String?,
  val couponUnavailable: Boolean,
)

data class CartLine(
  val id: String,
  val packId: String,
  val productId: String?,
  val productName: String?,
  val packName: String?,
  val quantity: Int,
  val quantityUnit: String,
  /** Server-reported piece-cart step (1 for the current retailer contract). */
  val quantityIncrement: Int,
  val moq: Int?,
  val unitsPerCase: Int?,
  val unitPricePaise: Long?,
  val lineTotalPaise: Long?,
  val gstPercent: Double?,
  val availability: String,
  val orderable: Boolean,
  val message: String?,
)

data class DeliveryAddress(
  val id: String?,
  val label: String,
  val line: String,
  val receiverName: String?,
  val phone: String?,
  val isDefault: Boolean,
)

data class QuoteLine(
  val packId: String,
  val productId: String,
  val productName: String,
  val packName: String,
  val quantity: Int,
  val quantityUnit: String,
  val moq: Int,
  val unitsPerCase: Int,
  val unitPricePaise: Long,
  val lineTotalPaise: Long,
  val gstPercent: Double,
  val availability: String,
  val orderable: Boolean,
)

data class CheckoutQuote(
  val lines: List<QuoteLine>,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val coinsBalancePaise: Long,
  val coinsUsedPaise: Long,
  val balanceAfterCoinsPaise: Long,
  val couponCode: String?,
  val address: DeliveryAddress,
)

data class OrderConfirmation(
  val id: String,
  val orderNumber: String,
  val status: String,
  val placedAt: String,
  val grandTotalPaise: Long,
  val coinsUsedPaise: Long?,
  val balanceAfterCoinsPaise: Long?,
  val idempotentReplay: Boolean,
)

data class OrderItem(
  val id: String,
  val productId: String,
  val packId: String?,
  val productName: String?,
  val packName: String?,
  val quantity: Int,
  val quantityUnit: String,
  val quantityPieces: Int?,
  val unitsPerCase: Int?,
  val unitPricePaise: Long,
  val gstPercent: Double,
  val lineTotalPaise: Long,
)

data class RetailerOrder(
  val id: String,
  val orderNumber: String,
  val status: String,
  val subtotalPaise: Long,
  val gstTotalPaise: Long,
  val discountTotalPaise: Long,
  val grandTotalPaise: Long,
  val placedAt: String,
  val updatedAt: String,
  val notes: String?,
  val shippingAddressLine: String?,
  val items: List<OrderItem>,
  val coinsUsedPaise: Long?,
  val balanceAfterCoinsPaise: Long?,
)

data class OrderHistoryPage(
  val orders: List<RetailerOrder>,
  val nextCursor: String?,
  val hasMore: Boolean,
)

data class CouponApplication(val code: String, val discountPaise: Long)
