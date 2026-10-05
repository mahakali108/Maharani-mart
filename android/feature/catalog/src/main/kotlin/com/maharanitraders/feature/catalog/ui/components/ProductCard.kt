package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.FavoriteButton
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.catalog.ui.CatalogTags
import com.maharanitraders.feature.catalog.ui.NewLaunchBadge
import com.maharanitraders.feature.catalog.ui.OfferBadge

/** Test tag of one product tile, used by Compose UI tests to find a card. */
const val PRODUCT_CARD_TAG = "catalog_product_tile"

/** Test tag of the favourite control drawn on a product tile. */
const val FAVORITE_TOGGLE_TAG = "catalog_favorite_toggle"

/**
 * One product card — the atom every rail and grid in the app is built from.
 *
 * Every field is server-supplied: the image URL the media resolver produced,
 * the pack size, units per case and MOQ from the pack row, the GST-inclusive
 * per-piece price the pricing engine returned, and the two-state stock status.
 * Nothing is estimated on the device, and nothing that the server did not send
 * is drawn: no rating, no review count, no discount percentage, no crossed-out
 * price unless the server actually published an MRP.
 *
 * A product with no active pack renders its name and an explicit "No pack
 * available" line: it stays browsable, but there is no price to misread and no
 * affordance that suggests it can be ordered.
 */
@Composable
fun ProductCard(
  product: CatalogProduct,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  emphasis: PriceEmphasis = PriceEmphasis.Card,
  /**
   * Favourite state for this card. Defaults to the flag the SERVER put on the
   * product row, so a card is correct even before the shared favourites set has
   * loaded; the favourites-aware screens pass the store's answer instead.
   */
  isFavorite: Boolean = product.isFavorite,
  favoritePending: Boolean = false,
  /** Null hides the control entirely — a surface with no favourite affordance. */
  onToggleFavorite: (() -> Unit)? = null,
) {
  val pack = product.pack
  val outOfStock = pack?.availability == PackAvailability.OUT_OF_STOCK

  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier.testTag(PRODUCT_CARD_TAG),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Box(modifier = Modifier.fillMaxWidth()) {
        ProductImage(
          url = product.imageUrl,
          fallbackLabel = product.name,
          contentScale = ContentScale.Fit,
          modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(MaharaniDimens.productImageRatio)
            .clip(RoundedCornerShape(MaharaniDimens.radiusTile)),
        )

        // An out-of-stock pack dims the artwork so a scrolling shopper sees the
        // state before reading the label.
        if (outOfStock) {
          Box(
            modifier = Modifier
              .fillMaxWidth()
              .aspectRatio(MaharaniDimens.productImageRatio)
              .clip(RoundedCornerShape(MaharaniDimens.radiusTile))
              .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.5f)),
          )
        }

        if (product.isNewLaunch || product.hasOffer) {
          Row(
            modifier = Modifier
              .align(Alignment.TopStart)
              .padding(MaharaniDimens.spaceSm),
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          ) {
            if (product.isNewLaunch) NewLaunchBadge()
            if (product.hasOffer) OfferBadge()
          }
        }

        if (onToggleFavorite != null) {
          FavoriteButton(
            isFavorite = isFavorite,
            pending = favoritePending,
            onToggle = onToggleFavorite,
            modifier = Modifier
              .align(Alignment.TopEnd)
              .testTag(FAVORITE_TOGGLE_TAG),
          )
        }
      }

      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
        product.brandName?.let { brand ->
          Text(
            text = brand,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        Text(
          text = product.name,
          style = MaterialTheme.typography.titleSmall,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
          minLines = 2,
        )
      }

      if (pack == null) {
        Text(
          text = "No pack available",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        val chips = buildList {
          pack.packName?.let { name -> add(name) }
          pack.unitsPerCase?.takeIf { it > 1 }?.let { units -> add("$units pcs/case") }
        }
        if (chips.isNotEmpty()) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          ) {
            chips.forEach { chip ->
              // Weighted, so two long facts split the card width and ellipsis
              // instead of overflowing a 158dp column.
              FactChip(
                text = chip,
                modifier = Modifier
                  .weight(1f, fill = false)
                  .testTag(CatalogTags.PACK_NAME),
              )
            }
          }
        }

        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        ) {
          PriceBlock(
            unitPricePaise = pack.unitPricePaise,
            mrpPaise = pack.mrpPaise,
            emphasis = emphasis,
            caption = pack.moq?.let { moq -> "Min order $moq pcs" },
            modifier = Modifier
              .weight(1f, fill = false)
              .testTag(CatalogTags.PRICE),
          )
          StockBadge(
            availability = pack.availability,
            compact = true,
            modifier = Modifier.testTag(CatalogTags.AVAILABILITY),
          )
        }
      }
    }
  }
}
