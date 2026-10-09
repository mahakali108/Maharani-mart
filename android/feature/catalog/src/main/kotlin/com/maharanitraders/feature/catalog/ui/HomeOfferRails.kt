package com.maharanitraders.feature.catalog.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.AccentIcon
import com.maharanitraders.core.designsystem.components.BoltGlyph
import com.maharanitraders.core.designsystem.components.ChevronRightGlyph
import com.maharanitraders.core.designsystem.components.OfferGlyph
import com.maharanitraders.core.designsystem.theme.AccentTone
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.catalog.HomePromo
import kotlinx.coroutines.delay

/**
 * The home screen's promotional surfaces: the admin ticker strip and the
 * "Today's offers" rail.
 *
 * WHY THIS FILE EXISTS
 * Both are drawn ONLY from `schemes` rows an admin published — the same rows the
 * offers screen reads, sent inside `GET /api/mobile/v1/home` as `schemes`. That
 * is what makes them merchandising rather than decoration: a campaign appears
 * when it is scheduled, disappears when its window closes, and the app never has
 * to be rebuilt to change what the shop front is promoting.
 *
 * WHAT THEY DELIBERATELY DO NOT SAY
 * A scheme carries no discount value in this backend — its pricing effect is
 * already inside the per-retailer rate the catalogue resolves. So neither
 * surface prints a percentage, a "save ₹X" or a struck-through price it was not
 * given. They say the campaign's own name, the admin's own description, whether
 * it is a festival campaign, and when it ends. The numbers stay where the server
 * puts them: on the product card and at checkout.
 */
object HomeOfferTags {
  /** The cycling strip at the top of home. */
  const val TICKER = "home_offer_ticker"

  /** The line currently showing in the strip. */
  const val TICKER_LINE = "home_offer_ticker_line"

  /** The horizontal rail of live campaigns. */
  const val OFFER_RAIL = "home_offer_rail"

  /** One campaign card inside [OFFER_RAIL]. */
  const val OFFER_CARD = "home_offer_card"

  /**
   * Shown instead of the rail when the offer read FAILED rather than returning
   * nothing. Distinct on purpose: an outage must never be allowed to look like a
   * shop with no offers.
   */
  const val OFFERS_UNAVAILABLE = "home_offers_unavailable"

  /** The "Deals" rail: the catalogue's own `offers=1` batch. */
  const val DEALS_ROW = "home_deals_row"
}

/** How long one campaign stays on the strip before it rolls to the next. */
private const val TICKER_INTERVAL_MS = 4_000L

/**
 * The admin ticker: a thin strip above the hero that cycles the live campaigns,
 * soonest-ending first, and opens the offers destination on tap.
 *
 * [autoAdvance] exists so a rendered test can pin the strip on its first line —
 * a test that waits for an animation it did not ask for is a flaky test, and the
 * cycling itself is not what the test is about.
 *
 * The strip is 48dp tall because it is tappable: a control that opens a screen
 * gets the same target as one that adds to a cart, however little ink it uses.
 */
@Composable
fun HomeOfferTicker(
  promotions: List<HomePromo.OfferCard>,
  onOpenOffers: () -> Unit,
  modifier: Modifier = Modifier,
  autoAdvance: Boolean = true,
) {
  val current = promotions.firstOrNull() ?: return
  var index by remember(promotions.size) { mutableIntStateOf(0) }

  LaunchedEffect(promotions.size, autoAdvance) {
    if (!autoAdvance || promotions.size < 2) return@LaunchedEffect
    while (true) {
      delay(TICKER_INTERVAL_MS)
      index = (index + 1) % promotions.size
    }
  }

  val line = promotions.getOrElse(index.coerceIn(0, promotions.lastIndex)) { current }

  Surface(
    onClick = onOpenOffers,
    shape = RoundedCornerShape(MaharaniDimens.radiusPill),
    color = MaterialTheme.colorScheme.primaryContainer,
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget)
      .testTag(HomeOfferTags.TICKER),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(
          start = MaharaniDimens.spaceMd,
          end = MaharaniDimens.spaceXs,
          top = MaharaniDimens.spaceXs,
          bottom = MaharaniDimens.spaceXs,
        ),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      OfferGlyph(
        modifier = Modifier.size(18.dp),
        tint = MaterialTheme.colorScheme.onPrimaryContainer,
      )
      // One line, rolling upward: the strip keeps a constant height whatever the
      // campaign name's length, so the hero below it never jumps as it cycles.
      Box(
        modifier = Modifier
          .weight(1f)
          .heightIn(min = 32.dp)
          .testTag(HomeOfferTags.TICKER_LINE),
        contentAlignment = Alignment.CenterStart,
      ) {
        AnimatedContent(
          targetState = line,
          transitionSpec = {
            slideInVertically { it } togetherWith slideOutVertically { -it }
          },
          label = "home-offer-ticker",
        ) { showing ->
          Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(
              text = showing.name,
              style = MaterialTheme.typography.labelLarge,
              fontWeight = FontWeight.SemiBold,
              color = MaterialTheme.colorScheme.onPrimaryContainer,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
            if (showing.deadline != null) {
              Text(
                text = showing.deadline,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
          }
        }
      }
      if (promotions.size > 1) {
        Text(
          text = "${index.coerceIn(0, promotions.lastIndex) + 1}/${promotions.size}",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
      }
      ChevronRightGlyph(
        modifier = Modifier.size(16.dp),
        tint = MaterialTheme.colorScheme.onPrimaryContainer,
      )
    }
  }
}

/**
 * "Today's offers": one card per live campaign, soonest-ending first.
 *
 * The cards are narrow and text-led on purpose. There is no campaign artwork in
 * this backend — a `schemes` row is a name, an optional line of copy, a festival
 * flag and a window — so a card that showed an image would be showing one the
 * admin never uploaded. What it can honestly sell is urgency: the deadline is
 * the fact that makes a shopper tap.
 */
@Composable
fun HomeOffersRail(
  promotions: List<HomePromo.OfferCard>,
  onOpenOffers: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (promotions.isEmpty()) return

  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeOfferTags.OFFER_RAIL),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    items(promotions, key = { it.id }) { promotion ->
      HomeOfferCard(promotion = promotion, onOpenOffers = onOpenOffers)
    }
  }
}

@Composable
private fun HomeOfferCard(
  promotion: HomePromo.OfferCard,
  onOpenOffers: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    onClick = onOpenOffers,
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .width(MaharaniDimens.railCardWidth)
      .testTag(HomeOfferTags.OFFER_CARD),
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .heightIn(min = MaharaniDimens.touchTarget)
        .padding(MaharaniDimens.cardPadding),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        AccentIcon(
          tone = AccentTone.AMBER,
          size = 34.dp,
          glyph = { tint -> OfferGlyph(tint = tint) },
        )
        if (promotion.isFestival) {
          Surface(
            shape = RoundedCornerShape(MaharaniDimens.radiusChip),
            color = MaterialTheme.colorScheme.secondaryContainer,
          ) {
            Row(
              modifier = Modifier.padding(
                horizontal = MaharaniDimens.spaceXs,
                vertical = 2.dp,
              ),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
              BoltGlyph(
                modifier = Modifier.size(11.dp),
                tint = MaterialTheme.colorScheme.onSecondaryContainer,
              )
              Text(
                text = "Festival",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
              )
            }
          }
        }
      }

      Text(
        text = promotion.name,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      if (promotion.description != null) {
        Text(
          text = promotion.description,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
      if (promotion.deadline != null) {
        Text(
          text = promotion.deadline,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.Medium,
          color = MaterialTheme.colorScheme.primary,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

/**
 * The honest fallback when the offer read failed.
 *
 * One line, not an error card: the shop is perfectly usable without it, and a
 * full-width error would claim the home failed when only its promotional read
 * did. What it must NOT do is stay silent — silence is how "no offers right now"
 * gets said about an outage, which is exactly the confusion this app forbids.
 * Prices, stock and totals are unaffected, so the line says so.
 */
@Composable
fun HomeOffersUnavailableNote(modifier: Modifier = Modifier) {
  Row(
    modifier = modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(MaharaniDimens.radiusField))
      .background(MaterialTheme.colorScheme.surfaceVariant)
      .padding(
        horizontal = MaharaniDimens.spaceMd,
        vertical = MaharaniDimens.spaceSm,
      )
      .testTag(HomeOfferTags.OFFERS_UNAVAILABLE),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    // A 6dp error mark: the one piece of red on the line, so the note is
    // recognisable as a problem without being an error card.
    Box(
      modifier = Modifier
        .size(6.dp)
        .clip(RoundedCornerShape(MaharaniDimens.radiusPill))
        .background(MaterialTheme.colorScheme.error),
    )
    Text(
      text = "Live offers could not load. Prices, stock and totals are unaffected.",
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}
