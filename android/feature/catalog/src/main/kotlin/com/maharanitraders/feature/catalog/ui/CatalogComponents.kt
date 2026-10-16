package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens

/**
 * Test tags for the catalogue surface, addressable from Compose UI tests.
 *
 * The reusable primitives themselves (search field, section header, stock
 * badge, price block, skeletons) live in `:core:designsystem`; this file keeps
 * only the catalogue's own tags and its two server-flag badges.
 */
object CatalogTags {
  const val PRODUCT_IMAGE = "catalog_product_image"
  const val AVAILABILITY = "catalog_availability"
  const val PRICE = "catalog_price"
  const val MOQ = "catalog_moq"
  const val PACK_NAME = "catalog_pack_name"
  const val NEW_LAUNCH = "catalog_new_launch"
  const val OFFER = "catalog_offer"

  /**
   * Directory surfaces. Tags live here (next to the other catalogue tags) even
   * though the panes themselves are drawn by `CatalogScreen`, because a Compose
   * UI test addresses a card the same way wherever it is rendered.
   */
  const val DIRECTORY_TILE = "catalog_directory_tile"
  const val DIRECTORY_ALL = "catalog_directory_all"
  const val DIRECTORY_SELECTED = "catalog_directory_selected"
}

/**
 * Lavender "New" ribbon, driven by the server's `is_new_launch` flag. The app never
 * decides what is new: the flag arrives on the card or the detail.
 */
@Composable
fun NewLaunchBadge(modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    // Lavender highlight is separate from peach OFFER surfaces, so a "New" chip
    // that looked like a discount would misstate what the server said. Lavender is
    // the design system's emphasis tone — neither a saving nor a failure.
    color = tokens.highlight,
    contentColor = MaterialTheme.colorScheme.surface,
    shape = RoundedCornerShape(MaharaniDimens.radiusChip),
    modifier = modifier.testTag(CatalogTags.NEW_LAUNCH),
  ) {
    Text(
      text = "New",
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
    )
  }
}

/**
 * Peach "Offer" chip, driven by the server's `hasOffer` flag (an active
 * scheme/festival price list for this product). No percentage, no claim about
 * the size of the offer — the app shows that an offer exists because the
 * pricing engine said so, and the prices themselves carry the detail.
 */
@Composable
fun OfferBadge(modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = tokens.peachSurface,
    contentColor = tokens.onPeachSurface,
    shape = RoundedCornerShape(MaharaniDimens.radiusChip),
    modifier = modifier.testTag(CatalogTags.OFFER),
  ) {
    Text(
      text = "Offer",
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
    )
  }
}

/** A short, single-line label used inside dense rows. */
@Composable
fun MetaLabel(text: String, modifier: Modifier = Modifier) {
  Text(
    text = text,
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier = modifier,
  )
}
