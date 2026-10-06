package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.CheckGlyph
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.feature.catalog.ui.CatalogTags

/**
 * The directory tiles the Catalogue's Categories and Brands panes are built
 * from.
 *
 * Both tiles are the SAME component shape on purpose — artwork, name, server
 * count, and a selected state that is visible before it is read (a filled tick
 * badge, a red border AND the soft pink surface, not colour alone). A shopper
 * who learns one pane has learned the other, and neither tile can show a count
 * the server did not send: a missing `productCount` is omitted rather than
 * rounded into "0 items".
 *
 * Sizes are fixed rather than content-driven, so a two-column grid at 360dp
 * lines up: 96dp artwork band on top, a two-line name block, one count line.
 * Tapping a tile applies that filter and moves to the product list, so the
 * selection the shopper just made is immediately visible in real products.
 */

/** The "All products" tile: the scope that clears whichever filter is applied. */
@Composable
fun DirectoryAllCard(
  selected: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  totalCount: Int? = null,
) {
  val tokens = MaharaniThemeTokens.colors
  TileSurface(
    selected = selected,
    onClick = onClick,
    contentDescription = "All products",
    modifier = modifier.testTag(CatalogTags.DIRECTORY_ALL),
  ) {
    Column {
      Box(
        modifier = Modifier
          .fillMaxWidth()
          .height(TILE_ART_HEIGHT)
          .background(tokens.appBarStart),
        contentAlignment = Alignment.Center,
      ) {
        Box(
          modifier = Modifier
            .size(46.dp)
            .clip(CircleShape)
            .background(tokens.onAppBar.copy(alpha = 0.16f)),
          contentAlignment = Alignment.Center,
        ) {
          CheckGlyph(modifier = Modifier.size(22.dp), tint = tokens.onAppBar)
        }
      }
      TileCaption(
        title = "All products",
        // The count is the CATALOGUE TOTAL and is only ever shown when this tile
        // is the applied scope — otherwise the number would belong to the
        // filtered result set and would be a lie about the whole shop. With no
        // count from the server the subtitle stays in words.
        subtitle = when {
          selected && totalCount != null -> "$totalCount products in the catalogue"
          selected -> "Every published product"
          else -> "Clear this filter"
        },
      )
    }
  }
}

/** One category in the directory: real image, real name, real rolled-up count. */
@Composable
fun CategoryCard(
  category: CatalogCategory,
  selected: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  TileSurface(
    selected = selected,
    onClick = onClick,
    contentDescription = category.name,
    modifier = modifier.testTag(CatalogTags.DIRECTORY_TILE),
  ) {
    Column {
      Box {
        ProductImage(
          url = category.imageUrl,
          fallbackLabel = category.name,
          contentScale = ContentScale.Fit,
          brandedMonogram = true,
          modifier = Modifier
            .fillMaxWidth()
            .height(TILE_ART_HEIGHT),
        )
        if (selected) {
          SelectionBadge(
            modifier = Modifier
              .align(Alignment.TopEnd)
              .padding(MaharaniDimens.spaceSm),
          )
        }
      }
      TileCaption(
        title = category.name,
        subtitle = category.productCount?.let { count -> countLabel(count) } ?: "Tap to browse",
      )
    }
  }
}

/** One brand in the directory: real logo (or initial), real name, real count. */
@Composable
fun BrandCard(
  brand: CatalogBrand,
  selected: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  TileSurface(
    selected = selected,
    onClick = onClick,
    contentDescription = brand.name,
    modifier = modifier.testTag(CatalogTags.DIRECTORY_TILE),
  ) {
    Column {
      Box {
        Box(
          modifier = Modifier
            .fillMaxWidth()
            .height(TILE_ART_HEIGHT)
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(MaharaniDimens.spaceMd),
          contentAlignment = Alignment.Center,
        ) {
          ProductImage(
            url = brand.logoUrl,
            fallbackLabel = brand.name,
            contentScale = ContentScale.Fit,
            brandedMonogram = true,
            modifier = Modifier
              .size(60.dp)
              .clip(RoundedCornerShape(MaharaniDimens.radiusTile)),
          )
        }
        if (selected) {
          SelectionBadge(
            modifier = Modifier
              .align(Alignment.TopEnd)
              .padding(MaharaniDimens.spaceSm),
          )
        }
      }
      TileCaption(
        title = brand.name,
        subtitle = brand.productCount?.let { count -> countLabel(count) } ?: "Tap to browse",
      )
    }
  }
}

/**
 * The one card shape both directory tiles use.
 *
 * [selected] is carried by three cues at once — a thicker primary border, the
 * primary-tinted surface and the filled tick badge — because a single colour
 * change is easy to miss on a 2-column grid, and colour alone would say nothing
 * to a shopper who cannot distinguish it.
 */
@Composable
private fun TileSurface(
  selected: Boolean,
  onClick: () -> Unit,
  contentDescription: String,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = if (selected) {
      MaterialTheme.colorScheme.primaryContainer
    } else {
      MaterialTheme.colorScheme.surface
    },
    border = if (selected) {
      BorderStroke(2.dp, MaterialTheme.colorScheme.primary)
    } else {
      BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    },
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget)
      .clip(RoundedCornerShape(MaharaniDimens.radiusCard))
      .clickable(onClick = onClick)
      .semantics { this.contentDescription = contentDescription },
  ) {
    content()
  }
}

/** Name (two lines, so tiles align) plus the one server-supplied fact line. */
@Composable
private fun TileCaption(title: String, subtitle: String) {
  Column(
    modifier = Modifier.padding(
      start = MaharaniDimens.spaceMd,
      end = MaharaniDimens.spaceMd,
      top = MaharaniDimens.spaceSm,
      bottom = MaharaniDimens.spaceMd,
    ),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
  ) {
    Text(
      text = title,
      style = MaterialTheme.typography.titleSmall,
      color = MaterialTheme.colorScheme.onSurface,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
      minLines = 2,
    )
    Text(
      text = subtitle,
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** One count, one vocabulary: "1 item" never reads as "1 items". */
private fun countLabel(count: Int): String = if (count == 1) "1 item" else "$count items"

/** The filled brand tick that marks the filter currently applied. */
@Composable
private fun SelectionBadge(modifier: Modifier = Modifier) {
  Surface(
    shape = CircleShape,
    color = MaterialTheme.colorScheme.primary,
    contentColor = MaterialTheme.colorScheme.onPrimary,
    border = BorderStroke(2.dp, MaterialTheme.colorScheme.surface),
    modifier = modifier
      .size(26.dp)
      .testTag(CatalogTags.DIRECTORY_SELECTED),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.Center,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      CheckGlyph(modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onPrimary)
    }
  }
}

/** The one artwork band height both tiles use, so a mixed row still lines up. */
private val TILE_ART_HEIGHT = 96.dp

/** A short label used above each directory pane's grid. */
@Composable
fun DirectoryScopeLabel(text: String, modifier: Modifier = Modifier) {
  Text(
    text = text,
    style = MaterialTheme.typography.labelMedium,
    fontWeight = FontWeight.Medium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    maxLines = 1,
    overflow = TextOverflow.Ellipsis,
    modifier = modifier,
  )
}
