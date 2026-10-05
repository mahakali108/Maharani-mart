package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.datastore.PreferenceStore
import com.maharanitraders.core.model.ApiErrorCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CommerceViewModelTest {
  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  @Test
  fun `cart quantity changes obey server MOQ and retain the last server snapshot on failure`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository()
    val preferences = AppPreferences(MemoryPreferenceStore())
    val viewModel = CartCheckoutViewModel(repository, preferences, CartCountStore(repository))
    advanceUntilIdle()

    viewModel.setQuantity(CART_LINE.id, 5)
    assertEquals(0, repository.updateCalls.size)
    assertEquals(6, viewModel.state.value.cart?.lines?.single()?.quantity)
    assertTrue(viewModel.state.value.message.orEmpty().contains("Minimum order"))

    repository.updateResults.add(
      AppResult.Success(
        repository.cart.copy(lines = listOf(CART_LINE.copy(quantity = 7, unitPricePaise = 12_000, lineTotalPaise = 84_000))),
      ),
    )
    viewModel.increment(CART_LINE.id)
    advanceUntilIdle()
    assertEquals(7, repository.updateCalls.single().second)
    assertEquals(12_000L, viewModel.state.value.cart?.lines?.single()?.unitPricePaise)

    repository.updateResults += AppResult.Failure(AppError.Network("offline"))
    viewModel.decrement(CART_LINE.id)
    advanceUntilIdle()
    assertEquals(6, repository.updateCalls.last().second)
    assertEquals(7, viewModel.state.value.cart?.lines?.single()?.quantity)
    assertTrue(viewModel.state.value.cartOffline)
  }

  @Test
  fun `uncertain cart mutation blocks repeats until the shared cart is reloaded`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      addResults += AppResult.Failure(AppError.Network("response lost"))
    }
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(MemoryPreferenceStore()), CartCountStore(repository))
    advanceUntilIdle()

    viewModel.addCartLine("pack-1", 6)
    advanceUntilIdle()
    assertEquals(1, repository.addCalls.size)
    assertTrue(viewModel.state.value.cartNeedsRefresh)

    viewModel.addCartLine("pack-1", 6)
    advanceUntilIdle()
    assertEquals("An uncertain add cannot be retried against a stale snapshot.", 1, repository.addCalls.size)

    repository.cart = initialCart.copy(lines = listOf(CART_LINE.copy(quantity = 12, lineTotalPaise = 120_000)))
    viewModel.refreshCart()
    advanceUntilIdle()
    assertFalse(viewModel.state.value.cartNeedsRefresh)
    assertEquals(12, viewModel.state.value.cart?.lines?.single()?.quantity)

    repository.addResults += AppResult.Success(repository.cart)
    viewModel.addCartLine("pack-1", 6)
    advanceUntilIdle()
    assertEquals(2, repository.addCalls.size)
  }

  @Test
  fun `checkout refresh reloads the shared cart before requesting a replacement quote`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository()
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(MemoryPreferenceStore()), CartCountStore(repository))
    advanceUntilIdle()
    viewModel.beginCheckout()
    advanceUntilIdle()
    assertEquals(1, repository.quoteCalls.size)

    repository.cart = initialCart.copy(lines = listOf(CART_LINE.copy(quantity = 8, lineTotalPaise = 80_000)))
    viewModel.refreshCheckout()
    advanceUntilIdle()

    assertEquals(8, repository.quoteCalls.last().first.single().quantity)
    assertEquals(8, viewModel.state.value.cart?.lines?.single()?.quantity)
    assertTrue(repository.loadCartCalls >= 2)
  }

  @Test
  fun `address loading failure can be retried without a quote or stale address`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      addressResults += AppResult.Failure(AppError.Network("offline"))
    }
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(MemoryPreferenceStore()), CartCountStore(repository))
    advanceUntilIdle()

    viewModel.beginCheckout()
    advanceUntilIdle()
    assertNull(viewModel.state.value.quote)
    assertFalse(viewModel.state.value.hasAddressSelection)

    viewModel.refreshCheckout()
    advanceUntilIdle()

    assertEquals(2, repository.addressCalls)
    assertTrue(viewModel.state.value.hasAddressSelection)
    assertEquals(CommerceViewModelTest.quote, viewModel.state.value.quote)
  }

  @Test
  fun `definitive stock rejection requires a fresh cart and quote before another submit`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      placeResults += AppResult.Failure(AppError.Api(ApiErrorCode.INSUFFICIENT_STOCK, "Stock changed."))
    }
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(MemoryPreferenceStore()), CartCountStore(repository))
    advanceUntilIdle()
    viewModel.beginCheckout()
    advanceUntilIdle()

    viewModel.submitOrder()
    advanceUntilIdle()
    assertNull(viewModel.state.value.quote)
    assertTrue(viewModel.state.value.quoteError.orEmpty().contains("Refresh the shared cart"))
    assertEquals(1, repository.quoteCalls.size)

    viewModel.refreshCheckout()
    advanceUntilIdle()
    assertEquals(2, repository.quoteCalls.size)
    assertEquals(CommerceViewModelTest.quote, viewModel.state.value.quote)
  }

  @Test
  fun `stale quote or stock conflict clears the quote and cannot be submitted`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      quoteResults += AppResult.Failure(
        AppError.Api(ApiErrorCode.CONFLICT, "Availability changed. Refresh the quote."),
      )
    }
    val preferences = AppPreferences(MemoryPreferenceStore())
    val viewModel = CartCheckoutViewModel(repository, preferences, CartCountStore(repository))
    advanceUntilIdle()

    viewModel.beginCheckout()
    advanceUntilIdle()

    assertNull(viewModel.state.value.quote)
    assertEquals(ApiErrorCode.CONFLICT, viewModel.state.value.quoteErrorCode)
    assertEquals(1, repository.quoteCalls.size)
    viewModel.submitOrder()
    advanceUntilIdle()
    assertTrue(repository.placeCalls.isEmpty())
  }

  @Test
  fun `uncertain submit keeps the key and cart until recovery confirms the committed order`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      commitCartOnNetworkFailure = true
      placeResults += AppResult.Failure(AppError.Network("response lost"))
      recoveryResults += AppResult.Success(actualOrder)
    }
    val store = MemoryPreferenceStore()
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(store), CartCountStore(repository))
    advanceUntilIdle()
    viewModel.beginCheckout()
    advanceUntilIdle()

    viewModel.submitOrder()
    advanceUntilIdle()
    val savedKey = store.getString("pending_order_request")
    assertTrue(!savedKey.isNullOrBlank())
    assertTrue(viewModel.state.value.pendingOrderUncertain)
    // The client keeps its last cart snapshot; it does not pretend success or
    // clear the basket just because the request may have reached the server.
    assertEquals(1, viewModel.state.value.cart?.lines?.size)
    assertNull(viewModel.state.value.confirmation)

    viewModel.checkPendingOrder()
    advanceUntilIdle()

    assertEquals(1, repository.placeCalls.size)
    assertEquals(listOf(savedKey), repository.recoveryCalls)
    assertEquals("order-actual", viewModel.state.value.confirmation?.id)
    assertEquals("processing", viewModel.state.value.confirmation?.status)
    assertEquals("2026-10-03T10:00:00Z", viewModel.state.value.confirmation?.placedAt)
    assertFalse(viewModel.state.value.pendingOrderUncertain)
    assertNull(store.getString("pending_order_request"))
    assertTrue(viewModel.state.value.cart?.lines.isNullOrEmpty())
  }

  @Test
  fun `a 404 recovery retries only with the identical persisted idempotency key`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      placeResults += AppResult.Failure(AppError.Network("timeout"))
      placeResults += AppResult.Success(confirmedOrder)
      recoveryResults += AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, "No completed order yet."))
    }
    val store = MemoryPreferenceStore()
    val viewModel = CartCheckoutViewModel(repository, AppPreferences(store), CartCountStore(repository))
    advanceUntilIdle()
    viewModel.beginCheckout()
    advanceUntilIdle()

    viewModel.submitOrder()
    advanceUntilIdle()
    val firstKey = repository.placeCalls.single().requestKey
    assertEquals(firstKey, store.getString("pending_order_request"))
    assertTrue(viewModel.state.value.pendingOrderUncertain)

    viewModel.submitOrder()
    advanceUntilIdle()

    assertEquals(2, repository.placeCalls.size)
    assertEquals(firstKey, repository.placeCalls[1].requestKey)
    assertEquals(confirmedOrder.id, viewModel.state.value.confirmation?.id)
    assertNull(store.getString("pending_order_request"))
    assertTrue(viewModel.state.value.cart?.lines.isNullOrEmpty())
  }

  @Test
  fun `history keeps actual server statuses items and timestamps while paging without duplicate ids`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      historyResults += AppResult.Success(
        OrderHistoryPage(orders = listOf(actualOrder), nextCursor = "cursor-2", hasMore = true),
      )
      historyResults += AppResult.Success(
        OrderHistoryPage(
          orders = listOf(actualOrder.copy(status = "delivered"), secondActualOrder),
          nextCursor = null,
          hasMore = false,
        ),
      )
    }
    val viewModel = OrderHistoryViewModel(repository)
    advanceUntilIdle()

    assertEquals("processing", viewModel.state.value.orders.single().status)
    assertEquals("2026-10-03T10:00:00Z", viewModel.state.value.orders.single().placedAt)
    assertEquals("Rice", viewModel.state.value.orders.single().items.single().productName)
    assertTrue(viewModel.state.value.hasMore)

    viewModel.loadMore()
    advanceUntilIdle()

    assertEquals(listOf("order-actual", "order-next"), viewModel.state.value.orders.map { it.id })
    assertEquals("processing", viewModel.state.value.orders.first().status)
    assertEquals("delivered", viewModel.state.value.orders.last().status)
    assertEquals("2026-10-02T09:00:00Z", viewModel.state.value.orders.last().placedAt)
    assertFalse(viewModel.state.value.hasMore)
  }

  @Test
  fun `failed history refresh preserves the loaded page and its pagination cursor`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      historyResults += AppResult.Success(
        OrderHistoryPage(listOf(actualOrder), nextCursor = "cursor-2", hasMore = true),
      )
      historyResults += AppResult.Failure(AppError.Network("refresh offline"))
      historyResults += AppResult.Success(OrderHistoryPage(listOf(secondActualOrder), null, false))
    }
    val viewModel = OrderHistoryViewModel(repository)
    advanceUntilIdle()
    viewModel.refresh()
    advanceUntilIdle()

    assertEquals(listOf("order-actual"), viewModel.state.value.orders.map { it.id })
    assertEquals("cursor-2", viewModel.state.value.nextCursor)
    assertTrue(viewModel.state.value.hasMore)
    assertTrue(viewModel.state.value.offline)

    viewModel.loadMore()
    advanceUntilIdle()
    assertEquals(listOf(null, null, "cursor-2"), repository.historyCursors)
    assertEquals(listOf("order-actual", "order-next"), viewModel.state.value.orders.map { it.id })
  }

  @Test
  fun `history reports network failure instead of creating placeholder orders`() = runTest(dispatcher) {
    val repository = FakeCommerceRepository().apply {
      historyResults += AppResult.Failure(AppError.Network("offline"))
    }
    val viewModel = OrderHistoryViewModel(repository)
    advanceUntilIdle()

    assertTrue(viewModel.state.value.offline)
    assertTrue(viewModel.state.value.orders.isEmpty())
    assertFalse(viewModel.state.value.loading)
  }

  private class MemoryPreferenceStore : PreferenceStore {
    private val values = mutableMapOf<String, Any>()

    override suspend fun getString(key: String): String? = values[key] as? String
    override suspend fun putString(key: String, value: String) { values[key] = value }
    override suspend fun getBoolean(key: String): Boolean? = values[key] as? Boolean
    override suspend fun putBoolean(key: String, value: Boolean) { values[key] = value }
    override suspend fun getLong(key: String): Long? = values[key] as? Long
    override suspend fun putLong(key: String, value: Long) { values[key] = value }
    override suspend fun remove(key: String) { values.remove(key) }
  }

  private class FakeCommerceRepository : CommerceRepository {
    var cart: CartSnapshot = CommerceViewModelTest.Companion.initialCart
    var loadCartCalls: Int = 0
    var addressCalls: Int = 0
    val addCalls = mutableListOf<Pair<String, Int>>()
    val addResults = mutableListOf<AppResult<CartSnapshot>>()
    val addressResults = mutableListOf<AppResult<List<DeliveryAddress>>>()
    val historyCursors = mutableListOf<String?>()
    val updateCalls = mutableListOf<Pair<String, Int>>()
    val placeCalls = mutableListOf<PlaceCall>()
    val recoveryCalls = mutableListOf<String>()
    val quoteCalls = mutableListOf<Pair<List<CartLineIntent>, String?>>()
    val updateResults = mutableListOf<AppResult<CartSnapshot>>()
    val placeResults = mutableListOf<AppResult<OrderConfirmation>>()
    val recoveryResults = mutableListOf<AppResult<RetailerOrder>>()
    val quoteResults = mutableListOf<AppResult<CheckoutQuote>>()
    val historyResults = mutableListOf<AppResult<OrderHistoryPage>>()
    val createAddressCalls = mutableListOf<AddressDraft>()
    val updateAddressCalls = mutableListOf<Pair<String, AddressDraft>>()
    val deleteAddressCalls = mutableListOf<String>()
    val setDefaultAddressCalls = mutableListOf<String>()
    var commitCartOnNetworkFailure: Boolean = false

    override suspend fun loadCart(): AppResult<CartSnapshot> {
      loadCartCalls += 1
      return AppResult.Success(cart)
    }
    override suspend fun addCartLine(packId: String, quantity: Int): AppResult<CartSnapshot> {
      addCalls += packId to quantity
      return if (addResults.isNotEmpty()) addResults.removeAt(0) else AppResult.Success(cart)
    }
    override suspend fun updateCartLine(lineId: String, quantity: Int): AppResult<CartSnapshot> {
      updateCalls += lineId to quantity
      return if (updateResults.isNotEmpty()) updateResults.removeAt(0) else AppResult.Success(cart)
    }
    override suspend fun removeCartLine(lineId: String): AppResult<CartSnapshot> = AppResult.Success(cart)
    override suspend fun loadAddresses(): AppResult<List<DeliveryAddress>> {
      addressCalls += 1
      return if (addressResults.isNotEmpty()) addressResults.removeAt(0)
      else AppResult.Success(listOf(CommerceViewModelTest.Companion.address))
    }
    override suspend fun createAddress(draft: AddressDraft): AppResult<List<DeliveryAddress>> {
      createAddressCalls += draft
      return AppResult.Success(listOf(CommerceViewModelTest.Companion.address))
    }
    override suspend fun updateAddress(addressId: String, draft: AddressDraft): AppResult<List<DeliveryAddress>> {
      updateAddressCalls += addressId to draft
      return AppResult.Success(listOf(CommerceViewModelTest.Companion.address))
    }
    override suspend fun deleteAddress(addressId: String): AppResult<List<DeliveryAddress>> {
      deleteAddressCalls += addressId
      return AppResult.Success(emptyList())
    }
    override suspend fun setDefaultAddress(addressId: String): AppResult<List<DeliveryAddress>> {
      setDefaultAddressCalls += addressId
      return AppResult.Success(listOf(CommerceViewModelTest.Companion.address))
    }
    override suspend fun applyCoupon(code: String): AppResult<CouponApplication> = AppResult.Success(CouponApplication(code, 0))
    override suspend fun removeCoupon(): AppResult<Unit> = AppResult.Success(Unit)
    override suspend fun quote(lines: List<CartLineIntent>, addressId: String?): AppResult<CheckoutQuote> {
      quoteCalls += lines to addressId
      return if (quoteResults.isNotEmpty()) quoteResults.removeAt(0) else AppResult.Success(CommerceViewModelTest.Companion.quote)
    }
    override suspend fun placeOrder(
      requestKey: String,
      lines: List<CartLineIntent>,
      addressId: String?,
      notes: String,
    ): AppResult<OrderConfirmation> {
      placeCalls += PlaceCall(requestKey, lines, addressId, notes)
      val result = if (placeResults.isNotEmpty()) placeResults.removeAt(0) else AppResult.Success(CommerceViewModelTest.Companion.confirmedOrder)
      if (result is AppResult.Success || (commitCartOnNetworkFailure && result is AppResult.Failure && result.error is AppError.Network)) {
        cart = cart.copy(lines = emptyList(), couponCode = null)
      }
      return result
    }
    override suspend fun recoverOrder(requestKey: String): AppResult<RetailerOrder> {
      recoveryCalls += requestKey
      val result = if (recoveryResults.isNotEmpty()) recoveryResults.removeAt(0)
      else AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, "No completed order."))
      if (result is AppResult.Success) cart = cart.copy(lines = emptyList(), couponCode = null)
      return result
    }
    override suspend fun orderHistory(cursor: String?): AppResult<OrderHistoryPage> {
      historyCursors += cursor
      return if (historyResults.isNotEmpty()) historyResults.removeAt(0)
      else AppResult.Success(OrderHistoryPage(emptyList(), null, false))
    }
  }

  private data class PlaceCall(
    val requestKey: String,
    val lines: List<CartLineIntent>,
    val addressId: String?,
    val notes: String,
  )

  private companion object {
    val CART_LINE = CartLine(
      id = "line-1",
      packId = "pack-1",
      productId = "product-1",
      productName = "Rice",
      packName = "Small pack",
      quantity = 6,
      quantityUnit = "pieces",
      quantityIncrement = 1,
      moq = 6,
      unitsPerCase = 12,
      unitPricePaise = 10_000,
      lineTotalPaise = 60_000,
      gstPercent = 5.0,
      availability = "in_stock",
      orderable = true,
      message = null,
    )
    val initialCart = CartSnapshot(listOf(CART_LINE), couponCode = null, couponUnavailable = false)
    val address = DeliveryAddress(
      id = "address-1",
      label = "Shop",
      line = "Market Road, Patna",
      receiverName = "Shop Owner",
      phone = "9000000000",
      isDefault = true,
    )
    val quote = CheckoutQuote(
      lines = listOf(
        QuoteLine(
          packId = "pack-1",
          productId = "product-1",
          productName = "Rice",
          packName = "Small pack",
          quantity = 6,
          quantityUnit = "pieces",
          moq = 6,
          unitsPerCase = 12,
          unitPricePaise = 10_000,
          lineTotalPaise = 60_000,
          gstPercent = 5.0,
          availability = "in_stock",
          orderable = true,
        ),
      ),
      subtotalPaise = 57_143,
      gstTotalPaise = 2_857,
      discountTotalPaise = 0,
      grandTotalPaise = 60_000,
      coinsBalancePaise = 0,
      coinsUsedPaise = 0,
      balanceAfterCoinsPaise = 0,
      couponCode = null,
      address = address,
    )
    val actualOrder = RetailerOrder(
      id = "order-actual",
      orderNumber = "MK-20261003-00001",
      status = "processing",
      subtotalPaise = 57_143,
      gstTotalPaise = 2_857,
      discountTotalPaise = 0,
      grandTotalPaise = 60_000,
      placedAt = "2026-10-03T10:00:00Z",
      updatedAt = "2026-10-03T10:00:00Z",
      notes = "Leave at shop",
      shippingAddressLine = "Market Road, Patna",
      items = listOf(
        OrderItem(
          id = "item-actual",
          productId = "product-1",
          packId = "pack-1",
          productName = "Rice",
          packName = "Small pack",
          quantity = 6,
          quantityUnit = "pieces",
          quantityPieces = 6,
          unitsPerCase = 12,
          unitPricePaise = 10_000,
          gstPercent = 5.0,
          lineTotalPaise = 60_000,
        ),
      ),
      coinsUsedPaise = 0,
      balanceAfterCoinsPaise = 0,
    )
    val secondActualOrder = actualOrder.copy(
      id = "order-next",
      orderNumber = "MK-20261002-00002",
      status = "delivered",
      placedAt = "2026-10-02T09:00:00Z",
      updatedAt = "2026-10-03T09:00:00Z",
    )
    val confirmedOrder = OrderConfirmation(
      id = "order-confirmed",
      orderNumber = "MK-20261004-00001",
      status = "pending",
      placedAt = "2026-10-04T10:00:00Z",
      grandTotalPaise = 60_000,
      coinsUsedPaise = 0,
      balanceAfterCoinsPaise = 0,
      idempotentReplay = false,
    )
  }
}
