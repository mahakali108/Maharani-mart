package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.PriceTier
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import org.junit.Test

/**
 * Comparison is only trustworthy when a missing value stays visibly missing.
 * These cases pin the two things that could go wrong: growing the tray past
 * three (which cannot be read on a phone), and filling a blank cell with
 * another product's figure or with a computed price.
 */
class ProductCompareTest {

  private fun pack(
    id: String,
    price: Long?,
    availability: PackAvailability = PackAvailability.IN_STOCK,
    casePrice: Long? = null,
    units: Int = 12,
    moq: Int = 12,
  ) = ProductPackDetail(
    packId = id,
    packName = "1 kg",
    unitsPerCase = units,
    moq = moq,
    allowLoosePieces = true,
    unitPricePaise = price,
    lineTotalAtMoqPaise = price?.let { it * moq },
    gstPercent = 5.0,
    mrpPaise = null,
    derivedCasePricePaise = casePrice,
    tiers = listOf(PriceTier(1, null, price ?: 0)),
    availability = availability,
    selected = true,
    images = emptyList(),
    message = null,
  )

  private fun detail(id: String, brand: String?, pack: ProductPackDetail?) = ProductDetail(
    id = id,
    name = "Product $id",
    brandName = brand,
    categoryId = null,
    categoryName = null,
    unit = "kg",
    hsnCode = null,
    gstPercent = 5.0,
    leadTimeDays = 2,
    isNewLaunch = false,
    isFavorite = false,
    hasOffer = false,
    images = emptyList(),
    packs = listOfNotNull(pack),
  )

  @Test
  fun `the tray takes three products and refuses a fourth`() {
    var selected = ProductCompare.toggle(emptySet(), "a")
    selected = ProductCompare.toggle(selected, "b")
    selected = ProductCompare.toggle(selected, "c")
    assertThat(selected).containsExactly("a", "b", "c")

    // A refused fourth selection is NOT a silent swap: the tray stays as it was.
    assertThat(ProductCompare.toggle(selected, "d")).containsExactly("a", "b", "c")
  }

  @Test
  fun `tapping a selected product removes it, and a blank id changes nothing`() {
    val selected = ProductCompare.toggle(ProductCompare.toggle(emptySet(), "a"), "a")
    assertThat(selected).isEmpty()
    assertThat(ProductCompare.toggle(emptySet(), " ")).isEmpty()
  }

  @Test
  fun `every compared fact comes from the server row`() {
    val rows = ProductCompare.rows(
      listOf(
        detail("a", brand = "Ashirvaad", pack = pack("pack-a", price = 8_000, casePrice = 96_000)),
        detail("b", brand = null, pack = pack("pack-b", price = 7_500, casePrice = 90_000)),
      ),
    )
    assertThat(rows.map { it.label }).containsExactly(
      "Brand",
      "Pack size",
      "Price per piece",
      "Price per case",
      "Minimum order",
      "Availability",
      "GST",
      "Lead time",
    ).inOrder()

    assertThat(rows.first { it.label == "Brand" }.values).containsExactly("Ashirvaad", NOT_PUBLISHED).inOrder()
    assertThat(rows.first { it.label == "Price per piece" }.values).containsExactly("₹80 / pc", "₹75 / pc").inOrder()
    assertThat(rows.first { it.label == "Price per case" }.values)
      .containsExactly("₹960 / case of 12", "₹900 / case of 12").inOrder()
    assertThat(rows.first { it.label == "Minimum order" }.values).containsExactly("12 pcs", "12 pcs").inOrder()
    assertThat(rows.first { it.label == "Lead time" }.values).containsExactly("2 day(s)", "2 day(s)").inOrder()
  }

  @Test
  fun `an unpriced or out-of-stock pack says so instead of showing a number`() {
    val rows = ProductCompare.rows(
      listOf(
        detail("a", brand = "B", pack = pack("pack-a", price = null)),
        detail("b", brand = "B", pack = pack("pack-b", price = 5_000, availability = PackAvailability.OUT_OF_STOCK)),
        detail("c", brand = "B", pack = null),
      ),
    )
    assertThat(rows.first { it.label == "Price per piece" }.values)
      .containsExactly(NOT_PUBLISHED, "₹50 / pc", NOT_PUBLISHED).inOrder()
    // The unpriced pack is still IN STOCK — an unreadable rate is not a stock
    // state, and the two columns must not be conflated.
    assertThat(rows.first { it.label == "Availability" }.values)
      .containsExactly("In stock", "Out of stock", NOT_PUBLISHED).inOrder()
  }

  @Test
  fun `no products means no table, not an empty row`() {
    assertThat(ProductCompare.rows(emptyList())).isEmpty()
  }
}
