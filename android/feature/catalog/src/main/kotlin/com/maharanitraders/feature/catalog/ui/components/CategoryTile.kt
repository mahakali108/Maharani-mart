package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory

/**
 * One tile of the "Shop by category" rail: the category's real image in a disc,
 * its real name and its real active-product count (omitted entirely when the
 * server could not count them — nothing is rounded into a zero).
 *
 * A missing image degrades to the shared initial tile; the tile itself stays
 * fully usable, because the category id — not the artwork — is what filters
 * the catalogue.
 */
@Composable
fun CategoryTile(
  category: CatalogCategory,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .width(MaharaniDimens.categoryTileWidth)
      .heightIn(min = MaharaniDimens.touchTarget)
      .clip(RoundedCornerShape(MaharaniDimens.radiusTile))
      .clickable(onClick = onClick)
      .semantics { contentDescription = category.name },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    Box(
      modifier = Modifier
        .size(MaharaniDimens.categoryTileImage)
        .clip(CircleShape)
        .background(MaterialTheme.colorScheme.surface),
      contentAlignment = Alignment.Center,
    ) {
      ProductImage(
        url = category.imageUrl,
        fallbackLabel = category.name,
        contentScale = ContentScale.Crop,
        modifier = Modifier
          .size(MaharaniDimens.categoryTileImage)
          .clip(CircleShape),
      )
    }

    Text(
      text = category.name,
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.onBackground,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
      textAlign = TextAlign.Center,
    )

    category.productCount?.let { count ->
      Text(
        text = "$count items",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
      )
    }
  }
}

/**
 * One tile of the "Shop by brand" rail: the brand's real logo (or initial) and
 * name. Tapping filters the catalogue by that brand id.
 */
@Composable
fun BrandTile(
  brand: CatalogBrand,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .width(MaharaniDimens.brandTileWidth)
      .heightIn(min = MaharaniDimens.touchTarget)
      .clip(RoundedCornerShape(MaharaniDimens.radiusTile))
      .clickable(onClick = onClick)
      .semantics { contentDescription = brand.name },
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceSm),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      ProductImage(
        url = brand.logoUrl,
        fallbackLabel = brand.name,
        contentScale = ContentScale.Fit,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = 44.dp, max = 44.dp)
          .clip(RoundedCornerShape(8.dp)),
      )
      Text(
        text = brand.name,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Center,
      )
    }
  }
}
