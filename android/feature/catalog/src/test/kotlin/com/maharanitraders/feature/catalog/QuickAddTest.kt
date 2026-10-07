package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.catalog.ui.components.canQuickAdd
import com.maharanitraders.feature.catalog.ui.components.quickAddQuantity
import org.junit.Test

/**
 * The catalogue card's quick add control.
 *
 * Two rules are pinned here, and both are about what the SERVER would accept:
 *
 *  1. the quantity sent is the pack's MOQ (never 1 for a pack with a minimum, a
 *     request the cart API would simply refuse — which reads as a broken button);
 *  2. a pack the server marked out of stock, or priced with no rate at all, is
 *     not offered at all, exactly as the product detail screen already behaves.
 *
 * Price and stock stay the server's business: nothing in these helpers reads a
 * price except to check that one EXISTS.
 */
class QuickAddTest {

  private fun pack(
    moq: Int? = 4,
    availability: PackAvailability = PackAvailability.IN_STOCK,
    unitPricePaise: Long? = 25_000,
  ) = CatalogPack(
    packId = "pack-1",
    packName = "25kg",
    unitsPerCase = 1,
    moq = moq,
    unitPricePaise = unitPricePaise,
    mrpPaise = null,
    derivedCasePricePaise = null,
    tiers = emptyList(),
    availability = availability,
  )

  @Test
  fun `sends the MOQ the server published, not one piece`() {
    assertThat(quickAddQuantity(pack(moq = 12))).isEqualTo(12)
  }

  @Test
  fun `falls back to a single piece only when the server sent no minimum`() {
    assertThat(quickAddQuantity(pack(moq = null))).isEqualTo(1)
    // A nonsensical zero from the server cannot become a zero-quantity request.
    assertThat(quickAddQuantity(pack(moq = 0))).isEqualTo(1)
  }

  @Test
  fun `offers the control only for an in-stock, priced pack`() {
    assertThat(canQuickAdd(pack())).isTrue()
    assertThat(canQuickAdd(pack(availability = PackAvailability.OUT_OF_STOCK))).isFalse()
    assertThat(canQuickAdd(pack(unitPricePaise = null))).isFalse()
    assertThat(canQuickAdd(null)).isFalse()
  }

  @Test
  fun `an unknown availability is not treated as out of stock`() {
    // The server's third state means "could not be read". The cart re-validates
    // the write, so the card still offers the action and reports the refusal if
    // there is one — rather than hiding an orderable product behind a guess.
    assertThat(canQuickAdd(pack(availability = PackAvailability.UNKNOWN))).isTrue()
  }

  @Test
  fun `does not offer one-tap add for an MOQ above the cart request limit`() {
    assertThat(canQuickAdd(pack(moq = 100_001))).isFalse()
  }
}
