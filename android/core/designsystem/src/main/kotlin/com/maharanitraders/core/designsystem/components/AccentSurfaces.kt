package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.AccentTone
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.designsystem.theme.accent

/**
 * The three multi-colour building blocks every retailer surface shares.
 *
 * WHY THEY LIVE HERE
 * The home dashboard, the catalogue header, the account hub and the order cards
 * all need the same three shapes: a tinted glyph, a tappable shortcut, and a
 * small "this is a number that matters" tile. Drawing them once means the tones
 * are resolved through [MaharaniExtraColors.accent] in exactly one place, so no
 * screen can invent a shade, drift into a monochrome wash, or become unreadable
 * in dark mode. Colours are never passed in — a caller names an [AccentTone] and
 * the theme answers.
 */

/** Test tags for the shared accent surfaces, addressable from Compose tests. */
object AccentTags {
  const val QUICK_ACTION = "accent_quick_action"
  const val METRIC_TILE = "accent_metric_tile"
  const val INFO_CARD = "accent_info_card"
}

/**
 * A glyph on its accent's soft container — the coloured anchor of a tile, a
 * shortcut or an empty state. The [glyph] slot draws the icon itself (see
 * `Glyphs.kt`), which keeps this component free of any icon dependency.
 */
@Composable
fun AccentIcon(
  tone: AccentTone,
  modifier: Modifier = Modifier,
  size: Dp = 40.dp,
  glyph: @Composable (Color) -> Unit,
) {
  val tokens = MaharaniThemeTokens.colors
  val accent = tokens.accent(tone)
  Box(
    modifier = modifier
      .size(size)
      .background(accent.surface, RoundedCornerShape(MaharaniDimens.radiusTile)),
    contentAlignment = Alignment.Center,
  ) {
    glyph(accent.tint)
  }
}

/**
 * One retailer shortcut: a tinted glyph over its label.
 *
 * The label is a real, visible line of text rather than a tooltip, so the tile
 * is understandable without its colour (an accessibility requirement, not a
 * nicety) and TalkBack reads the same words a sighted shopper sees. The tile
 * keeps the platform minimum height of [MaharaniDimens.touchTarget] however
 * short the label is.
 */
@Composable
fun QuickActionTile(
  label: String,
  tone: AccentTone,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  badgeCount: Int? = null,
  glyph: @Composable (Color) -> Unit,
) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    modifier = modifier
      .heightIn(min = 92.dp)
      .testTag(AccentTags.QUICK_ACTION),
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = MaharaniDimens.spaceSm, vertical = MaharaniDimens.spaceMd),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Box {
        AccentIcon(tone = tone, size = 42.dp, glyph = glyph)
        // Only a real, server-reported count is ever drawn; the caller passes
        // null when it does not know, and the bubble is simply absent.
        if (badgeCount != null && badgeCount > 0) {
          Box(
            modifier = Modifier
              .align(Alignment.TopEnd)
              .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(MaharaniDimens.radiusPill))
              .padding(horizontal = 5.dp, vertical = 1.dp),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              text = if (badgeCount > 99) "99+" else badgeCount.toString(),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onPrimary,
            )
          }
        }
      }
      Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        minLines = 2,
      )
    }
  }
}

/**
 * A labelled figure with an accent glyph — the shape the Coins balance, the
 * recent-order summary and the "stock running low" facts all use.
 *
 * [caption] carries the second-order fact (funded vs spent, order date) so a
 * tile never shows one number without the context that makes it meaningful.
 */
@Composable
fun MetricTile(
  label: String,
  value: String,
  tone: AccentTone,
  modifier: Modifier = Modifier,
  caption: String? = null,
  trailing: @Composable (() -> Unit)? = null,
  glyph: @Composable (Color) -> Unit,
) {
  val tokens = MaharaniThemeTokens.colors
  val accent = tokens.accent(tone)
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    modifier = modifier.testTag(AccentTags.METRIC_TILE),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(MaharaniDimens.spaceMd),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      AccentIcon(tone = tone, size = 40.dp, glyph = glyph)
      Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
      ) {
        Text(
          text = label,
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          text = value,
          style = MaterialTheme.typography.titleLarge,
          color = accent.onSurface,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        caption?.let { line ->
          Text(
            text = line,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
      trailing?.invoke()
    }
  }
}

/**
 * A quiet, informational card: the wholesale-pricing note on the home screen,
 * the lead-time note on a product, the "why is this price lower" explanation on
 * a slab table.
 *
 * Blue-on-blue by default because it states a FACT; callers that are making a
 * saving use AMBER and callers reporting a low stock state use GREEN, so the
 * same component never says three different things in one colour.
 */
@Composable
fun InfoCard(
  title: String,
  message: String,
  modifier: Modifier = Modifier,
  tone: AccentTone = AccentTone.BLUE,
  glyph: @Composable (Color) -> Unit,
) {
  val tokens = MaharaniThemeTokens.colors
  val accent = tokens.accent(tone)
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = accent.surface,
    contentColor = accent.onSurface,
    modifier = modifier.testTag(AccentTags.INFO_CARD),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(MaharaniDimens.spaceMd),
      verticalAlignment = Alignment.Top,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      glyph(accent.tint)
      Column(
        modifier = Modifier.weight(1f),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
      ) {
        Text(text = title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(text = message, style = MaterialTheme.typography.bodySmall)
      }
    }
  }
}
