package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.PackAvailability
import org.junit.Test

/**
 * Sorting and filtering the saved list are VIEW operations over rows the server
 * priced. These cases pin the ordering rules a shopkeeper would otherwise
 * discover the hard way — most importantly that a row the server could not price
 * sorts last rather than first, because "cheapest" must never mean "unreadable".
 */
class FavoritesViewTest {

  private fun product(id: String, name: String, price: Long?, availability: PackAvailability) = CatalogProduct(
    id = id,
    name = name,
    brandName = "Brand",
    imageUrl = null,
    isNewLaunch = false,
    categoryId = null,
    brandId = null,
    hasOffer = false,
    isFavorite = true,
    pack = CatalogPack(
      packId = "pack-$id",
      packName = "1 kg",
      unitsPerCase = 12,
      moq = 12,
      unitPricePaise = price,
      mrpPaise = null,
      derivedCasePricePaise = null,
      tiers = emptyList(),
      availability = availability,
    ),
  )

  private val rice = product("1", "Rice", 8_000, PackAvailability.IN_STOCK)
  private val atta = product("2", "Atta", 6_000, PackAvailability.IN_STOCK)
  private val oil = product("3", "Oil", null, PackAvailability.OUT_OF_STOCK)

  @Test
  fun `name ordering is alphabetical and case-insensitive`() {
    val view = favoritesView(listOf(rice, atta, oil), FavoritesSort.NAME, inStockOnly = false)
    assertThat(view.map { it.name }).containsExactly("Atta", "Oil", "Rice").inOrder()
  }

  @Test
  fun `price ordering puts an unpriced row last in both directions`() {
    val ascending = favoritesView(listOf(rice, atta, oil), FavoritesSort.PRICE_LOW, inStockOnly = false)
    assertThat(ascending.map { it.name }).containsExactly("Atta", "Rice", "Oil").inOrder()

    val descending = favoritesView(listOf(rice, atta, oil), FavoritesSort.PRICE_HIGH, inStockOnly = false)
    assertThat(descending.map { it.name }).containsExactly("Rice", "Atta", "Oil").inOrder()
  }

  @Test
  fun `the in-stock filter hides only what the server reports as out of stock`() {
    val view = favoritesView(listOf(rice, atta, oil), FavoritesSort.NAME, inStockOnly = true)
    assertThat(view.map { it.id }).containsExactly("1", "2").inOrder()
  }

  @Test
  fun `an empty saved list stays empty`() {
    assertThat(favoritesView(emptyList(), FavoritesSort.PRICE_LOW, inStockOnly = true)).isEmpty()
  }
}
