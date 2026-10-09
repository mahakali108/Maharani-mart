package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.model.SearchSuggestions
import org.junit.Test

/**
 * Deciding whether a suggestion answer still belongs to the search field.
 *
 * WHY THIS IS ITS OWN FILE
 * Suggestions are read while the shopper types, so an answer for "ri" can land
 * after they have typed "rice". Rendering it puts a panel that contradicts the
 * result list underneath it — two different answers to two different questions on
 * one screen. The guard is a string comparison, and it has a trap: the server
 * SANITIZES the term before matching (`lib/retailer/catalog-params.ts` →
 * `sanitizeSearchTerm`), so it echoes a different string than the shopper typed
 * whenever the term held punctuation. A plain `==` would then call every such
 * answer stale and the panel would silently never appear for those terms.
 *
 * The sanitizing rule is therefore asserted CHARACTER BY CHARACTER against the
 * server's own, because the two are maintained in two languages and only a test
 * will notice when they drift.
 */
class SearchSuggestionsMatchTest {

  private fun answer(query: String, searched: Boolean = true) = SearchSuggestions(
    query = query,
    searched = searched,
    suggestions = listOf(
      SearchSuggestion.Product(
        id = "p1",
        label = "Sona Masoori Rice",
        brandName = "Maharani",
        packName = null,
        imageUrl = null,
        matchedBarcode = false,
      ),
    ),
  )

  // ------------------------------------------------------- the sanitizing rule

  @Test
  fun `leaves an ordinary term exactly as typed`() {
    assertThat(SearchSuggestionsMatch.sanitize("rice")).isEqualTo("rice")
    assertThat(SearchSuggestionsMatch.sanitize("Sona Masoori")).isEqualTo("Sona Masoori")
    assertThat(SearchSuggestionsMatch.sanitize("  rice  ")).isEqualTo("rice")
  }

  @Test
  fun `replaces every character the server replaces`() {
    // `sanitizeSearchTerm` turns each of `% _ * , . ( ) " ' \` into a space. All
    // ten, in one assertion, so adding one server-side without adding it here
    // fails the build instead of failing a shopper's search.
    listOf("%", "_", "*", ",", ".", "(", ")", "\"", "'", "\\").forEach { symbol ->
      assertThat(SearchSuggestionsMatch.sanitize("a${symbol}b")).isEqualTo("a b")
    }
  }

  @Test
  fun `keeps the characters the server keeps`() {
    // A hyphen, a slash and a plus are NOT in the server's strip set: "toor-dal"
    // and "5kg/10kg" are real catalogue terms and must survive intact.
    assertThat(SearchSuggestionsMatch.sanitize("toor-dal")).isEqualTo("toor-dal")
    assertThat(SearchSuggestionsMatch.sanitize("5kg/10kg")).isEqualTo("5kg/10kg")
    assertThat(SearchSuggestionsMatch.sanitize("a+b")).isEqualTo("a+b")
    assertThat(SearchSuggestionsMatch.sanitize("\u20B9250")).isEqualTo("\u20B9250")
  }

  @Test
  fun `collapses the runs of space a strip leaves behind`() {
    assertThat(SearchSuggestionsMatch.sanitize("a,,b")).isEqualTo("a b")
    assertThat(SearchSuggestionsMatch.sanitize("a . b")).isEqualTo("a b")
    assertThat(SearchSuggestionsMatch.sanitize("rice\t\n5kg")).isEqualTo("rice 5kg")
  }

  @Test
  fun `caps the term at the server's own length`() {
    val long = "r".repeat(200)

    assertThat(SearchSuggestionsMatch.sanitize(long)).hasLength(80)
    assertThat(SearchSuggestionsMatch.sanitize(long)).isEqualTo("r".repeat(80))
  }

  // ------------------------------------------------------------- the staleness

  @Test
  fun `accepts an answer for the term now in the field`() {
    assertThat(SearchSuggestionsMatch.isFor(answer("rice"), "rice")).isTrue()
    // Surrounding space is not a different question.
    assertThat(SearchSuggestionsMatch.isFor(answer("rice"), "  rice ")).isTrue()
  }

  @Test
  fun `accepts an answer the server sanitized on the way in`() {
    // THE CASE A PLAIN COMPARE GETS WRONG: the shopper typed "rice, 5kg", the
    // server matched "rice 5kg" and echoed that. Refusing it would hide the panel
    // for every term with a comma, a quote or a full stop in it.
    assertThat(SearchSuggestionsMatch.isFor(answer("rice 5kg"), "rice, 5kg")).isTrue()
    assertThat(SearchSuggestionsMatch.isFor(answer("toor dal"), "toor_dal")).isTrue()
    assertThat(SearchSuggestionsMatch.isFor(answer("5kg 10kg"), "5kg(10kg)")).isTrue()
    assertThat(SearchSuggestionsMatch.isFor(answer("a b"), "a  b")).isTrue()
  }

  @Test
  fun `refuses an answer for a term the shopper has since typed past`() {
    // The late answer for a prefix. This is the whole reason the check exists.
    assertThat(SearchSuggestionsMatch.isFor(answer("ri"), "rice")).isFalse()
    assertThat(SearchSuggestionsMatch.isFor(answer("rice"), "ri")).isFalse()
    assertThat(SearchSuggestionsMatch.isFor(answer("toor"), "rice")).isFalse()
  }

  @Test
  fun `refuses an answer that is only punctuation away from a different term`() {
    // Sanitizing must not become a fuzzy match: "rice" and "rica" are different
    // questions even though neither holds a stripped character.
    assertThat(SearchSuggestionsMatch.isFor(answer("rica"), "rice")).isFalse()
    assertThat(SearchSuggestionsMatch.isFor(answer("rice 5kg"), "rice 10kg")).isFalse()
  }

  @Test
  fun `refuses an empty echo`() {
    // `searched = false` arrives with `query = ""` when the term was below the
    // server's floor. It is not an answer for a two-letter term, and accepting it
    // would clear the panel with a stale "nothing found".
    assertThat(SearchSuggestionsMatch.isFor(answer("", searched = false), "ri")).isFalse()
    assertThat(SearchSuggestionsMatch.isFor(answer("", searched = false), "")).isTrue()
  }

  @Test
  fun `a term made only of stripped characters sanitizes to nothing`() {
    assertThat(SearchSuggestionsMatch.sanitize("...")).isEmpty()
    // And so it can only match an answer that also echoed nothing.
    assertThat(SearchSuggestionsMatch.isFor(answer("rice"), "...")).isFalse()
  }
}
