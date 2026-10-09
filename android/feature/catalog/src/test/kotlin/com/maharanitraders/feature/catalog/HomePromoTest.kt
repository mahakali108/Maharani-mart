package com.maharanitraders.feature.catalog

import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.model.HomeScheme
import org.junit.Test

/**
 * The home screen's promotional copy.
 *
 * WHY THESE TESTS EXIST
 * A promotional strip is the easiest place in a shopping app to fabricate: a
 * hardcoded "Festival sale — 40% off" looks perfect in a screenshot and is a lie
 * the moment the campaign ends. So the rule this file pins down is that
 * [HomePromo] has no copy of its own — every line is derived from a `schemes` row
 * an admin published, and every deadline is counted from that row's own window.
 *
 * The date arithmetic gets its own attention because it is done without
 * `java.time` (unavailable at `minSdk 24` without desugaring): a hand-rolled
 * civil-date-to-days conversion is exactly the kind of code that is right for
 * this month and wrong by a constant for every other one.
 */
class HomePromoTest {

  /** 2026-10-08T00:00:00Z — "today" for every deadline below. */
  private val now = 1_791_417_600_000L

  private fun scheme(
    id: String = "s1",
    name: String = "Diwali wholesale week",
    description: String? = "Extra slab rates on staples",
    isFestival: Boolean = false,
    endsAt: String = "2026-11-05T00:00:00.000Z",
  ) = HomeScheme(
    id = id,
    name = name,
    description = description,
    isFestival = isFestival,
    startsAt = "2026-10-01T00:00:00.000Z",
    endsAt = endsAt,
  )

  // ------------------------------------------------------------- the deadline

  @Test
  fun `counts a deadline that falls today`() {
    assertThat(HomePromo.deadlineLabel("2026-10-08T00:00:00.000Z", now)).isEqualTo("Ends today")
    // The stored value carries a clock time; the label is whole-day, so a window
    // closing later the same day still reads "today".
    assertThat(HomePromo.deadlineLabel("2026-10-08T18:30:00.000Z", now)).isEqualTo("Ends today")
  }

  @Test
  fun `counts tomorrow, and the days after it`() {
    assertThat(HomePromo.deadlineLabel("2026-10-09T00:00:00.000Z", now)).isEqualTo("Ends tomorrow")
    assertThat(HomePromo.deadlineLabel("2026-10-11T00:00:00.000Z", now)).isEqualTo("Ends in 3 days")
    assertThat(HomePromo.deadlineLabel("2026-11-05T00:00:00.000Z", now)).isEqualTo("Ends in 28 days")
  }

  @Test
  fun `gives the date once a day count stops being the useful fact`() {
    // "Ends in 78 days" tells a shopkeeper nothing actionable; the date does.
    assertThat(HomePromo.deadlineLabel("2026-12-25T00:00:00.000Z", now))
      .isEqualTo("Ends 25 Dec 2026")
    assertThat(HomePromo.deadlineLabel("2027-10-08T00:00:00.000Z", now))
      .isEqualTo("Ends 08 Oct 2027")
  }

  @Test
  fun `says nothing about a window that has already closed`() {
    // The server only sends live rows, so this is the belt to that brace: a
    // stale row must not announce a deadline in the past.
    assertThat(HomePromo.deadlineLabel("2026-10-07T00:00:00.000Z", now)).isNull()
    assertThat(HomePromo.deadlineLabel("2019-01-01T00:00:00.000Z", now)).isNull()
  }

  @Test
  fun `refuses to guess a deadline it cannot read`() {
    // Null means "show the campaign name alone". Every alternative — a blank
    // label, "Ends soon", epoch zero — would be a fabricated fact.
    assertThat(HomePromo.deadlineLabel(null, now)).isNull()
    assertThat(HomePromo.deadlineLabel("", now)).isNull()
    assertThat(HomePromo.deadlineLabel("not-a-date", now)).isNull()
    assertThat(HomePromo.deadlineLabel("2026-13-45T00:00:00.000Z", now)).isNull()
    assertThat(HomePromo.deadlineLabel("2026/10/08", now)).isNull()
    assertThat(HomePromo.deadlineLabel("2026-10", now)).isNull()
  }

  @Test
  fun `anchors the day count at the unix epoch`() {
    // THE REGRESSION THIS GUARDS: the shifted-calendar algorithm counts days from
    // its own internal epoch of 0000-03-01 and needs a 719468-day offset to reach
    // 1970-01-01. Without it the arithmetic is internally consistent and every
    // deadline in the app reads "Ends in 719468 days".
    assertThat(HomePromo.daysUntil("1970-01-01T00:00:00.000Z", 0L)).isEqualTo(0)
    assertThat(HomePromo.daysUntil("1970-01-02T00:00:00.000Z", 0L)).isEqualTo(1)
    assertThat(HomePromo.daysUntil("2026-10-08T00:00:00.000Z", now)).isEqualTo(0)
    assertThat(HomePromo.daysUntil("2026-11-05T00:00:00.000Z", now)).isEqualTo(28)
  }

  @Test
  fun `counts across a leap day and a year boundary`() {
    // 2028 is a leap year: 2028-02-28 to 2028-03-01 is two days, not one.
    val leapDay = 1_835_308_800_000L // 2028-02-28T00:00:00Z
    assertThat(HomePromo.daysUntil("2028-02-29T00:00:00.000Z", leapDay)).isEqualTo(1)
    assertThat(HomePromo.daysUntil("2028-03-01T00:00:00.000Z", leapDay)).isEqualTo(2)
    // A whole non-leap year, and the day before it.
    assertThat(HomePromo.daysUntil("2027-10-08T00:00:00.000Z", now)).isEqualTo(365)
    assertThat(HomePromo.daysUntil("2026-10-07T00:00:00.000Z", now)).isEqualTo(-1)
  }

  @Test
  fun `formats the stored date the way the app writes dates elsewhere`() {
    assertThat(HomePromo.formatDate("2026-11-05T00:00:00.000Z")).isEqualTo("05 Nov 2026")
    assertThat(HomePromo.formatDate("2026-01-09T23:59:59.000Z")).isEqualTo("09 Jan 2026")
    assertThat(HomePromo.formatDate(null)).isNull()
    assertThat(HomePromo.formatDate("garbage")).isNull()
  }

  // -------------------------------------------------------------- the cards

  @Test
  fun `builds one card per published scheme, in the order the server sent`() {
    val schemes = listOf(
      scheme(id = "s1", name = "Diwali wholesale week", endsAt = "2026-11-05T00:00:00.000Z"),
      scheme(
        id = "s2",
        name = "Monsoon staples",
        description = null,
        isFestival = true,
        endsAt = "2026-10-09T00:00:00.000Z",
      ),
    )

    val cards = HomePromo.cards(schemes, now)

    // Soonest-ending first is the server's own ordering; the app must not re-sort
    // it, or the ticker would lead with a campaign that is not the urgent one.
    assertThat(cards.map { it.id }).containsExactly("s1", "s2").inOrder()
    assertThat(cards[0].name).isEqualTo("Diwali wholesale week")
    assertThat(cards[0].description).isEqualTo("Extra slab rates on staples")
    assertThat(cards[0].deadline).isEqualTo("Ends in 28 days")
    assertThat(cards[0].isFestival).isFalse()
    assertThat(cards[1].deadline).isEqualTo("Ends tomorrow")
    assertThat(cards[1].isFestival).isTrue()
  }

  @Test
  fun `draws nothing at all when no scheme is published`() {
    // Not "no offers right now" copy, not a placeholder card: an empty list means
    // the home screen does not render the section.
    assertThat(HomePromo.cards(emptyList(), now)).isEmpty()
  }

  @Test
  fun `drops a row with no readable name instead of rendering an empty card`() {
    val cards = HomePromo.cards(
      listOf(
        scheme(id = "blank", name = "   "),
        scheme(id = "named", name = "  Winter stock-up  "),
      ),
      now,
    )

    // One unreadable campaign must not blank the strip, and must not scroll by as
    // whitespace either.
    assertThat(cards.map { it.id }).containsExactly("named")
    assertThat(cards[0].name).isEqualTo("Winter stock-up")
  }

  @Test
  fun `turns a blank description into no second line`() {
    // A card that draws an empty line under its title is a card with a hole in it.
    assertThat(HomePromo.cards(listOf(scheme(description = "   ")), now)[0]!!.description).isNull()
    assertThat(HomePromo.cards(listOf(scheme(description = null)), now)[0]!!.description).isNull()
    assertThat(HomePromo.cards(listOf(scheme(description = " Rates ")), now)[0]!!.description)
      .isEqualTo("Rates")
  }

  @Test
  fun `a card with an unreadable window still names the campaign`() {
    val cards = HomePromo.cards(listOf(scheme(endsAt = "not-a-date")), now)

    assertThat(cards).hasSize(1)
    assertThat(cards[0].name).isEqualTo("Diwali wholesale week")
    assertThat(cards[0].deadline).isNull()
  }

  @Test
  fun `no card ever carries a discount the server did not send`() {
    // A scheme in this backend has NO percentage: its pricing effect is already
    // inside the per-retailer rate the catalogue resolves. This is the assertion
    // that keeps a future "40% OFF" out of a card that was never given a number.
    val cards = HomePromo.cards(listOf(scheme(isFestival = true)), now)

    val rendered = cards.joinToString(" ") { "${it.name} ${it.description} ${it.deadline}" }
    assertThat(rendered).doesNotContain("%")
    assertThat(rendered).doesNotContain("off")
    assertThat(rendered).doesNotContain("\u20B9")
  }
}
