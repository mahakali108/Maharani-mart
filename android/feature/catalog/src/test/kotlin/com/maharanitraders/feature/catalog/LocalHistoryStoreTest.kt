package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * The device-local shopping history.
 *
 * These tests run against the REAL store over an in-memory [InMemoryPreferenceStore]:
 * the behaviour under test is the encoding round trip, the ordering rules, the
 * caps and the session wipe — all of which would be invisible if the store were
 * faked, and all of which are the difference between a useful rail and one that
 * shows another account's data or a stale duplicate.
 */
class LocalHistoryStoreTest {

  @Test
  fun `remembers searches newest first and moves a repeat to the front`() = runTest {
    val history = localHistoryStore()

    history.recordSearch("atta")
    history.recordSearch("rice 25kg")
    history.recordSearch("ATTA")

    // Case-insensitive de-duplication: "atta" and "ATTA" are one search, and the
    // newest spelling is what the chip shows.
    assertThat(history.recentSearches.value).containsExactly("ATTA", "rice 25kg").inOrder()
  }

  @Test
  fun `ignores blank searches and caps the list`() = runTest {
    val history = localHistoryStore()
    history.recordSearch("   ")

    repeat(12) { index -> history.recordSearch("term $index") }

    assertThat(history.recentSearches.value).hasSize(8)
    assertThat(history.recentSearches.value.first()).isEqualTo("term 11")
  }

  @Test
  fun `survives a process restart by reading the same preferences`() = runTest {
    val preferences = InMemoryPreferenceStore()
    val first = localHistoryStore(preferences)
    first.recordSearch("sugar")
    first.recordView(RecentlyViewedProduct(id = "p1", name = "Sugar 50kg", brandName = "Maharani"))

    // A cold start is a NEW store instance over the same preferences file.
    val second = localHistoryStore(preferences)
    second.ensureLoaded()

    assertThat(second.recentSearches.value).containsExactly("sugar")
    assertThat(second.recentlyViewed.value).hasSize(1)
    assertThat(second.recentlyViewed.value.single().name).isEqualTo("Sugar 50kg")
    assertThat(second.recentlyViewed.value.single().brandName).isEqualTo("Maharani")
  }

  @Test
  fun `a view round trip keeps every field and de-duplicates by product`() = runTest {
    val history = localHistoryStore()
    history.recordView(
      RecentlyViewedProduct(
        id = "p1",
        name = "Basmati Rice",
        brandName = "India Gate",
        packName = "25kg",
        imageUrl = "https://cdn.example/rice.jpg",
      ),
    )
    history.recordView(RecentlyViewedProduct(id = "p2", name = "Sunflower Oil 15L"))
    history.recordView(RecentlyViewedProduct(id = "p1", name = "Basmati Rice", packName = "25kg"))

    val viewed = history.recentlyViewed.value
    assertThat(viewed).hasSize(2)
    assertThat(viewed.first().id).isEqualTo("p1")
    assertThat(viewed.first().packName).isEqualTo("25kg")
    assertThat(viewed.last().id).isEqualTo("p2")
    // The first view's brand is kept from the newest record of that product —
    // the store never merges two different products into one tile.
    assertThat(viewed.first().brandName).isNull()
  }

  @Test
  fun `fields containing the record delimiters survive a round trip`() = runTest {
    val preferences = InMemoryPreferenceStore()
    val first = localHistoryStore(preferences)
    // A product name is server data. It is not expected to contain control
    // characters, but if it ever did, the encoding must not merge two records
    // into one — which is exactly what an unescaped delimiter would do.
    val awkward = RecentlyViewedProduct(
      id = "p1",
      name = "Rice\u001F25kg\u001Egrade A",
      imageUrl = "https://cdn.example/a%20b.jpg",
    )
    first.recordView(awkward)

    val second = localHistoryStore(preferences)
    second.ensureLoaded()

    assertThat(second.recentlyViewed.value.single().name).isEqualTo("Rice\u001F25kg\u001Egrade A")
    assertThat(second.recentlyViewed.value.single().imageUrl).isEqualTo("https://cdn.example/a%20b.jpg")
  }

  @Test
  fun `corrupt stored data is ignored instead of crashing the home screen`() = runTest {
    val preferences = InMemoryPreferenceStore()
    preferences.putString("recently_viewed_v1", "\u001F\u001Fnonsense")
    preferences.putString("recent_searches_v1", "")

    val history = localHistoryStore(preferences)
    history.ensureLoaded()

    assertThat(history.recentlyViewed.value).isEmpty()
    assertThat(history.recentSearches.value).isEmpty()
  }

  @Test
  fun `clearing searches leaves the view history alone`() = runTest {
    val history = localHistoryStore()
    history.recordSearch("masala")
    history.recordView(RecentlyViewedProduct(id = "p1", name = "Masala 500g"))

    history.clearSearches()

    assertThat(history.recentSearches.value).isEmpty()
    assertThat(history.recentlyViewed.value).hasSize(1)
  }

  @Test
  fun `signing out wipes both lists from memory and from disk`() = runTest {
    val preferences = InMemoryPreferenceStore()
    val history = localHistoryStore(preferences)
    history.recordSearch("masala")
    history.recordView(RecentlyViewedProduct(id = "p1", name = "Masala 500g"))
    assertThat(history.recentSearches.value).isNotEmpty()

    history.onSessionEnded()

    // Nothing is readable through this instance…
    assertThat(history.recentSearches.value).isEmpty()
    assertThat(history.recentlyViewed.value).isEmpty()
    // …and the next account on the same phone cannot read it either.
    val nextAccount = localHistoryStore(preferences)
    nextAccount.ensureLoaded()
    assertThat(nextAccount.recentSearches.value).isEmpty()
    assertThat(nextAccount.recentlyViewed.value).isEmpty()
  }
}
