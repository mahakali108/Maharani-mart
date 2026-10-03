package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
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
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.PackAvailability

/** Test tag of one product tile, used by Compose UI tests to find a card. */
const val PRODUCT_TILE_TAG = "catalog_product_tile"

/**
 * One product card.
 *
 * Every field is server-supplied: the image URL the media resolver produced, the
 * pack size and MOQ from the pack row, the GST-inclusive per-piece price the
 * pricing engine returned, and the two-state stock status. Nothing is estimated
 * on the device.
 *
 * The card reads top to bottom the way a shopper decides: artwork first (with
 * the New and Offer markers laid over it, and out-of-stock artwork dimmed so
 * the state is visible before any label is read), then identity (brand, name),
 * then the money line — price is the strongest text on the card, with the MRP
 * struck through beside it only when the server supplied one — and finally the
 * order terms: pack size, MOQ and stock status on one line.
 *
 * A product with no active pack renders its name and an explicit "No pack
 * available" line: it stays browsable, but there is no price to misread and no
 * affordance that suggests it can be ordered.
 */
@Composable
fun ProductCardTile(
  product: CatalogProduct,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val pack = product.pack

  CatalogCard(onClick = onClick, modifier = modifier.testTag(PRODUCT_TILE_TAG), header = {
    Box(
      modifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
    ) {
      ProductImage(
        url = product.imageUrl,
        fallbackLabel = product.name,
        contentScale = ContentScale.Fit,
        modifier = Modifier
          .fillMaxWidth()
          .aspectRatio(1f),
      )

      if (product.isNewLaunch) {
        NewLaunchBadge(modifier = Modifier.align(Alignment.TopStart).padding(6.dp))
      }

      if (product.hasOffer) {
        OfferBadge(modifier = Modifier.align(Alignment.TopEnd).padding(6.dp))
      }

      // An out-of-stock pack dims the artwork so a scrolling shopper sees the
      // state before reading the label.
      if (pack?.availability == PackAvailability.OUT_OF_STOCK) {
        Surface(
          color = MaterialTheme.colorScheme.surface.copy(alpha = 0.55f),
          modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f),
        ) {}
      }
    }
  }) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )

      PackSizeChip(pack?.packName)

      HorizontalDivider(
        modifier = Modifier.padding(vertical = 6.dp),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant,
      )

      if (pack == null) {
        Text(
          text = "No pack available",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          PriceText(unitPricePaise = pack.unitPricePaise)
          MrpText(mrpPaise = pack.mrpPaise)
        }
        Row(
          modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          MoqText(moq = pack.moq)
          AvailabilityChip(availability = pack.availability, compact = true)
        }
      }
    }
  }
}
