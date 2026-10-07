package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.PriceTier

/** Test tag of the quantity ladder, addressable from Compose UI tests. */
const val PRICE_LADDER_TAG = "price_ladder"

/** One slab of the quantity ladder, already formatted for display. */
data class QuantityLadderRow(
  /** `1–6 pcs`, `21+ pcs` — the server's own half-open range, made inclusive. */
  val rangeLabel: String,
  /** `₹80 / pc` — the server's rate for that range. */
  val priceLabel: String,
)

/**
 * The server's selling slabs, formatted exactly the way the web storefront
 * words them (`tierRangeLabel` in `lib/retailer/case-pricing.ts`).
 *
 * The range stored by the server is HALF-OPEN — `[min, max)` — so an exclusive
 * max of 7 is the inclusive range "1–6". Showing the stored 7 would tell a
 * shopkeeper that 7 pieces cost the lower rate, and the cart would then charge
 * them the next slab's price. The conversion happens here, once, so no screen
 * has to know which convention the column uses.
 *
 * A pack with a SINGLE slab answers an empty list: that one rate is already the
 * price on the card, and a one-row "ladder" is noise.
 *
 * The price itself is never derived: it is the rate the pricing engine returned
 * for the slab, printed as paise.
 */
fun quantityLadder(tiers: List<PriceTier>, unitLabel: String = "pc"): List<QuantityLadderRow> {
  if (tiers.size < 2) return emptyList()
  return tiers.map { tier ->
    val range = when {
      tier.maxQuantity == null -> "${tier.minQuantity}+ $unitLabel"
      tier.maxQuantity - 1 <= tier.minQuantity -> "${tier.minQuantity} $unitLabel"
      else -> "${tier.minQuantity}–${tier.maxQuantity - 1} $unitLabel"
    }
    QuantityLadderRow(
      rangeLabel = range,
      priceLabel = "${MoneyFormat.formatPaiseShort(tier.unitPricePaise)} / $unitLabel",
    )
  }
}

/**
 * The next slab below the quantity the shopper is looking at, or null.
 *
 * This is the honest version of "buy more, pay less": it is the server's own
 * next tier (from the same rows the cart prices with), not a rounding the
 * device invented. `null` means the ladder has nothing cheaper to offer — the
 * app then says nothing at all rather than implying a saving that checkout
 * would not honour.
 */
fun nextSlabHint(tiers: List<PriceTier>, quantity: Int, unitLabel: String = "pc"): String? {
  if (quantity <= 0 || tiers.size < 2) return null
  // The slab that prices TODAY's quantity, and the first slab above it.
  val current = tiers.filter { it.minQuantity <= quantity }.maxByOrNull { it.minQuantity } ?: return null
  val next = tiers.filter { it.minQuantity > quantity }.minByOrNull { it.minQuantity } ?: return null
  // Only a genuinely cheaper slab is worth mentioning. A ladder whose higher
  // slabs are not cheaper is a configuration, not an offer, and the app says
  // nothing rather than promising a saving checkout would not honour.
  if (next.unitPricePaise >= current.unitPricePaise) return null
  return "${next.minQuantity}+ $unitLabel at ${MoneyFormat.formatPaiseShort(next.unitPricePaise)} / $unitLabel"
}

/**
 * The quantity ladder: one row per selling slab the server published.
 *
 * Drawn only where the server actually sent more than one slab (see
 * [quantityLadder]). Every figure is a server rate in paise; the component does
 * no arithmetic beyond the exclusive→inclusive range conversion, which is
 * stated in [quantityLadder] rather than hidden here.
 */
@Composable
fun QuantityLadder(
  tiers: List<PriceTier>,
  modifier: Modifier = Modifier,
  unitLabel: String = "pc",
) {
  val rows = quantityLadder(tiers, unitLabel)
  if (rows.isEmpty()) return

  val tokens = MaharaniThemeTokens.colors
  Column(
    modifier = modifier
      .fillMaxWidth()
      .testTag(PRICE_LADDER_TAG),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
  ) {
    Text(
      text = "Buy more, pay less",
      style = MaterialTheme.typography.labelMedium,
      fontWeight = FontWeight.SemiBold,
      color = tokens.onSaffronSurface,
    )
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .background(tokens.saffronSurface, RoundedCornerShape(MaharaniDimens.radiusTile))
        .padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      rows.forEach { row ->
        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          Text(
            text = row.rangeLabel,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
          )
          Text(
            text = row.priceLabel,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            color = tokens.onSaffronSurface,
            maxLines = 1,
          )
        }
      }
      Text(
        text = "These are today's rates for your shop. GST is included.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
