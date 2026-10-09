package com.maharanitraders.feature.catalog

import com.maharanitraders.core.model.SearchSuggestions

/**
 * Deciding whether a suggestion answer still belongs to the search field.
 *
 * WHY THIS EXISTS
 * Suggestions are read while the shopper types, so an answer for "ri" can land
 * after they have typed "rice". Rendering it would put a panel next to a result
 * list that contradicts it. The answer carries the term the server matched
 * (`SearchSuggestions.query`), so the check is a comparison — but the server
 * SANITIZES the term first (`lib/retailer/catalog-params.ts` →
 * `sanitizeSearchTerm`: it replaces `% _ * , . ( ) " ' \` with spaces, collapses
 * whitespace and caps the length at 80), so a raw string compare would call
 * every answer stale the moment the shopper typed a hyphen or a quote.
 *
 * WHAT THIS IS NOT
 * This is a staleness check on a DISPLAY value. It re-states the server's
 * character rule only so the two strings can be compared; it never decides what
 * matches a product, and it cannot widen or narrow a query — the term sent to
 * the server is the shopper's own, and the server sanitizes it again.
 */
object SearchSuggestionsMatch {

  private val STRIPPED = Regex("[%_*,.()\"'\\\\]")
  private val WHITESPACE = Regex("\\s+")

  /** The server's own sanitizing, restated for comparison. */
  fun sanitize(raw: String): String = raw
    .replace(STRIPPED, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .take(80)

  /**
   * True when [answer] was produced for the term currently in the field.
   *
   * Both comparisons are accepted on purpose: the plain trimmed term covers the
   * overwhelmingly common case (no punctuation, so the server echoed it
   * unchanged) and the sanitized form covers a term that contained one. An
   * answer for a DIFFERENT term is refused by both, which is the case that
   * matters.
   */
  fun isFor(answer: SearchSuggestions, currentTerm: String): Boolean {
    val trimmed = currentTerm.trim()
    return answer.query == trimmed || answer.query == sanitize(trimmed)
  }
}
