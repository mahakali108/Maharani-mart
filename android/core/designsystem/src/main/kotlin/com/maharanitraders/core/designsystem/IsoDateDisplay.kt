package com.maharanitraders.core.designsystem

/**
 * Display-only conversion of the server's ISO-8601 UTC timestamps.
 *
 * The backend sends timestamps such as `2026-10-08T00:00:00.000Z` (Postgres
 * `timestamptz` rendered by PostgREST). The app deliberately avoids `java.time`
 * here: with `minSdk 24` those APIs need core-library desugaring, and the
 * requirement is limited to showing a date.
 *
 * Rules:
 *  - the date part is never reinterpreted in another zone — it is rendered as
 *    the UTC calendar date the server sent, and the UI labels it as UTC;
 *  - an unexpected shape is returned unchanged, so a server change degrades to
 *    "shows the raw value" rather than showing a wrong date.
 */
object IsoDateDisplay {

  private val MONTHS = listOf(
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  )

  /** `2026-10-08T00:00:00.000Z` → `08 Oct 2026`. Unparseable input is returned as-is. */
  fun formatDate(iso: String?): String? {
    val value = iso?.trim().orEmpty()
    if (value.isEmpty()) return null
    if (value.length < 10) return iso

    val year = value.substring(0, 4).toIntOrNull() ?: return iso
    val month = value.substring(5, 7).toIntOrNull() ?: return iso
    val day = value.substring(8, 10).toIntOrNull() ?: return iso
    if (value[4] != '-' || value[7] != '-') return iso
    if (month !in 1..12 || day !in 1..31) return iso

    return "%02d %s %d".format(day, MONTHS[month - 1], year)
  }
}
