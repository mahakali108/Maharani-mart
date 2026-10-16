package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import coil3.compose.SubcomposeAsyncImage
import com.maharanitraders.core.designsystem.components.SkeletonSurface
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.feature.catalog.ui.CatalogTags

/**
 * Server product imagery.
 *
 * Coil 3 keeps its network support in a separate artifact, installed once by
 * the application module's image loader factory; this composable only names a
 * URL the server already resolved.
 *
 * Presentation rules this component enforces (they are the difference between a
 * grid that looks shopped and a grid that looks broken):
 *  - the artwork is CENTRED and `Fit` by default, so nothing is cropped into an
 *    unreadable label and nothing is stretched;
 *  - it sits on its own light, neutral surface, so a product photo with a white
 *    background does not dissolve into the card;
 *  - while the bytes arrive the slot shows the shared skeleton — never a blank
 *    hole that reflows the grid when the image lands;
 *  - a missing, blank or failed URL renders a MONOGRAM tile (the first letter of
 *    the product or brand), optionally brand-tinted, and never a broken glyph or
 *    borrowed artwork.
 */
@Composable
fun ProductImage(
  url: String?,
  fallbackLabel: String,
  modifier: Modifier = Modifier,
  contentScale: ContentScale = ContentScale.Fit,
  testTag: String = CatalogTags.PRODUCT_IMAGE,
  /** Tint the monogram with the violet identity (directory tiles) instead of ink grey. */
  brandedMonogram: Boolean = false,
) {
  SubcomposeAsyncImage(
    model = url,
    contentDescription = fallbackLabel,
    contentScale = contentScale,
    modifier = modifier
      .background(MaharaniThemeTokens.colors.imagePlaceholder)
      .testTag(testTag),
    loading = { SkeletonSurface(modifier = Modifier.fillMaxSize()) },
    error = { ProductImageFallback(fallbackLabel, brandedMonogram) },
  )
}

@Composable
private fun ProductImageFallback(label: String, brandedMonogram: Boolean) {
  val tokens = MaharaniThemeTokens.colors
  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(if (brandedMonogram) tokens.brandMarkSurface else tokens.imagePlaceholder),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = label.trim().take(1).uppercase(),
      style = MaterialTheme.typography.titleLarge,
      fontWeight = FontWeight.SemiBold,
      color = if (brandedMonogram) tokens.brandMark else tokens.onImagePlaceholder,
    )
  }
}
