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
 * URL the server already resolved. While the bytes arrive the slot shows the
 * shared skeleton, and a missing or failed image renders a neutral tile with
 * the product's initial rather than a broken glyph — no placeholder artwork is
 * ever claimed to be the product.
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
      .background(MaterialTheme.colorScheme.surfaceContainerLow)
      .testTag(testTag),
    loading = { SkeletonSurface(modifier = Modifier.fillMaxSize()) },
    error = { ProductImageFallback(fallbackLabel) },
  )
}

@Composable
private fun ProductImageFallback(label: String) {
  val tokens = MaharaniThemeTokens.colors
  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(tokens.imagePlaceholder),
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text = label.trim().take(1).uppercase(),
      style = MaterialTheme.typography.titleLarge,
      fontWeight = FontWeight.SemiBold,
      color = tokens.onImagePlaceholder,
    )
  }
}
