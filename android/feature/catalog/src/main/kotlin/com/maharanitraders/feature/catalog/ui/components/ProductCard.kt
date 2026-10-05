package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.HeartGlyph
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.catalog.ui.CatalogTags
import com.maharanitraders.feature.catalog.ui.NewLaunchBadge
import com.maharanitraders.feature.catalog.ui.OfferBadge

/** Test tag of one product tile, used by Compose UI tests to find a card. */
const val PRODUCT_CARD_TAG = "catalog_product_tile"

/**
 * Prefix of the favourite control's tag, suffixed with the product id, so a test
 * can address one card's heart without depending on card order.
 */
const val PRODUCT_FAVORITE_TAG = "catalog_product_favorite"

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
   * The heart's state. Defaults to what this card's own server payload said;
   * a screen that tracks fresher state (a toggle made on the product page) passes
   * it in, so the two surfaces can never disagree until the next read.
   */
  isFavorite: Boolean = product.isFavorite,
  favoriteBusy: Boolean = false,
  /** Null hides the control: a surface without the favourites write shows no dead heart. */
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

        // The same write the product page offers, so a shopper can save a pack
        // while scanning results instead of opening it first. Disabled while a
        // toggle is in flight: the endpoint is a server-side toggle, so a second
        // tap would silently undo the first.
        onToggleFavorite?.let { toggle ->
          Box(
            modifier = Modifier
              .align(Alignment.TopEnd)
              .padding(MaharaniDimens.spaceSm)
              .size(32.dp)
              .clip(CircleShape)
              .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f))
              .clickable(enabled = !favoriteBusy, onClick = toggle),
            contentAlignment = Alignment.Center,
          ) {
            HeartGlyph(
              modifier = Modifier
                .size(18.dp)
                .testTag("$PRODUCT_FAVORITE_TAG:${product.id}"),
              tint = if (isFavorite) {
                MaharaniThemeTokens.colors.brandMark
              } else {
                MaterialTheme.colorScheme.onSurfaceVariant
              },
              filled = isFavorite,
            )
          }
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
