package com.maharanitraders.feature.orders

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
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

/**
 * Quick-order behaviour.
 *
 * The rules under test are the ones the web quick-order page enforces: results
 * are the server's, quantities start at the pack MOQ, an add goes through the
 * cart endpoint (so the shared badge counts the same rows), and a pasted list is
 * only added line by line — a failed line never masquerades as an added one.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class QuickOrderViewModelTest {

  private val dispatcher = StandardTestDispatcher()

  @Before
  fun setUp() = Dispatchers.setMain(dispatcher)

  @After
  fun tearDown() = Dispatchers.resetMain()

  private fun pack(id: String, moq: Int = 6) = QuickOrderPack(
    packId = id,
    packName = "Box of 24",
    unitsPerCase = 24,
    moq = moq,
    allowLoosePieces = false,
    unitPricePaise = 1_000,
    derivedPiecePricePaise = 1_000,
    mrpPaise = 1_200,
    availability = "in_stock",
  )

  private fun product(id: String, packs: List<QuickOrderPack>) = QuickOrderProduct(
    id = id,
    name = "Parle-G Gold",
    brandName = "Parle",
    imageUrl = null,
    gstPercent = 18.0,
    packs = packs,
  )

  private fun build(
    repository: FakeQuickOrderRepository = FakeQuickOrderRepository(),
    cart: FakeCartWriter = FakeCartWriter(),
  ): Triple<QuickOrderViewModel, FakeQuickOrderRepository, FakeCartWriter> {
    val viewModel = QuickOrderViewModel(
      repository = repository,
      cart = cart,
      cartCounts = CartCountStore(cart),
    )
    return Triple(viewModel, repository, cart)
  }

  @Test
  fun `search starts every pack at its MOQ and clears on an empty term`() = runTest(dispatcher) {
    val (viewModel, repository, _) = build(
      FakeQuickOrderRepository().apply {
        searchResults += AppResult.Success(listOf(product("p1", listOf(pack("pack-1", moq = 6)))))
      },
    )

    viewModel.onTermChange("parle")
    viewModel.search()
    advanceUntilIdle()

    assertEquals(listOf("parle"), repository.searches)
    assertTrue(viewModel.state.value.searched)
    assertEquals(6, viewModel.state.value.quantities["pack-1"])

    // An empty term is not a search for everything: it clears the surface.
    viewModel.onTermChange("   ")
    viewModel.search()
    advanceUntilIdle()

    assertEquals(1, repository.searches.size)
    assertFalse(viewModel.state.value.searched)
    assertTrue(viewModel.state.value.products.isEmpty())
  }

  @Test
  fun `a failed search is reported and shows nothing`() = runTest(dispatcher) {
    val (viewModel, _, _) = build(
      FakeQuickOrderRepository().apply {
        searchResults += AppResult.Failure(AppError.Network("offline"))
      },
    )

    viewModel.onTermChange("rice")
    viewModel.search()
    advanceUntilIdle()

    assertEquals("offline", viewModel.state.value.searchError)
    assertTrue(viewModel.state.value.products.isEmpty())
    assertTrue(viewModel.state.value.offline)
  }

  @Test
  fun `adding a pack records the server counts into the shared badge store`() = runTest(dispatcher) {
    val cart = FakeCartWriter().apply {
      addResults += AppResult.Success(
        CartSnapshot(
          lines = emptyList(),
          couponCode = null,
          couponUnavailable = false,
          lineCount = 3,
          itemCount = 41,
        ),
      )
    }
    val store = CartCountStore(cart)
    val viewModel = QuickOrderViewModel(
      repository = FakeQuickOrderRepository(),
      cart = cart,
      cartCounts = store,
    )

    viewModel.addToCart(pack("pack-9", moq = 6))
    advanceUntilIdle()

    assertEquals(listOf("pack-9" to 6), cart.adds)
    assertEquals("Added to cart.", viewModel.state.value.message)
    assertTrue(viewModel.state.value.adding.isEmpty())
    // The badge counts the server's own numbers for the rows it just returned.
    assertEquals(3, store.state.value.lineCount)
    assertEquals(41, store.state.value.itemCount)
  }

  @Test
  fun `a rejected add surfaces the server message and adds nothing`() = runTest(dispatcher) {
    val cart = FakeCartWriter().apply {
      addResults += AppResult.Failure(AppError.Api(code = com.maharanitraders.core.model.ApiErrorCode.VALIDATION_FAILED, message = "Minimum order is 24 pieces for this pack."))
    }
    val (viewModel, _, _) = build(cart = cart)

    viewModel.addToCart(pack("pack-9", moq = 6))
    advanceUntilIdle()

    assertEquals("Minimum order is 24 pieces for this pack.", viewModel.state.value.message)
    assertTrue(viewModel.state.value.adding.isEmpty())
  }

  @Test
  fun `matching lines defaults to the pasted quantity or the pack MOQ`() = runTest(dispatcher) {
    val (viewModel, repository, _) = build(
      FakeQuickOrderRepository().apply {
        matchResults += AppResult.Success(
          listOf(
            BulkMatchLine("2 x parle", 2, "p1", "Parle-G", "Parle", listOf(matchPack("pack-1", moq = 6)), null),
            BulkMatchLine("rice", null, "p2", "Rice 5kg", null, listOf(matchPack("pack-2", moq = 4)), null),
            BulkMatchLine("nothing", 3, "", "nothing", null, emptyList(), "No matching product found."),
          ),
        )
      },
    )

    viewModel.onBulkRawChange("2 x parle\nrice\nnothing")
    viewModel.matchBulkLines()
    advanceUntilIdle()

    assertEquals(listOf("2 x parle\nrice\nnothing"), repository.matches)
    assertEquals(2, viewModel.state.value.bulkChoices[0]?.quantity)
    assertEquals(4, viewModel.state.value.bulkChoices[1]?.quantity)
    // The unmatched line has no choice, so it can never be added.
    assertNull(viewModel.state.value.bulkChoices[2])
  }

  @Test
  fun `adding matched lines reports how many actually landed`() = runTest(dispatcher) {
    val cart = FakeCartWriter().apply {
      // First add succeeds, second is rejected — the report must not claim 2.
      addResults += AppResult.Success(CartSnapshot(emptyList(), null, false, lineCount = 1, itemCount = 2))
      addResults += AppResult.Failure(AppError.Api(code = com.maharanitraders.core.model.ApiErrorCode.VALIDATION_FAILED, message = "Pack is unavailable."))
    }
    val (viewModel, _, _) = build(
      repository = FakeQuickOrderRepository().apply {
        matchResults += AppResult.Success(
          listOf(
            BulkMatchLine("a", 2, "p1", "A", null, listOf(matchPack("pack-1")), null),
            BulkMatchLine("b", 3, "p2", "B", null, listOf(matchPack("pack-2")), null),
          ),
        )
      },
      cart = cart,
    )

    viewModel.onBulkRawChange("a\nb")
    viewModel.matchBulkLines()
    advanceUntilIdle()
    viewModel.addBulkMatches()
    advanceUntilIdle()

    assertEquals(listOf("pack-1" to 2, "pack-2" to 3), cart.adds)
    assertTrue(viewModel.state.value.message.orEmpty().startsWith("Added 1 of 2 lines."))
    assertFalse(viewModel.state.value.bulkAdding)
    // The refusal belongs to the line the shopper typed, not only to a snackbar
    // at the bottom of the screen.
    assertEquals("Pack is unavailable.", viewModel.state.value.lineErrors[1])
  }

  @Test
  fun `a repeated pack in the pasted list is sent once, with the pieces added up`() = runTest(dispatcher) {
    val cart = FakeCartWriter().apply {
      addResults += AppResult.Success(CartSnapshot(emptyList(), null, false, lineCount = 1, itemCount = 7))
    }
    val (viewModel, _, _) = build(
      repository = FakeQuickOrderRepository().apply {
        matchResults += AppResult.Success(
          listOf(
            BulkMatchLine("2 x parle", 2, "p1", "A", null, listOf(matchPack("pack-1")), null),
            BulkMatchLine("parle x 3", 3, "p1", "A", null, listOf(matchPack("pack-1")), null),
          ),
        )
      },
      cart = cart,
    )

    viewModel.onBulkRawChange("2 x parle\nparle x 3")
    viewModel.matchBulkLines()
    advanceUntilIdle()
    viewModel.addBulkMatches()
    advanceUntilIdle()

    // One call, five pieces: the second call would have overwritten the first
    // quantity or been refused as a duplicate.
    assertEquals(listOf("pack-1" to 5), cart.adds)
    assertTrue(viewModel.state.value.message.orEmpty().contains("merged"))
  }

  @Test
  fun `a line taken out of the run is not added, and can be put back`() = runTest(dispatcher) {
    val cart = FakeCartWriter().apply {
      // Two runs: the first adds the second line only, the second adds both.
      addResults += AppResult.Success(CartSnapshot(emptyList(), null, false, lineCount = 1, itemCount = 3))
      addResults += AppResult.Success(CartSnapshot(emptyList(), null, false, lineCount = 2, itemCount = 5))
    }
    val (viewModel, _, _) = build(
      repository = FakeQuickOrderRepository().apply {
        matchResults += AppResult.Success(
          listOf(
            BulkMatchLine("a", 2, "p1", "A", null, listOf(matchPack("pack-1")), null),
            BulkMatchLine("b", 3, "p2", "B", null, listOf(matchPack("pack-2")), null),
          ),
        )
      },
      cart = cart,
    )

    viewModel.onBulkRawChange("a\nb")
    viewModel.matchBulkLines()
    advanceUntilIdle()

    viewModel.toggleBulkLine(0)
    viewModel.addBulkMatches()
    advanceUntilIdle()

    assertEquals(listOf("pack-2" to 3), cart.adds)

    // Putting it back is the same index, so the error against line 0 stays
    // against line 0. Only the newly included line is sent: re-sending pack-2
    // would ADD to the quantity already in the cart.
    viewModel.toggleBulkLine(0)
    viewModel.addBulkMatches()
    advanceUntilIdle()
    assertEquals(listOf("pack-2" to 3, "pack-1" to 2), cart.adds)

    // A third run with nothing new left says so instead of doubling the order.
    viewModel.addBulkMatches()
    advanceUntilIdle()
    assertEquals(listOf("pack-2" to 3, "pack-1" to 2), cart.adds)
    assertTrue(viewModel.state.value.bulkError.orEmpty().contains("already in your cart"))
  }
}

internal fun matchPack(id: String, moq: Int = 1) = BulkMatchPack(
  packId = id,
  packName = "Box of 24",
  moq = moq,
  allowLoosePieces = false,
  unitPricePaise = 1_000,
  availability = "in_stock",
)

/** The quick-order reads, faked; the VM's rules stay under test. */
internal class FakeQuickOrderRepository : QuickOrderRepository {
  val searches = mutableListOf<String>()
  val searchResults = mutableListOf<AppResult<List<QuickOrderProduct>>>()
  val matches = mutableListOf<String>()
  val matchResults = mutableListOf<AppResult<List<BulkMatchLine>>>()

  override suspend fun search(term: String): AppResult<List<QuickOrderProduct>> {
    searches += term
    return searchResults.removeAt(0)
  }

  override suspend fun matchLines(raw: String): AppResult<List<BulkMatchLine>> {
    matches += raw
    return matchResults.removeAt(0)
  }
}

/**
 * The cart writer quick order uses. Only `addCartLine` is exercised; every other
 * method throws, so a test that accidentally reaches a real path fails loudly.
 */
internal class FakeCartWriter : CommerceRepository {
  val adds = mutableListOf<Pair<String, Int>>()
  val addResults = mutableListOf<AppResult<CartSnapshot>>()

  override suspend fun addCartLine(packId: String, quantity: Int): AppResult<CartSnapshot> {
    adds += packId to quantity
    return addResults.removeAt(0)
  }

  override suspend fun loadCart(): AppResult<CartSnapshot> = throw UnsupportedOperationException()
  override suspend fun updateCartLine(lineId: String, quantity: Int): AppResult<CartSnapshot> =
    throw UnsupportedOperationException()
  override suspend fun removeCartLine(lineId: String): AppResult<CartSnapshot> =
    throw UnsupportedOperationException()
  override suspend fun loadAddresses(): AppResult<List<DeliveryAddress>> =
    throw UnsupportedOperationException()
  override suspend fun createAddress(draft: AddressDraft): AppResult<List<DeliveryAddress>> =
    throw UnsupportedOperationException()
  override suspend fun updateAddress(addressId: String, draft: AddressDraft): AppResult<List<DeliveryAddress>> =
    throw UnsupportedOperationException()
  override suspend fun deleteAddress(addressId: String): AppResult<List<DeliveryAddress>> =
    throw UnsupportedOperationException()
  override suspend fun setDefaultAddress(addressId: String): AppResult<List<DeliveryAddress>> =
    throw UnsupportedOperationException()
  override suspend fun applyCoupon(code: String): AppResult<CouponApplication> =
    throw UnsupportedOperationException()
  override suspend fun removeCoupon(): AppResult<Unit> = throw UnsupportedOperationException()
  override suspend fun quote(lines: List<CartLineIntent>, addressId: String?): AppResult<CheckoutQuote> =
    throw UnsupportedOperationException()
  override suspend fun placeOrder(
    requestKey: String,
    lines: List<CartLineIntent>,
    addressId: String?,
    notes: String,
  ): AppResult<OrderConfirmation> = throw UnsupportedOperationException()
  override suspend fun recoverOrder(requestKey: String): AppResult<RetailerOrder> =
    throw UnsupportedOperationException()
  override suspend fun orderHistory(cursor: String?): AppResult<OrderHistoryPage> =
    throw UnsupportedOperationException()
  override suspend fun orderDetail(orderId: String): AppResult<RetailerOrder> =
    throw UnsupportedOperationException()
  override suspend fun orderInvoice(orderId: String): AppResult<OrderInvoice> =
    throw UnsupportedOperationException()
  override suspend fun orderDelivery(orderId: String): AppResult<OrderDelivery> =
    throw UnsupportedOperationException()
  override suspend fun reorderLines(intents: List<CartLineIntent>): AppResult<ReorderOutcome> =
    throw UnsupportedOperationException()
}
