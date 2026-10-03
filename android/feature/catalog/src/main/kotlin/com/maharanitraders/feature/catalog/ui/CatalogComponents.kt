package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.PackAvailability

/** Test tags for the catalogue surface, addressable from Compose UI tests. */
object CatalogTags {
  const val PRODUCT_IMAGE = "catalog_product_image"
  const val AVAILABILITY = "catalog_availability"
  const val PRICE = "catalog_price"
  const val MOQ = "catalog_moq"
  const val PACK_NAME = "catalog_pack_name"
  const val NEW_LAUNCH = "catalog_new_launch"
}

/** Display copy for the server's two-state availability vocabulary. */
fun PackAvailability.label(): String = when (this) {
  PackAvailability.IN_STOCK -> "In stock"
  PackAvailability.OUT_OF_STOCK -> "Out of stock"
  // Honest: the server could not confirm this pack. Not "in stock", not "out of
  // stock" — the shopper is told the truth and the order stage will re-check.
  PackAvailability.UNKNOWN -> "Stock not confirmed"
}

/**
 * Server product imagery.
 *
 * Coil 3 keeps its network support in a separate artifact, installed once by the
 * application module's image loader factory; this composable only names a URL
 * the server already resolved. A missing or failed image renders a neutral tile
 * with the product initial rather than a broken glyph — no placeholder artwork
 * is claimed to be the product.
 */
@Composable
fun ProductImage(
  url: String?,
  fallbackLabel: String,
  modifier: Modifier = Modifier,
  contentScale: ContentScale = ContentScale.Fit,
  testTag: String = CatalogTags.PRODUCT_IMAGE,
) {
  SubcomposeAsyncImage(
    model = url,
    contentDescription = fallbackLabel,
    contentScale = contentScale,
    modifier = modifier
      .background(MaterialTheme.colorScheme.surfaceVariant)
      .testTag(testTag),
    loading = {
      Box(
        modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
      ) {
        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
      }
    },
    error = { ProductImageFallback(fallbackLabel) },
  )
}

@Composable
private fun ProductImageFallback(label: String) {
  Box(
    modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = label.trim().take(1).uppercase(),
      style = MaterialTheme.typography.titleLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

/** The two-state stock badge. `UNKNOWN` is deliberately NOT styled as in-stock. */
@Composable
fun AvailabilityChip(
  availability: PackAvailability,
  modifier: Modifier = Modifier,
  compact: Boolean = false,
) {
  val colors = MaharaniThemeTokens.colors
  val container = when (availability) {
    PackAvailability.IN_STOCK -> colors.inStockSurface
    PackAvailability.OUT_OF_STOCK -> colors.outOfStockSurface
    PackAvailability.UNKNOWN -> colors.warningSurface
  }
  val content = when (availability) {
    PackAvailability.IN_STOCK -> colors.inStock
    PackAvailability.OUT_OF_STOCK -> colors.outOfStock
    PackAvailability.UNKNOWN -> colors.warning
  }

  Surface(
    color = container,
    contentColor = content,
    shape = RoundedCornerShape(percent = 50),
    modifier = modifier
      .testTag(CatalogTags.AVAILABILITY)
      .semantics { contentDescription = availability.label() },
  ) {
    Text(
      text = availability.label(),
      style = if (compact) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium,
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
    )
  }
}

/** GST-inclusive per-piece price, or an honest "price unavailable". */
@Composable
fun PriceText(
  unitPricePaise: Long?,
  modifier: Modifier = Modifier,
  style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.titleMedium,
) {
  Text(
    // A null price is never rendered as ₹0: zero would read as "free" and
    // invite an order that checkout would reject.
    text = unitPricePaise?.let { "${MoneyFormat.formatPaise(it)}/pc" } ?: "Price unavailable",
    style = style,
    fontWeight = FontWeight.Bold,
    color = if (unitPricePaise != null) MaterialTheme.colorScheme.onSurface
    else MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = modifier.testTag(CatalogTags.PRICE),
  )
}

/** MRP with a strike-through, shown only when the server supplied one. */
@Composable
fun MrpText(mrpPaise: Long?, modifier: Modifier = Modifier) {
  if (mrpPaise == null || mrpPaise <= 0) return
  Text(
    text = "MRP ${MoneyFormat.formatPaise(mrpPaise)}",
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = modifier,
    textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough,
  )
}

/** `Min order 12 pcs` — the server's MOQ, never a client-side minimum. */
@Composable
fun MoqText(moq: Int?, modifier: Modifier = Modifier) {
  Text(
    text = if (moq == null) "MOQ not set" else "Min order $moq pcs",
    style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = modifier.testTag(CatalogTags.MOQ),
  )
}

/** Pack size chip (`500g`, `1L Jar`). */
@Composable
fun PackSizeChip(packName: String?, modifier: Modifier = Modifier) {
  if (packName.isNullOrBlank()) return
  Surface(
    color = MaterialTheme.colorScheme.surfaceVariant,
    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    shape = RoundedCornerShape(6.dp),
    modifier = modifier.testTag(CatalogTags.PACK_NAME),
  ) {
    Text(
      text = packName,
      style = MaterialTheme.typography.labelMedium,
      modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
    )
  }
}

/** Brand-red "New" ribbon, driven by the server's `is_new_launch` flag. */
@Composable
fun NewLaunchBadge(modifier: Modifier = Modifier) {
  Surface(
    color = MaterialTheme.colorScheme.primary,
    contentColor = MaterialTheme.colorScheme.onPrimary,
    shape = RoundedCornerShape(6.dp),
    modifier = modifier.testTag(CatalogTags.NEW_LAUNCH),
  ) {
    Text(
      text = "New",
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
    )
  }
}

/** A section heading with an optional trailing action. */
@Composable
fun SectionHeader(
  title: String,
  modifier: Modifier = Modifier,
  actionLabel: String? = null,
  onAction: (() -> Unit)? = null,
) {
  Row(
    modifier = modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(text = title, style = MaterialTheme.typography.titleMedium)
    if (actionLabel != null && onAction != null) {
      // A TextButton, not a clickable Surface: a stable API, and it already
      // carries the 48dp touch target and the button role for TalkBack.
      TextButton(onClick = onAction) { Text(actionLabel) }
    }
  }
}

/** Grey rounded placeholder block used by the loading skeleton. */
@Composable
fun SkeletonBlock(modifier: Modifier = Modifier, height: Int = 16) {
  Box(
    modifier = modifier
      .fillMaxWidth()
      .height(height.dp)
      .clip(RoundedCornerShape(6.dp))
      .background(MaterialTheme.colorScheme.surfaceVariant),
  )
}

/** Loading skeleton for a product grid: shape without pretending to be data. */
@Composable
fun ProductGridSkeleton(columns: Int, rows: Int = 3, modifier: Modifier = Modifier) {
  Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    repeat(rows) {
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(columns) {
          Column(
            modifier = Modifier
              .weight(1f)
              .clip(RoundedCornerShape(16.dp))
              .background(MaterialTheme.colorScheme.surface)
              .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Box(
              modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            SkeletonBlock(height = 14)
            SkeletonBlock(modifier = Modifier.fillMaxWidth(0.6f), height = 12)
            SkeletonBlock(modifier = Modifier.fillMaxWidth(0.4f), height = 12)
          }
        }
      }
    }
  }
}

/** Page indicator dots for a gallery or banner pager. */
@Composable
fun PagerDots(pageCount: Int, currentPage: Int, modifier: Modifier = Modifier) {
  if (pageCount < 2) return
  Row(
    modifier = modifier,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    repeat(pageCount) { index ->
      val selected = index == currentPage
      Box(
        modifier = Modifier
          .size(if (selected) 8.dp else 6.dp)
          .clip(CircleShape)
          .background(
            if (selected) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.outline,
          ),
      )
    }
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
    textAlign = TextAlign.Start,
    modifier = modifier,
  )
}

/** Standard card surface used by every catalogue tile. */
@Composable
fun CatalogCard(
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  Surface(
    modifier = modifier.clickable(onClick = onClick),
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = 2.dp,
  ) {
    Column(modifier = Modifier.padding(10.dp)) { content() }
  }
}

/** Spacer with a fixed height, for consistent vertical rhythm. */
@Composable
fun Gap(size: Int = 12) {
  Spacer(modifier = Modifier.height(size.dp))
}

/** Spacer with a fixed width, for consistent horizontal rhythm. */
@Composable
fun HGap(size: Int = 8) {
  Spacer(modifier = Modifier.width(size.dp))
}

/**
 * The search affordance, drawn instead of imported.
 *
 * Same reasoning as [com.maharanitraders.core.designsystem.components.MenuIcon]:
 * `androidx.compose.material:material-icons-*` is deprecated and stopped being
 * published after 1.7.x, so the app draws the handful of glyphs it needs rather
 * than shipping a ~1.4 MB enum. The `contentDescription` is set by the caller's
 * text field, so TalkBack still announces "Search".
 */
@Composable
fun SearchGlyph(
  modifier: Modifier = Modifier,
  tint: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
  androidx.compose.foundation.Canvas(modifier = modifier.size(20.dp)) {
    val stroke = 2.dp.toPx()
    val centre = androidx.compose.ui.geometry.Offset(size.width * 0.42f, size.height * 0.42f)
    drawCircle(
      color = tint,
      radius = (size.minDimension / 2f - stroke) * 0.72f,
      center = centre,
      style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke),
    )
    drawLine(
      color = tint,
      start = androidx.compose.ui.geometry.Offset(size.width * 0.64f, size.height * 0.64f),
      end = androidx.compose.ui.geometry.Offset(size.width * 0.95f, size.height * 0.95f),
      strokeWidth = stroke,
      cap = androidx.compose.ui.graphics.StrokeCap.Round,
    )
  }
}
