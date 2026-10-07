package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.catalog.ui.components.CartQuantityRules
import org.junit.Test

/** Local selector guardrails; the cart endpoint still owns current MOQ and stock validation. */
class CartQuantityRulesTest {

  private fun pack(
    moq: Int? = 5,
    availability: PackAvailability = PackAvailability.IN_STOCK,
    unitPricePaise: Long? = 12_500,
  ) = CatalogPack(
    packId = "pack-1",
    packName = "200ml",
    unitsPerCase = 12,
    moq = moq,
    unitPricePaise = unitPricePaise,
    mrpPaise = 15_000,
    derivedCasePricePaise = null,
    tiers = emptyList(),
    availability = availability,
  )

  @Test
  fun `selector starts at real MOQ and decrement cannot go below it`() {
    val pack = pack(moq = 5)

    assertThat(CartQuantityRules.initial(pack)).isEqualTo(5)
    assertThat(CartQuantityRules.canDecrement(pack, 5)).isFalse()
    assertThat(CartQuantityRules.decrement(pack, 5)).isEqualTo(5)
    assertThat(CartQuantityRules.decrement(pack, 7)).isEqualTo(6)
  }

  @Test
  fun `missing MOQ uses the one-piece API baseline without presenting a fake MOQ field`() {
    val pack = pack(moq = null)

    assertThat(CartQuantityRules.minimum(pack)).isEqualTo(1)
    assertThat(CartQuantityRules.initial(pack)).isEqualTo(1)
    assertThat(CartQuantityRules.validationMessage(pack, 1)).isNull()
  }

  @Test
  fun `below MOQ is rejected locally`() {
    assertThat(CartQuantityRules.validationMessage(pack(moq = 5), 4))
      .isEqualTo("Minimum order for this pack is 5 pieces.")
  }

  @Test
  fun `valid MOQ is accepted as an add intent`() {
    assertThat(CartQuantityRules.validationMessage(pack(moq = 5), 5)).isNull()
  }

  @Test
  fun `upper request bound is enforced without pretending it is a stock count`() {
    val pack = pack(moq = 1)

    assertThat(CartQuantityRules.canIncrement(CartQuantityRules.MAX_QUANTITY)).isFalse()
    assertThat(CartQuantityRules.increment(CartQuantityRules.MAX_QUANTITY))
      .isEqualTo(CartQuantityRules.MAX_QUANTITY)
    assertThat(CartQuantityRules.validationMessage(pack, CartQuantityRules.MAX_QUANTITY + 1))
      .isEqualTo("Quantity cannot exceed 100000 pieces.")
  }

  @Test
  fun `out of stock packs and unpriced packs cannot be added`() {
    assertThat(CartQuantityRules.validationMessage(
      pack(availability = PackAvailability.OUT_OF_STOCK),
      5,
    )).isEqualTo("This pack is out of stock.")

    assertThat(CartQuantityRules.validationMessage(pack(unitPricePaise = null), 5))
      .isEqualTo("Price is unavailable for this pack.")
  }

  @Test
  fun `unknown stock remains server-validated rather than being guessed locally`() {
    val pack = pack(availability = PackAvailability.UNKNOWN)

    // Numeric on-hand units are deliberately absent from the catalogue contract.
    // The cart API makes the final stock decision for this quantity.
    assertThat(CartQuantityRules.validationMessage(pack, 25)).isNull()
  }

  @Test
  fun `MOQ above the cart endpoint limit cannot produce an invalid starting intent`() {
    val pack = pack(moq = CartQuantityRules.MAX_QUANTITY + 1)

    assertThat(CartQuantityRules.initial(pack)).isEqualTo(CartQuantityRules.MAX_QUANTITY)
    assertThat(CartQuantityRules.validationMessage(pack, CartQuantityRules.initial(pack)))
      .isEqualTo("The minimum order for this pack exceeds the allowed quantity.")
  }
}
