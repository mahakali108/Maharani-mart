package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.PagerDots
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.PromoBanner
import com.maharanitraders.feature.catalog.ui.HomeScreenTags
import kotlinx.coroutines.delay

/** Test tag of the carousel, addressable from Compose UI tests. */
const val BANNER_CAROUSEL_TAG = HomeScreenTags.BANNER_PAGER

/** Dwell time on one banner before the carousel advances on its own. */
private const val BANNER_DWELL_MS = 6_000L

/**
 * The admin's promotional banners, exactly as the server published them.
 *
 * Rendered only when the server returned some: visibility (active + area +
 * schedule window) and the link target were already decided server-side, and
 * an empty list simply means no promotion is running — the home screen then
 * shows no carousel at all rather than a fabricated one.
 *
 * A banner is tappable only when the server resolved its link to a rooted app
 * route ([PromoBanner.isNavigable]); anything else is artwork with copy, not a
 * button. The carousel advances gently on its own and pauses while the shopper
 * is dragging.
 */
@Composable
fun BannerCarousel(
  banners: List<PromoBanner>,
  modifier: Modifier = Modifier,
  onOpenRoute: ((String) -> Unit)? = null,
) {
  if (banners.isEmpty()) return
  val pagerState = rememberPagerState(pageCount = { banners.size })

  LaunchedEffect(pagerState, banners.size) {
    while (banners.size > 1) {
      delay(BANNER_DWELL_MS)
      if (!pagerState.isScrollInProgress) {
        pagerState.animateScrollToPage((pagerState.currentPage + 1) % banners.size)
      }
    }
  }

  Column(
    modifier = modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    HorizontalPager(
      state = pagerState,
      modifier = Modifier
        .fillMaxWidth()
        .testTag(BANNER_CAROUSEL_TAG),
      pageSpacing = MaharaniDimens.spaceMd,
    ) { page ->
      BannerCard(
        banner = banners[page],
        onOpenRoute = onOpenRoute,
      )
    }

    PagerDots(
      pageCount = banners.size,
      currentPage = pagerState.currentPage,
    )
  }
}

@Composable
private fun BannerCard(
  banner: PromoBanner,
  modifier: Modifier = Modifier,
  onOpenRoute: ((String) -> Unit)? = null,
) {
  val tokens = MaharaniThemeTokens.colors
  val route = banner.linkUrl
  val clickable = onOpenRoute != null && route != null && banner.isNavigable

  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(MaharaniDimens.radiusCard))
      // `clickable` already proves the callback and the route exist, and the
      // compiler smart-casts both from that stable val — no safe call needed.
      .then(if (clickable) Modifier.clickable { onOpenRoute.invoke(route.orEmpty()) } else Modifier),
  ) {
    Box(modifier = Modifier.fillMaxWidth()) {
      ProductImage(
        url = banner.imageUrl,
        fallbackLabel = banner.title,
        contentScale = ContentScale.Crop,
        modifier = Modifier
          .fillMaxWidth()
          .height(MaharaniDimens.bannerHeight),
      )

      // A restrained scrim keeps the banner copy legible on any artwork.
      Box(
        modifier = Modifier
          .fillMaxWidth()
          .height(MaharaniDimens.bannerHeight)
          .clip(RoundedCornerShape(MaharaniDimens.radiusCard))
          .background(Brush.verticalGradient(listOf(Color.Transparent, tokens.scrim))),
      )

      Column(
        modifier = Modifier
          .align(Alignment.BottomStart)
          .fillMaxWidth()
          .padding(MaharaniDimens.spaceLg),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
      ) {
        Text(
          text = banner.title,
          style = MaterialTheme.typography.titleMedium,
          color = Color.White,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
        banner.subtitle?.let { subtitle ->
          Text(
            text = subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.85f),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
        }
        val cta = banner.ctaLabel
        if (cta != null && clickable) {
          Surface(
            // Gold call to action: the accent that makes a live promotion read
            // as an event rather than as one more white chip.
            color = MaterialTheme.colorScheme.secondary,
            contentColor = MaterialTheme.colorScheme.onSecondary,
            shape = RoundedCornerShape(MaharaniDimens.radiusPill),
          ) {
            Text(
              text = cta,
              style = MaterialTheme.typography.labelLarge,
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            )
          }
        }
      }
    }
  }
}
