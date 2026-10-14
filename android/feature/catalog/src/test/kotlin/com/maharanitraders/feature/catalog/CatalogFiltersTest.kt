package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.CatalogQuery
import com.maharanitraders.core.model.CatalogSort
import org.junit.Test

/**
 * The filter sheet's own arithmetic.
 *
 * WHY THIS IS TESTED SEPARATELY FROM THE ViewModel
 * Every filter here becomes a query parameter the SERVER resolves against this
 * retailer's own rate. A bound that is mis-parsed does not fail loudly — the
 * server drops it (`parseOptionalNumber`) and answers an unfiltered list behind a
 * control that looks applied. So the parsing, the refusal rule and the fold onto
 * the existing query are pinned here, on their own, where a wrong answer is a
 * visible assertion failure rather than a shopper's silently wrong result set.
 */
class CatalogFiltersTest {

  // ------------------------------------------------------------------ parsing

  @Test
  fun `reads a plain whole rupee amount`() {
    assertThat(CatalogFilterDraft.parseBound("250")).isEqualTo(250)
    assertThat(CatalogFilterDraft.parseBound("  250  ")).isEqualTo(250)
  }

  @Test
  fun `reads the amount a shopkeeper actually pastes`() {
    // A rupee sign and thousands separators are what arrives from a price list
    // or a chat message. Refusing them would make the box feel broken for the
    // most common real input.
    assertThat(CatalogFilterDraft.parseBound("\u20B91,200")).isEqualTo(1200)
    assertThat(CatalogFilterDraft.parseBound("\u20B9 1200 ")).isEqualTo(1200)
  }

  @Test
  fun `refuses text that is not a bound rather than truncating it`() {
    // `toIntOrNull` on "25a0" is null: the answer must be "not usable", never a
    // silently shortened 25 that would narrow the list to something nobody asked
    // for.
    assertThat(CatalogFilterDraft.parseBound("25a0")).isNull()
    assertThat(CatalogFilterDraft.parseBound("cheap")).isNull()
    assertThat(CatalogFilterDraft.parseBound("12.50")).isNull()
    assertThat(CatalogFilterDraft.parseBound("-100")).isNull()
  }

  @Test
  fun `treats an empty box as no limit, not as zero`() {
    // Zero is a real bound the server would apply, and `minPrice=0` excludes
    // every unpriced row. Empty must stay null all the way to the query.
    assertThat(CatalogFilterDraft.parseBound("")).isNull()
    assertThat(CatalogFilterDraft.parseBound("   ")).isNull()
    assertThat(CatalogFilterDraft.parseBound("0")).isNull()
  }

  @Test
  fun `refuses a bound above the guard`() {
    assertThat(CatalogFilterDraft.parseBound("${CatalogFilterDraft.MAX_PRICE_BOUND_RUPEES}"))
      .isEqualTo(CatalogFilterDraft.MAX_PRICE_BOUND_RUPEES)
    assertThat(
      CatalogFilterDraft.parseBound("${CatalogFilterDraft.MAX_PRICE_BOUND_RUPEES + 1}"),
    ).isNull()
  }

  // --------------------------------------------------------------- the draft

  @Test
  fun `counts each active filter once for the button badge`() {
    assertThat(CatalogFilterDraft().activeCount).isEqualTo(0)
    assertThat(CatalogFilterDraft(minPriceText = "100").activeCount).isEqualTo(1)
    // Both bounds are two filters, not one "price band".
    assertThat(CatalogFilterDraft(minPriceText = "100", maxPriceText = "500").activeCount)
      .isEqualTo(2)
    assertThat(
      CatalogFilterDraft(
        minPriceText = "100",
        maxPriceText = "500",
        minDiscountPercent = 10,
        maxMoq = 5,
        offersOnly = true,
        newOnly = true,
        inStockOnly = true,
      ).activeCount,
    ).isEqualTo(7)
  }

  @Test
  fun `does not count a box that holds no usable bound`() {
    // The badge is a promise about the list. Text the sheet would refuse must not
    // be counted as a filter that is narrowing anything.
    assertThat(CatalogFilterDraft(minPriceText = "cheap").activeCount).isEqualTo(0)
    assertThat(CatalogFilterDraft(maxPriceText = "0").activeCount).isEqualTo(0)
    assertThat(CatalogFilterDraft(minPriceText = "cheap").isUntouched).isTrue()
  }

  @Test
  fun `reopens on the filters that are already applied`() {
    val query = CatalogQuery(
      search = "rice",
      categoryId = "cat-1",
      brandId = "brand-1",
      sort = CatalogSort.PRICE_LOW,
      minPriceRupees = 120,
      maxPriceRupees = 900,
      minDiscountPercent = 20,
      maxMoq = 5,
      offersOnly = true,
      newOnly = true,
      inStockOnly = true,
    )

    val draft = CatalogFilterDraft.from(query)

    assertThat(draft.minPriceText).isEqualTo("120")
    assertThat(draft.maxPriceText).isEqualTo("900")
    assertThat(draft.minDiscountPercent).isEqualTo(20)
    assertThat(draft.maxMoq).isEqualTo(5)
    assertThat(draft.offersOnly).isTrue()
    assertThat(draft.newOnly).isTrue()
    assertThat(draft.inStockOnly).isTrue()
    // Round trip: reopening the sheet and applying it unchanged must produce the
    // query it was opened from, or the sheet would drift every time it is opened.
    val outcome = draft.applyTo(query)
    assertThat(outcome).isInstanceOf(CatalogFilterOutcome.Apply::class.java)
    assertThat((outcome as CatalogFilterOutcome.Apply).query).isEqualTo(query)
  }

  @Test
  fun `an unfiltered query opens on an empty sheet`() {
    val draft = CatalogFilterDraft.from(CatalogQuery.DEFAULT)

    assertThat(draft.minPriceText).isEmpty()
    assertThat(draft.maxPriceText).isEmpty()
    assertThat(draft.minDiscountPercent).isNull()
    assertThat(draft.maxMoq).isNull()
    assertThat(draft.offersOnly).isFalse()
    assertThat(draft.newOnly).isFalse()
    assertThat(draft.inStockOnly).isFalse()
    assertThat(draft.isUntouched).isTrue()
  }

  // ----------------------------------------------------------------- applying

  @Test
  fun `narrows the list without replacing the shopper's place`() {
    val base = CatalogQuery(
      search = "rice",
      categoryId = "cat-1",
      brandId = "brand-1",
      sort = CatalogSort.PRICE_LOW,
      favoritesOnly = true,
    )

    val outcome = CatalogFilterDraft(minPriceText = "100", maxPriceText = "500").applyTo(base)

    assertThat(outcome).isInstanceOf(CatalogFilterOutcome.Apply::class.java)
    val query = (outcome as CatalogFilterOutcome.Apply).query
    // The sheet narrows a result set. Search, scope, sort and the favourites flag
    // are the shopper's navigation, not its filters, and must survive.
    assertThat(query.search).isEqualTo("rice")
    assertThat(query.categoryId).isEqualTo("cat-1")
    assertThat(query.brandId).isEqualTo("brand-1")
    assertThat(query.sort).isEqualTo(CatalogSort.PRICE_LOW)
    assertThat(query.favoritesOnly).isTrue()
    assertThat(query.minPriceRupees).isEqualTo(100)
    assertThat(query.maxPriceRupees).isEqualTo(500)
  }

  @Test
  fun `an emptied box removes the bound it was holding`() {
    val applied = CatalogQuery(minPriceRupees = 100, maxPriceRupees = 500)

    val outcome = CatalogFilterDraft(minPriceText = "", maxPriceText = "").applyTo(applied)

    val query = (outcome as CatalogFilterOutcome.Apply).query
    assertThat(query.minPriceRupees).isNull()
    assertThat(query.maxPriceRupees).isNull()
  }

  @Test
  fun `a zero-valued choice is dropped rather than sent`() {
    // `discount=0` and `maxMoq=0` are bounds the server would apply and that mean
    // nothing a shopper intended. The chip row's "Any" is null; a stale zero must
    // behave the same way.
    val outcome = CatalogFilterDraft(minDiscountPercent = 0, maxMoq = 0).applyTo(CatalogQuery.DEFAULT)

    val query = (outcome as CatalogFilterOutcome.Apply).query
    assertThat(query.minDiscountPercent).isNull()
    assertThat(query.maxMoq).isNull()
  }

  @Test
  fun `refuses a band whose minimum is above its maximum`() {
    val outcome = CatalogFilterDraft(minPriceText = "900", maxPriceText = "100")
      .applyTo(CatalogQuery.DEFAULT)

    assertThat(outcome).isInstanceOf(CatalogFilterOutcome.Refused::class.java)
    assertThat((outcome as CatalogFilterOutcome.Refused).message)
      .isEqualTo(CatalogFilterDraft.PRICE_RANGE_MESSAGE)
  }

  @Test
  fun `accepts a band whose bounds are equal`() {
    // "Exactly ₹250" is a legitimate ask, and refusing it would be a rule the
    // shopper cannot see or work around.
    val outcome = CatalogFilterDraft(minPriceText = "250", maxPriceText = "250")
      .applyTo(CatalogQuery.DEFAULT)

    assertThat(outcome).isInstanceOf(CatalogFilterOutcome.Apply::class.java)
  }

  @Test
  fun `refuses a box that holds text the server could not act on`() {
    val outcome = CatalogFilterDraft(minPriceText = "cheap").applyTo(CatalogQuery.DEFAULT)

    assertThat(outcome).isInstanceOf(CatalogFilterOutcome.Refused::class.java)
    assertThat((outcome as CatalogFilterOutcome.Refused).message)
      .isEqualTo(CatalogFilterDraft.PRICE_FORMAT_MESSAGE)
  }

  @Test
  fun `the offered steps are all bounds the server can act on`() {
    // The chip rows are the sheet's guarantees: a step that parsed to null would
    // render as a selectable chip that refuses on Apply.
    assertThat(CatalogFilterDraft.DISCOUNT_STEPS).isNotEmpty()
    CatalogFilterDraft.DISCOUNT_STEPS.forEach { step ->
      assertThat(step).isGreaterThan(0)
      assertThat(CatalogFilterDraft(minDiscountPercent = step).applyTo(CatalogQuery.DEFAULT))
        .isInstanceOf(CatalogFilterOutcome.Apply::class.java)
    }
    assertThat(CatalogFilterDraft.MOQ_STEPS).isNotEmpty()
    CatalogFilterDraft.MOQ_STEPS.forEach { step ->
      assertThat(step).isGreaterThan(0)
      assertThat(CatalogFilterDraft(maxMoq = step).applyTo(CatalogQuery.DEFAULT))
        .isInstanceOf(CatalogFilterOutcome.Apply::class.java)
    }
  }

  // ------------------------------------------------------------- clear filters

  @Test
  fun `clearing the filters keeps the search, the scope and the sort`() {
    val query = CatalogQuery(
      search = "rice",
      categoryId = "cat-1",
      brandId = "brand-1",
      sort = CatalogSort.DISCOUNT,
      favoritesOnly = true,
      minPriceRupees = 100,
      maxPriceRupees = 500,
      minDiscountPercent = 20,
      maxMoq = 5,
      offersOnly = true,
      newOnly = true,
      inStockOnly = true,
    )

    val cleared = query.withAdvancedFiltersCleared()

    assertThat(cleared.search).isEqualTo("rice")
    assertThat(cleared.categoryId).isEqualTo("cat-1")
    assertThat(cleared.brandId).isEqualTo("brand-1")
    assertThat(cleared.sort).isEqualTo(CatalogSort.DISCOUNT)
    assertThat(cleared.favoritesOnly).isTrue()
    assertThat(cleared.minPriceRupees).isNull()
    assertThat(cleared.maxPriceRupees).isNull()
    assertThat(cleared.minDiscountPercent).isNull()
    assertThat(cleared.maxMoq).isNull()
    assertThat(cleared.offersOnly).isFalse()
    assertThat(cleared.newOnly).isFalse()
    assertThat(cleared.inStockOnly).isFalse()
    assertThat(cleared.hasAdvancedFilters).isFalse()
  }

  @Test
  fun `the badge flag agrees with the filters the query actually sends`() {
    // `hasAdvancedFilters` drives the button badge and the "Clear filters" chip.
    // It must not claim a filter that the query's own parameter getters would
    // drop, or the badge counts something the server never received.
    assertThat(CatalogQuery.DEFAULT.hasAdvancedFilters).isFalse()
    assertThat(CatalogQuery(minPriceRupees = 100).hasAdvancedFilters).isTrue()
    assertThat(CatalogQuery(minPriceRupees = 100).minPriceParam).isEqualTo("100")
    assertThat(CatalogQuery(offersOnly = true).offersParam).isEqualTo("1")
    assertThat(CatalogQuery(newOnly = true).newParam).isEqualTo("1")
    // In-stock is a scope chip on the bar, not a sheet filter, so it is not
    // counted as "advanced" — but it is still sent.
    assertThat(CatalogQuery(inStockOnly = true).hasAdvancedFilters).isFalse()
    assertThat(CatalogQuery(inStockOnly = true).inStockParam).isEqualTo("1")
  }
}
