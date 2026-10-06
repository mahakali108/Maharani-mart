package com.maharanitraders.feature.auth

import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.AckDto
import com.maharanitraders.core.network.dto.AddressPayloadDto
import com.maharanitraders.core.network.dto.ApiEnvelope
import com.maharanitraders.core.network.dto.AreasDto
import com.maharanitraders.core.network.dto.AuthSessionDto
import com.maharanitraders.core.network.dto.CartLineRequestDto
import com.maharanitraders.core.network.dto.CartQuantityRequestDto
import com.maharanitraders.core.network.dto.CatalogBrandsDto
import com.maharanitraders.core.network.dto.CatalogCategoriesDto
import com.maharanitraders.core.network.dto.CatalogProductDto
import com.maharanitraders.core.network.dto.CheckoutQuoteDto
import com.maharanitraders.core.network.dto.CheckoutQuoteRequestDto
import com.maharanitraders.core.network.dto.CouponRemovedDto
import com.maharanitraders.core.network.dto.CouponRequestDto
import com.maharanitraders.core.network.dto.CouponResultDto
import com.maharanitraders.core.network.dto.FavoriteToggleRequestDto
import com.maharanitraders.core.network.dto.FavoriteToggleResponseDto
import com.maharanitraders.core.network.dto.HealthDto
import com.maharanitraders.core.network.dto.LoginRequestDto
import com.maharanitraders.core.network.dto.MarkReadRequestDto
import com.maharanitraders.core.network.dto.MarkReadResponseDto
import com.maharanitraders.core.network.dto.MobileAddressMutationDto
import com.maharanitraders.core.network.dto.MobileAddressesDto
import com.maharanitraders.core.network.dto.MobileBulkMatchDto
import com.maharanitraders.core.network.dto.MobileBulkMatchRequestDto
import com.maharanitraders.core.network.dto.MobileCartDto
import com.maharanitraders.core.network.dto.MobileCouponsDto
import com.maharanitraders.core.network.dto.MobileDeliveryDto
import com.maharanitraders.core.network.dto.MobileFavoritesDto
import com.maharanitraders.core.network.dto.MobileInvoiceDto
import com.maharanitraders.core.network.dto.MobileNotificationDto
import com.maharanitraders.core.network.dto.MobileOrderDto
import com.maharanitraders.core.network.dto.MobileQuickOrderDto
import com.maharanitraders.core.network.dto.MobileWalletLedgerEntryDto
import com.maharanitraders.core.network.dto.MobileWalletSummaryDto
import com.maharanitraders.core.network.dto.PasswordResetRequestDto
import com.maharanitraders.core.network.dto.PasswordUpdateRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderRequestDto
import com.maharanitraders.core.network.dto.PlaceOrderResponseDto
import com.maharanitraders.core.network.dto.ProductDetailDto
import com.maharanitraders.core.network.dto.RefreshRequestDto
import com.maharanitraders.core.network.dto.RefreshSessionDto
import com.maharanitraders.core.network.dto.RegisterRetailerRequestDto
import com.maharanitraders.core.network.dto.RegisterRetailerResponseDto
import com.maharanitraders.core.network.dto.RetailerHomeDto
import com.maharanitraders.core.network.dto.SessionDto
import kotlinx.coroutines.CompletableDeferred

/**
 * A [MaharaniApi] double for the auth-feature ViewModel tests.
 *
 * It implements EVERY member of the interface — the static guard in
 * `tests/android-project-integrity.test.ts` fails the build otherwise, which is
 * the point: when a phase adds an endpoint, every double is updated in the
 * same change rather than silently drifting.
 *
 * Only the two endpoints these tests exercise (`requestPasswordReset`,
 * `updatePassword`) record and answer; everything else throws, so a test that
 * starts depending on another endpoint by accident fails loudly instead of
 * passing on invented data.
 */
class FakeAuthApi : MaharaniApi {

  /** Every password-reset request the code under test made, in order. */
  val passwordResetRequests: MutableList<PasswordResetRequestDto> = mutableListOf()

  /** Every password-update request the code under test made, in order. */
  val passwordUpdateRequests: MutableList<PasswordUpdateRequestDto> = mutableListOf()

  var nextResetResult: () -> ApiEnvelope<AckDto> = { ApiEnvelope(AckDto(ok = true)) }
  var nextUpdateResult: () -> ApiEnvelope<AckDto> = { ApiEnvelope(AckDto(ok = true)) }

  /** When set, reset requests suspend until completed — for double-submit tests. */
  var resetGate: CompletableDeferred<ApiEnvelope<AckDto>>? = null

  /** When set, update requests suspend until completed — for double-submit tests. */
  var updateGate: CompletableDeferred<ApiEnvelope<AckDto>>? = null

  override suspend fun requestPasswordReset(body: PasswordResetRequestDto): ApiEnvelope<AckDto> {
    passwordResetRequests.add(body)
    val gate = resetGate
    return gate?.await() ?: nextResetResult()
  }

  override suspend fun updatePassword(body: PasswordUpdateRequestDto): ApiEnvelope<AckDto> {
    passwordUpdateRequests.add(body)
    val gate = updateGate
    return gate?.await() ?: nextUpdateResult()
  }

  private fun unexpected(name: String): Nothing =
    throw AssertionError("Unexpected API call in an auth-feature test: $name")

  override suspend fun health(): ApiEnvelope<HealthDto> = unexpected("health")

  override suspend fun session(): ApiEnvelope<SessionDto> = unexpected("session")

  override suspend fun login(body: LoginRequestDto): ApiEnvelope<AuthSessionDto> =
    unexpected("login")

  override suspend fun refresh(body: RefreshRequestDto): ApiEnvelope<RefreshSessionDto> =
    unexpected("refresh")

  override suspend fun logout(): ApiEnvelope<AckDto> = unexpected("logout")

  override suspend fun areas(): ApiEnvelope<AreasDto> = unexpected("areas")

  override suspend fun registerRetailer(
    body: RegisterRetailerRequestDto,
  ): ApiEnvelope<RegisterRetailerResponseDto> = unexpected("registerRetailer")

  override suspend fun catalogProducts(
    search: String?,
    categoryId: String?,
    brandId: String?,
    sort: String?,
    inStock: String?,
    favoritesOnly: String?,
    cursor: String?,
  ): ApiEnvelope<List<CatalogProductDto>> = unexpected("catalogProducts")

  override suspend fun catalogProduct(id: String): ApiEnvelope<ProductDetailDto> =
    unexpected("catalogProduct")

  override suspend fun catalogCategories(): ApiEnvelope<CatalogCategoriesDto> =
    unexpected("catalogCategories")

  override suspend fun catalogBrands(): ApiEnvelope<CatalogBrandsDto> =
    unexpected("catalogBrands")

  override suspend fun retailerHome(): ApiEnvelope<RetailerHomeDto> = unexpected("retailerHome")

  override suspend fun mobileCart(): ApiEnvelope<MobileCartDto> = unexpected("mobileCart")

  override suspend fun addCartLine(body: CartLineRequestDto): ApiEnvelope<MobileCartDto> =
    unexpected("addCartLine")

  override suspend fun updateCartLine(
    lineId: String,
    body: CartQuantityRequestDto,
  ): ApiEnvelope<MobileCartDto> = unexpected("updateCartLine")

  override suspend fun removeCartLine(lineId: String): ApiEnvelope<MobileCartDto> =
    unexpected("removeCartLine")

  override suspend fun applyCartCoupon(body: CouponRequestDto): ApiEnvelope<CouponResultDto> =
    unexpected("applyCartCoupon")

  override suspend fun removeCartCoupon(): ApiEnvelope<CouponRemovedDto> =
    unexpected("removeCartCoupon")

  override suspend fun mobileAddresses(): ApiEnvelope<MobileAddressesDto> =
    unexpected("mobileAddresses")

  override suspend fun createAddress(body: AddressPayloadDto): ApiEnvelope<MobileAddressMutationDto> =
    unexpected("createAddress")

  override suspend fun updateAddress(
    addressId: String,
    body: AddressPayloadDto,
  ): ApiEnvelope<MobileAddressMutationDto> = unexpected("updateAddress")

  override suspend fun deleteAddress(addressId: String): ApiEnvelope<MobileAddressesDto> =
    unexpected("deleteAddress")

  override suspend fun setDefaultAddress(addressId: String): ApiEnvelope<MobileAddressMutationDto> =
    unexpected("setDefaultAddress")

  override suspend fun checkoutQuote(body: CheckoutQuoteRequestDto): ApiEnvelope<CheckoutQuoteDto> =
    unexpected("checkoutQuote")

  override suspend fun placeOrder(
    requestKey: String,
    body: PlaceOrderRequestDto,
  ): ApiEnvelope<PlaceOrderResponseDto> = unexpected("placeOrder")

  override suspend fun orderHistory(cursor: String?): ApiEnvelope<List<MobileOrderDto>> =
    unexpected("orderHistory")

  override suspend fun orderDetail(orderId: String): ApiEnvelope<MobileOrderDto> =
    unexpected("orderDetail")

  override suspend fun orderInvoice(orderId: String): ApiEnvelope<MobileInvoiceDto> =
    unexpected("orderInvoice")

  override suspend fun orderDelivery(orderId: String): ApiEnvelope<MobileDeliveryDto> =
    unexpected("orderDelivery")

  override suspend fun recoverOrderRequest(requestKey: String): ApiEnvelope<MobileOrderDto> =
    unexpected("recoverOrderRequest")

  override suspend fun notifications(
    cursor: String?,
    unreadOnly: String?,
  ): ApiEnvelope<List<MobileNotificationDto>> = unexpected("notifications")

  override suspend fun markNotificationsRead(
    body: MarkReadRequestDto,
  ): ApiEnvelope<MarkReadResponseDto> = unexpected("markNotificationsRead")

  override suspend fun walletSummary(): ApiEnvelope<MobileWalletSummaryDto> =
    unexpected("walletSummary")

  override suspend fun walletLedger(
    cursor: String?,
  ): ApiEnvelope<List<MobileWalletLedgerEntryDto>> = unexpected("walletLedger")

  override suspend fun quickOrder(q: String): ApiEnvelope<MobileQuickOrderDto> =
    unexpected("quickOrder")

  override suspend fun matchBulkLines(
    body: MobileBulkMatchRequestDto,
  ): ApiEnvelope<MobileBulkMatchDto> = unexpected("matchBulkLines")

  override suspend fun favorites(): ApiEnvelope<MobileFavoritesDto> = unexpected("favorites")

  override suspend fun toggleFavorite(
    body: FavoriteToggleRequestDto,
  ): ApiEnvelope<FavoriteToggleResponseDto> = unexpected("toggleFavorite")

  override suspend fun coupons(): ApiEnvelope<MobileCouponsDto> = unexpected("coupons")
}
