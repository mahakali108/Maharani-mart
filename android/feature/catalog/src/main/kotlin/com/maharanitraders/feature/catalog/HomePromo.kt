package com.maharanitraders.feature.catalog

import com.maharanitraders.core.model.HomeScheme

/**
 * The home screen's promotional copy, derived ONLY from rows an admin published.
 *
 * WHY THIS FILE EXISTS
 * A "super store" home lives or dies on its promotional strip, and the easy way
 * to build one is to hardcode a few lines of copy. That is fabrication: the app
 * would announce a festival sale nobody scheduled and keep announcing it after
 * the window closed. So this file has no strings of its own — it turns the
 * `schemes` rows `GET /home` returns (active + inside their window, soonest-ending
 * first) into the display rows the home screen draws, and computes the deadline from the
 * row's own `ends_at`. No scheme, no strip and no rail: neither is drawn at all.
 *
 * A scheme carries no discount value in this backend — its pricing effect is
 * already inside the per-retailer rate the catalogue resolves — so nothing here
 * invents a percentage either. What it can honestly say is the campaign's name,
 * whether it is a festival campaign, and when it ends.
 *
 * DATE HANDLING
 * `java.time` is avoided on purpose: at `minSdk 24` it needs core-library
 * desugaring, and this only needs a day count. Timestamps arrive as the server's
 * ISO-8601 UTC (`2026-11-05T00:00:00.000Z`) and the date part is taken as the
 * UTC calendar date the server sent, matching `IsoDateDisplay`'s rule — the label
 * is a whole-day granularity ("Ends in 3 days"), never a clock time, so a
 * timezone shift cannot make it wrong by a day in a way the shopper can act on.
 */
object HomePromo {

  private val MILLIS_PER_DAY = 86_400_000L

  private val MONTHS = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  )

  /**
   * One live offer, ready to draw: the campaign's own name and description, the
   * deadline computed from its stored window, and whether the admin flagged it a
   * festival campaign.
   *
   * The ticker strip and the offers rail are both projections of THIS list, from
   * ONE clock read, so a campaign can never announce two different deadlines on
   * the same screen.
   */
  data class OfferCard(
    val id: String,
    /** The campaign's own name, as the admin wrote it. */
    val name: String,
    /** The admin's own one-line description; null when the row has none. */
    val description: String?,
    /** "Ends today" / "Ends in 3 days" / "Ends 05 Nov 2026"; null when unparseable. */
    val deadline: String?,
    val isFestival: Boolean,
  )

  /**
   * The live offers, in the order the server sent them (soonest-ending first).
   *
   * A row with a blank name is dropped rather than rendered as an empty card:
   * one unreadable campaign must not blank the strip, and must not scroll by as
   * whitespace either. A blank description becomes `null`, so the rail draws one
   * line instead of a line plus an empty one.
   */
  fun cards(schemes: List<HomeScheme>, nowMillis: Long): List<OfferCard> = schemes.mapNotNull { scheme ->
    val name = scheme.name.trim()
    if (name.isEmpty()) return@mapNotNull null
    val description = scheme.description?.trim()?.takeIf { it.isNotEmpty() }
    OfferCard(
      id = scheme.id,
      name = name,
      description = description,
      deadline = deadlineLabel(scheme.endsAt, nowMillis),
      isFestival = scheme.isFestival,
    )
  }

  /**
   * "Ends today", "Ends tomorrow", "Ends in N days", or the plain date once the
   * window is long enough that a day count stops being the useful fact.
   *
   * `null` when the stored value cannot be read — the line then shows the name
   * alone rather than a guessed deadline.
   */
  fun deadlineLabel(endsAt: String?, nowMillis: Long): String? {
    val days = daysUntil(endsAt, nowMillis) ?: return null
    return when {
      days < 0 -> null
      days == 0 -> "Ends today"
      days == 1 -> "Ends tomorrow"
      days <= 30 -> "Ends in $days days"
      else -> "Ends ${formatDate(endsAt)}"
    }
  }

  /** `2026-11-05T00:00:00.000Z` → `05 Nov 2026`; null when unparseable. */
  fun formatDate(iso: String?): String? {
    val parts = civilDate(iso) ?: return null
    return "%02d %s %d".format(parts.third, MONTHS[parts.second - 1], parts.first)
  }

  /** Whole UTC days from today until the stored date, or null when unparseable. */
  fun daysUntil(iso: String?, nowMillis: Long): Int? {
    val parts = civilDate(iso) ?: return null
    val target = epochDay(parts.first, parts.second, parts.third)
    val today = Math.floorDiv(nowMillis, MILLIS_PER_DAY)
    return (target - today).toInt()
  }

  /** `(year, month, day)` from the leading `yyyy-MM-dd` of an ISO timestamp. */
  private fun civilDate(iso: String?): Triple<Int, Int, Int>? {
    val value = iso?.trim().orEmpty()
    if (value.length < 10) return null
    if (value[4] != '-' || value[7] != '-') return null
    val year = value.substring(0, 4).toIntOrNull() ?: return null
    val month = value.substring(5, 7).toIntOrNull() ?: return null
    val day = value.substring(8, 10).toIntOrNull() ?: return null
    if (month !in 1..12 || day !in 1..31) return null
    return Triple(year, month, day)
  }

  /**
   * Days since 1970-01-01 for a proleptic Gregorian civil date.
   *
   * The standard shifted-calendar algorithm (Hinnant's `days_from_civil`), which
   * needs no calendar library and no timezone: it is pure integer arithmetic over
   * the date the server sent. The `719468` constant is that algorithm's own
   * offset from its 0000-03-01 internal epoch to the Unix epoch — without it the
   * day count is right but the anchor is 1970 years off, and every deadline would
   * read "Ends in 700000 days".
   */
  private fun epochDay(year: Int, month: Int, day: Int): Long {
    val shiftedYear = if (month <= 2) year - 1 else year
    val era = Math.floorDiv(shiftedYear, 400)
    val yearOfEra = shiftedYear - era * 400
    val shiftedMonth = if (month > 2) month - 3 else month + 9
    val dayOfYear = (153 * shiftedMonth + 2) / 5 + day - 1
    val dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
    return dayOfEra + era * 146_097L - 719_468L
  }
}
