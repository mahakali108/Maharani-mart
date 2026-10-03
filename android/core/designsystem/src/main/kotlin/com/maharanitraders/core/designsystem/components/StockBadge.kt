package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.labels.label
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.PackAvailability

/** Test tag shared by every stock badge, for Compose UI tests. */
const val STOCK_BADGE_TAG = "stock_badge"

/**
 * The two-state stock badge, with a status dot so the state is visible before
 * it is read.
 *
 * The server's vocabulary has exactly three customer-facing values (in stock,
 * out of stock, and "we could not confirm"), and [PackAvailability.UNKNOWN] is
 * deliberately NOT styled as in stock: an unconfirmed pack gets the warning
 * tone and the honest words.
 */
@Composable
fun StockBadge(
  availability: PackAvailability,
  modifier: Modifier = Modifier,
  compact: Boolean = false,
) {
  val tokens = MaharaniThemeTokens.colors
  val container: androidx.compose.ui.graphics.Color
  val content: androidx.compose.ui.graphics.Color
  when (availability) {
    PackAvailability.IN_STOCK -> {
      container = tokens.inStockSurface
      content = tokens.inStock
    }
    PackAvailability.OUT_OF_STOCK -> {
      container = tokens.outOfStockSurface
      content = tokens.outOfStock
    }
    PackAvailability.UNKNOWN -> {
      container = tokens.warningSurface
      content = tokens.warning
    }
  }

  Surface(
    color = container,
    contentColor = content,
    shape = RoundedCornerShape(percent = 50),
    modifier = modifier
      .testTag(STOCK_BADGE_TAG)
      .semantics { contentDescription = availability.label() },
  ) {
    Row(
      modifier = Modifier.padding(
        horizontal = if (compact) 8.dp else 10.dp,
        vertical = if (compact) 3.dp else 5.dp,
      ),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Box(
        modifier = Modifier
          .size(if (compact) 6.dp else 8.dp)
          .clip(CircleShape)
          .background(content),
      )
      Text(
        text = availability.label(),
        style = if (compact) {
          MaterialTheme.typography.labelSmall
        } else {
          MaterialTheme.typography.labelMedium
        },
        maxLines = 1,
      )
    }
  }
}

/** Neutral wholesale-fact chip: pack size, MOQ, units per case. */
@Composable
fun FactChip(
  text: String,
  modifier: Modifier = Modifier,
  accent: Boolean = false,
) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = if (accent) tokens.saffronSurface else MaterialTheme.colorScheme.surfaceVariant,
    contentColor = if (accent) tokens.onSaffronSurface else MaterialTheme.colorScheme.onSurfaceVariant,
    shape = RoundedCornerShape(MaharaniDimens.radiusChip),
    modifier = modifier,
  ) {
    Text(
      text = text,
      style = MaterialTheme.typography.labelMedium,
      maxLines = 1,
      // A long pack name ("20kg bulk sack, food grade") must not push the chip
      // out of its card: it ellipsises inside the width the row gives it.
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
    )
  }
}
