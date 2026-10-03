package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.theme.MaharaniDimens

/** Where a price sits decides how loud it is. */
enum class PriceEmphasis {
  /** Two-column cards and horizontal rails. */
  Card,
  /** Product detail hero. */
  Detail,
  /** Dense rows (pack selector). */
  Compact,
}

/** Test tag shared by every rendered price, for Compose UI tests. */
const val PRICE_BLOCK_TAG = "price_block"

/**
 * One honest price block: the server's GST-inclusive per-piece rate, an
 * optional printed MRP struck through beside it, and an optional caption line
 * (case size, case price, slab hint) that the caller composes from server
 * values.
 *
 * Rules this component enforces:
 *  - a `null` price is NEVER rendered as ₹0; it reads "Price unavailable" in a
 *    muted tone, because zero would look like "free" and invite an order that
 *    checkout would reject;
 *  - no discount percentage and no crossed-out price are ever invented: the
 *    strike-through only appears when the server actually sent an MRP;
 *  - the figure is [MoneyFormat.formatPaiseShort] (value-identical, zero
 *    fraction omitted) with the "/pc" unit kept in a smaller style so a large
 *    number and its unit cannot collide on a narrow card.
 */
@Composable
fun PriceBlock(
  unitPricePaise: Long?,
  modifier: Modifier = Modifier,
  emphasis: PriceEmphasis = PriceEmphasis.Card,
  mrpPaise: Long? = null,
  caption: String? = null,
) {
  val priceStyle = when (emphasis) {
    PriceEmphasis.Card -> MaterialTheme.typography.titleMedium
    PriceEmphasis.Detail -> MaterialTheme.typography.headlineSmall
    PriceEmphasis.Compact -> MaterialTheme.typography.labelLarge
  }
  val unitStyle = when (emphasis) {
    PriceEmphasis.Card -> MaterialTheme.typography.labelMedium
    PriceEmphasis.Detail -> MaterialTheme.typography.titleSmall
    PriceEmphasis.Compact -> MaterialTheme.typography.labelSmall
  }

  Column(
    modifier = modifier,
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
  ) {
    Row(
      verticalAlignment = Alignment.Bottom,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      if (unitPricePaise == null) {
        Text(
          text = "Price unavailable",
          style = unitStyle,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.testTag(PRICE_BLOCK_TAG),
        )
      } else {
        Text(
          text = MoneyFormat.formatPaiseShort(unitPricePaise),
          style = priceStyle,
          fontWeight = FontWeight.Bold,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier
            .weight(1f, fill = false)
            .testTag(PRICE_BLOCK_TAG),
        )
        Text(
          text = "/pc",
          style = unitStyle,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
        )
        val mrp = mrpPaise
        if (mrp != null && mrp > 0 && mrp != unitPricePaise) {
          Text(
            text = MoneyFormat.formatPaiseShort(mrp),
            style = unitStyle,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textDecoration = TextDecoration.LineThrough,
            maxLines = 1,
          )
        }
      }
    }

    if (caption != null) {
      Text(
        text = caption,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}
