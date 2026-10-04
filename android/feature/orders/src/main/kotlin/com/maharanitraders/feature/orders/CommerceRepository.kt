package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CheckoutLineIntentDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteLineDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.MobileAddressDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileCartLineDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.MobileOrderItemDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Real implementation backed only by the existing authenticated mobile API. */
interface CommerceRepository {
  suspend fun loadCart(): AppResult<CartSnapshot>
  suspend fun addCartLine(packId: String, quantity: Int): AppResult<CartSnapshot>
  suspend fun updateCartLine(lineId: String, quantity: Int): AppResult<CartSnapshot>
  suspend fun removeCartLine(lineId: String): AppResult<CartSnapshot>
  suspend fun loadAddresses(): AppResult<List<DeliveryAddress>>
  suspend fun applyCoupon(code: String): AppResult<CouponApplication>
  suspend fun removeCoupon(): AppResult<Unit>
  suspend fun quote(lines: List<CartLineIntent>, addressId: String?): AppResult<CheckoutQuote>
  suspend fun placeOrder(
    requestKey: String,
    lines: List<CartLineIntent>,
    addressId: String?,
    notes: String,
  ): AppResult<OrderConfirmation>
  suspend fun recoverOrder(requestKey: String): AppResult<RetailerOrder>
  suspend fun orderHistory(cursor: String?): AppResult<OrderHistoryPage>
}

@Singleton
class NetworkCommerceRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : CommerceRepository {

  override suspend fun loadCart(): AppResult<CartSnapshot> =
    executor.executeEnvelope { api.mobileCart() }.map { it.toDomain() }

  override suspend fun addCartLine(packId: String, quantity: Int): AppResult<CartSnapshot> =
    executor.executeEnvelope { api.addCartLine(CartLineRequestDto(packId = packId, quantity = quantity)) }
      .map { it.toDomain() }

  override suspend fun updateCartLine(lineId: String, quantity: Int): AppResult<CartSnapshot> =
    executor.executeEnvelope {
      api.updateCartLine(lineId, CartQuantityRequestDto(quantity = quantity))
    }.map { it.toDomain() }

  override suspend fun removeCartLine(lineId: String): AppResult<CartSnapshot> =
    executor.executeEnvelope { api.removeCartLine(lineId) }.map { it.toDomain() }

  override suspend fun loadAddresses(): AppResult<List<DeliveryAddress>> =
    executor.executeEnvelope { api.mobileAddresses() }
      .map { result -> result.addresses.map(MobileAddressDto::toDomain) }

  override suspend fun applyCoupon(code: String): AppResult<CouponApplication> =
    executor.executeEnvelope { api.applyCartCoupon(CouponRequestDto(code = code.trim())) }
      .map { CouponApplication(code = it.code, discountPaise = it.discountPaise) }

  override suspend fun removeCoupon(): AppResult<Unit> =
    executor.executeEnvelope { api.removeCartCoupon() }.map { Unit }

  override suspend fun quote(
    lines: List<CartLineIntent>,
    addressId: String?,
  ): AppResult<CheckoutQuote> = executor.executeEnvelope {
    api.checkoutQuote(
      com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto(
        lines = lines.map { CheckoutLineIntentDto(packId = it.packId, quantity = it.quantity) },
        addressId = addressId,
      ),
    )
  }.map(CheckoutQuoteDto::toDomain)

  override suspend fun placeOrder(
    requestKey: String,
    lines: List<CartLineIntent>,
    addressId: String?,
    notes: String,
  ): AppResult<OrderConfirmation> = executor.executeEnvelope {
    api.placeOrder(
      requestKey = requestKey,
      body = PlaceOrderRequestDto(
        lines = lines.map { CheckoutLineIntentDto(packId = it.packId, quantity = it.quantity) },
        addressId = addressId,
        notes = notes,
      ),
    )
  }.map { response ->
    val order = response.order
    OrderConfirmation(
      id = order.id,
      orderNumber = order.orderNumber,
      status = order.status,
      placedAt = order.placedAt,
      grandTotalPaise = order.grandTotalPaise,
      coinsUsedPaise = order.coinsUsedPaise,
      balanceAfterCoinsPaise = order.balanceAfterCoinsPaise,
      idempotentReplay = order.idempotentReplay,
    )
  }

  override suspend fun recoverOrder(requestKey: String): AppResult<RetailerOrder> =
    executor.executeEnvelope { api.recoverOrderRequest(requestKey) }
      .map { it.toDomain() }

  override suspend fun orderHistory(cursor: String?): AppResult<OrderHistoryPage> =
    executor.execute { api.orderHistory(cursor?.trim()?.ifEmpty { null }) }
      .map { envelope ->
        OrderHistoryPage(
          orders = envelope.data.map(MobileOrderDto::toDomain),
          nextCursor = envelope.page?.nextCursor,
          hasMore = envelope.page?.hasMore == true,
        )
      }
}

private fun MobileCartDto.toDomain() = CartSnapshot(
  lines = lines.map(MobileCartLineDto::toDomain),
  couponCode = couponCode,
  couponUnavailable = couponUnavailable,
)

private fun MobileCartLineDto.toDomain() = CartLine(
  id = id,
  packId = packId,
  productId = productId,
  productName = productName,
  packName = packName,
  quantity = quantity,
  quantityUnit = quantityUnit,
  quantityIncrement = quantityIncrement.coerceAtLeast(1),
  moq = moq,
  unitsPerCase = unitsPerCase,
  unitPricePaise = unitPricePaise,
  lineTotalPaise = lineTotalPaise,
  gstPercent = gstPercent,
  availability = availability,
  orderable = orderable,
  message = message,
)

private fun MobileAddressDto.toDomain() = DeliveryAddress(
  id = id,
  label = label,
  line = line,
  receiverName = receiverName,
  phone = phone,
  isDefault = isDefault,
)

private fun CheckoutQuoteDto.toDomain() = CheckoutQuote(
  lines = lines.map(CheckoutQuoteLineDto::toDomain),
  subtotalPaise = subtotalPaise,
  gstTotalPaise = gstTotalPaise,
  discountTotalPaise = discountTotalPaise,
  grandTotalPaise = grandTotalPaise,
  coinsBalancePaise = coinsBalancePaise,
  coinsUsedPaise = coinsUsedPaise,
  balanceAfterCoinsPaise = balanceAfterCoinsPaise,
  couponCode = couponCode,
  address = address.toDomain(),
)

private fun CheckoutQuoteLineDto.toDomain() = QuoteLine(
  packId = packId,
  productId = productId,
  productName = productName,
  packName = packName,
  quantity = quantity,
  quantityUnit = quantityUnit,
  moq = moq,
  unitsPerCase = unitsPerCase,
  unitPricePaise = unitPricePaise,
  lineTotalPaise = lineTotalPaise,
  gstPercent = gstPercent,
  availability = availability,
  orderable = orderable,
)

private fun MobileOrderDto.toDomain() = RetailerOrder(
  id = id,
  orderNumber = orderNumber,
  status = status,
  subtotalPaise = subtotalPaise,
  gstTotalPaise = gstTotalPaise,
  discountTotalPaise = discountTotalPaise,
  grandTotalPaise = grandTotalPaise,
  placedAt = placedAt,
  updatedAt = updatedAt,
  notes = notes,
  shippingAddressLine = shippingAddress.asAddressLine(),
  items = items.map(MobileOrderItemDto::toDomain),
  coinsUsedPaise = coinsUsedPaise,
  balanceAfterCoinsPaise = balanceAfterCoinsPaise,
)

private fun MobileOrderItemDto.toDomain() = OrderItem(
  id = id,
  productId = productId,
  packId = packId,
  productName = productName,
  packName = packName,
  quantity = quantity,
  quantityUnit = quantityUnit,
  quantityPieces = quantityPieces,
  unitsPerCase = unitsPerCase,
  unitPricePaise = unitPricePaise,
  gstPercent = gstPercent,
  lineTotalPaise = lineTotalPaise,
)

private fun kotlinx.serialization.json.JsonElement?.asAddressLine(): String? = try {
  this?.jsonObject?.get("line")?.jsonPrimitive?.contentOrNull
} catch (_: Exception) {
  null
}
