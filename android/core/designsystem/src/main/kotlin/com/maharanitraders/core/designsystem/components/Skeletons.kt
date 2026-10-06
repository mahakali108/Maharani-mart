package com.maharanitraders.core.designsystem.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens

/**
 * Loading skeletons: the SHAPE of the content that is about to arrive, pulsing
 * gently — never a fake product, price or banner.
 *
 * One shared pulse keeps every skeleton on screen breathing in step, and one
 * token pair (`skeletonBase`, `skeletonHighlight`) keeps dark mode honest.
 */

/** The shared 0.55 → 1 alpha pulse every skeleton uses. */
@Composable
private fun skeletonAlpha(): Float {
  val transition = rememberInfiniteTransition()
  val alpha by transition.animateFloat(
    initialValue = 0.55f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(
      animation = tween(durationMillis = 900, easing = LinearEasing),
      repeatMode = RepeatMode.Reverse,
    ),
  )
  return alpha
}

/**
 * A pulsing rounded placeholder block.
 *
 * The two skeleton tones come from the theme tokens (`skeletonBase`,
 * `skeletonHighlight`) rather than a hardcoded grey, so dark mode keeps its own
 * contrast. [emphasized] picks the lighter tone — used for the big image area,
 * where the darker tone would read as a heavy block.
 */
@Composable
fun SkeletonSurface(
  modifier: Modifier = Modifier,
  shape: RoundedCornerShape = RoundedCornerShape(8.dp),
  emphasized: Boolean = false,
) {
  val tokens = MaharaniThemeTokens.colors
  Box(
    modifier = modifier
      .alpha(skeletonAlpha())
      .clip(shape)
      .background(if (emphasized) tokens.skeletonHighlight else tokens.skeletonBase),
  )
}

/** A text-line placeholder. */
@Composable
fun SkeletonBlock(
  modifier: Modifier = Modifier,
  height: Dp = 14.dp,
  widthFraction: Float = 1f,
) {
  SkeletonSurface(
    modifier = modifier
      .fillMaxWidth(widthFraction)
      .height(height),
    shape = RoundedCornerShape(6.dp),
  )
}

/** One product card's worth of placeholder: image, name lines, price line. */
@Composable
fun ProductCardSkeleton(modifier: Modifier = Modifier) {
  Column(
    modifier = modifier
      .clip(RoundedCornerShape(MaharaniDimens.radiusCard))
      .background(MaterialTheme.colorScheme.surface)
      // Same padding as the real card, so the loading grid has the geometry of
      // the loaded one and nothing shifts when the data lands.
      .padding(MaharaniDimens.cardPadding),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    SkeletonSurface(
      modifier = Modifier
        .fillMaxWidth()
        .aspectRatio(MaharaniDimens.productImageRatio),
      shape = RoundedCornerShape(MaharaniDimens.radiusTile),
      emphasized = true,
    )
    SkeletonBlock(height = 13.dp, widthFraction = 0.55f)
    SkeletonBlock(height = 15.dp)
    SkeletonBlock(height = 15.dp, widthFraction = 0.75f)
    SkeletonBlock(height = 18.dp, widthFraction = 0.5f)
  }
}

/**
 * The deliverable name for a single product placeholder: an alias of
 * [ProductCardSkeleton], so every caller and every design doc can use one
 * vocabulary for "one card's worth of loading shape".
 */
@Composable
fun ProductSkeleton(modifier: Modifier = Modifier) {
  ProductCardSkeleton(modifier = modifier)
}

/** A responsive grid's worth of card placeholders. */
@Composable
fun ProductGridSkeleton(
  columns: Int,
  rows: Int = 3,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    repeat(rows) {
      Row(horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap)) {
        repeat(columns) {
          ProductCardSkeleton(modifier = Modifier.weight(1f))
        }
      }
    }
  }
}

/** A horizontal rail's worth of card placeholders. */
@Composable
fun ProductRailSkeleton(
  count: Int = 3,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier = modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    repeat(count) {
      ProductCardSkeleton(modifier = Modifier.width(MaharaniDimens.railCardWidth))
    }
  }
}

/** Category tile placeholders (image disc + label). */
@Composable
fun CategoryRailSkeleton(
  count: Int = 5,
  modifier: Modifier = Modifier,
) {
  Row(
    modifier = modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    repeat(count) {
      Column(
        modifier = Modifier.width(MaharaniDimens.categoryTileWidth),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        SkeletonSurface(
          modifier = Modifier
            .size(MaharaniDimens.categoryTileImage)
            .clip(CircleShape),
          shape = CircleShape,
        )
        SkeletonBlock(height = 11.dp, widthFraction = 0.8f)
      }
    }
  }
}

/** The promotional banner's placeholder. */
@Composable
fun BannerSkeleton(modifier: Modifier = Modifier) {
  SkeletonSurface(
    modifier = modifier
      .fillMaxWidth()
      .height(MaharaniDimens.bannerHeight),
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
  )
}

/** The whole home screen's first-load shape. */
@Composable
fun HomeSkeleton(modifier: Modifier = Modifier) {
  Column(
    modifier = modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceLg),
  ) {
    BannerSkeleton()
    CategoryRailSkeleton()
    ProductGridSkeleton(columns = 2, rows = 2)
  }
}
