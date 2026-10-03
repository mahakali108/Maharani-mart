package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.PromoBanner
import com.maharanitraders.feature.catalog.HomeUiState
import com.maharanitraders.feature.catalog.HomeViewModel

/** Test tags for the retailer home surface. */
object HomeScreenTags {
  const val SEARCH_FIELD = "home_search_field"
  const val BANNER_PAGER = "home_banner_pager"
  const val CATEGORY_ROW = "home_category_row"
  const val PRODUCT_GRID = "home_product_grid"
  const val REFRESH = "home_refresh"
}

/**
 * The retailer home screen (Phase D).
 *
 * Layout, top to bottom: a prominent search field, the admin's promotional
 * banners, the real category strip, and a responsive grid of real catalogue
 * products. Every one of those comes from `GET /api/mobile/v1/home`; the screen
 * has no fallback content, so when the request fails the shopper sees an honest
 * error or offline state with a retry rather than a plausible looking shop that
 * the warehouse cannot fulfil.
 *
 * Cart, coins and orders are intentionally absent — they are later phases, and
 * this screen offers no affordance that pretends otherwise.
 */
@Composable
fun RetailerHomeScreen(
  onOpenCatalog: (search: String, categoryId: String?) -> Unit,
  onOpenProduct: (productId: String) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: HomeViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  HomeContent(
    state = state,
    onRetry = viewModel::load,
    onSearchSubmit = { query -> onOpenCatalog(query, null) },
    onOpenCatalog = { onOpenCatalog("", null) },
    onOpenCategory = { categoryId -> onOpenCatalog("", categoryId) },
    onOpenProduct = onOpenProduct,
    modifier = modifier,
  )
}

/**
 * The home layout, split from the ViewModel so it is previewable and so the
 * state-to-UI mapping can be reasoned about on its own.
 */
@Composable
fun HomeContent(
  state: HomeUiState,
  onRetry: () -> Unit,
  onSearchSubmit: (String) -> Unit,
  onOpenCatalog: () -> Unit,
  onOpenCategory: (String) -> Unit,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  var search by rememberSaveable { mutableStateOf("") }

  // Adaptive columns: two across a phone, more as the window widens, without a
  // single hardcoded breakpoint.
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = 150.dp),
    modifier = modifier
      .fillMaxSize()
      .testTag(HomeScreenTags.PRODUCT_GRID),
    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item(span = { GridItemSpan(maxLineSpan) }) {
      HomeSearchField(
        value = search,
        onValueChange = { search = it },
        onSubmit = { onSearchSubmit(search.trim()) },
      )
    }

    when {
      // First load with nothing on screen yet: a skeleton, not a blank page.
      state.loading && state.home == null -> item(span = { GridItemSpan(maxLineSpan) }) {
        ProductGridSkeleton(columns = 2, rows = 3)
      }

      // Nothing to show at all, and no error: the account genuinely has no
      // catalogue yet. Retry stays available because that is usually a sync
      // problem rather than an empty shop.
      state.isEmpty -> item(span = { GridItemSpan(maxLineSpan) }) {
        EmptyState(
          title = "Nothing to show yet",
          message = "The catalogue is empty right now. Pull to refresh, or try again shortly.",
          actionLabel = "Try again",
          onAction = onRetry,
        )
      }

      // A failure with no cached content: offline gets its own state, because
      // "check your connection" and "the server failed" need different action.
      state.errorMessage != null && state.home == null -> item(span = { GridItemSpan(maxLineSpan) }) {
        if (state.offline) OfflineState(onRetry = onRetry)
        else ErrorState(message = state.errorMessage.orEmpty(), retryable = state.retryable, onRetry = onRetry)
      }

      else -> {
        // A failure WITH content keeps the content and explains above it, so a
        // failed refresh never blanks a shop the shopper was reading.
        if (state.errorMessage != null) {
          item(span = { GridItemSpan(maxLineSpan) }) {
            InlineErrorBanner(
              message = state.errorMessage.orEmpty(),
              offline = state.offline,
              onRetry = if (state.retryable) onRetry else null,
            )
          }
        }

        val home = state.home
        if (home != null) {
          if (home.banners.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
              BannerCarousel(banners = home.banners)
            }
          }

          if (home.categories.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
              Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionHeader(title = "Shop by category", actionLabel = "View all", onAction = onOpenCatalog)
                CategoryStrip(categories = home.categories, onSelect = onOpenCategory)
              }
            }
          }

          if (home.products.isNotEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
              SectionHeader(title = "Products for you", actionLabel = "View all", onAction = onOpenCatalog)
            }
            items(home.products, key = { it.id }) { product ->
              ProductCardTile(
                product = product,
                onClick = { onOpenProduct(product.id) },
                modifier = Modifier.fillMaxWidth(),
              )
            }
          }
        } else if (state.loading) {
          item(span = { GridItemSpan(maxLineSpan) }) { LoadingState(message = "Loading your shop…") }
        }
      }
    }
  }
}

/** The prominent search entry point. Submitting hands the term to the catalogue. */
@Composable
private fun HomeSearchField(
  value: String,
  onValueChange: (String) -> Unit,
  onSubmit: () -> Unit,
  modifier: Modifier = Modifier,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.SEARCH_FIELD),
    placeholder = { Text("Search products, brands, pack sizes") },
    leadingIcon = { SearchGlyph(modifier = Modifier.padding(start = 8.dp)) },
    singleLine = true,
    shape = RoundedCornerShape(28.dp),
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
  )
}

/**
 * Admin-configured promotional banners.
 *
 * Rendered only when the server returned some: the 3:1 artwork standard is the
 * admin workspace's own (`BANNER_STANDARD`), and an empty list simply means no
 * promotion is running — the home screen then shows no carousel at all rather
 * than a fabricated one.
 */
@Composable
private fun BannerCarousel(banners: List<PromoBanner>, modifier: Modifier = Modifier) {
  val pagerState = rememberPagerState(pageCount = { banners.size })

  Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    HorizontalPager(
      state = pagerState,
      modifier = Modifier
        .fillMaxWidth()
        .testTag(HomeScreenTags.BANNER_PAGER),
      pageSpacing = 8.dp,
    ) { page ->
      val banner = banners[page]
      Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth(),
      ) {
        Box(modifier = Modifier.fillMaxWidth()) {
          ProductImage(
            url = banner.imageUrl,
            fallbackLabel = banner.title,
            contentScale = ContentScale.Crop,
            testTag = HomeScreenTags.BANNER_PAGER,
            modifier = Modifier
              .fillMaxWidth()
              .height(140.dp),
          )
          Column(
            modifier = Modifier
              .align(Alignment.BottomStart)
              .fillMaxWidth()
              .padding(12.dp),
          ) {
            Text(
              text = banner.title,
              style = MaterialTheme.typography.titleMedium,
              color = MaterialTheme.colorScheme.onSurface,
              maxLines = 2,
              overflow = TextOverflow.Ellipsis,
            )
            banner.subtitle?.let { subtitle ->
              Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
              )
            }
          }
        }
      }
    }

    PagerDots(
      pageCount = banners.size,
      currentPage = pagerState.currentPage,
      modifier = Modifier.align(Alignment.CenterHorizontally),
    )
  }
}

/** The horizontally scrolling category strip. Real categories only. */
@Composable
private fun CategoryStrip(
  categories: List<CatalogCategory>,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.CATEGORY_ROW),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    items(categories, key = { it.id }) { category ->
      CategoryTile(category = category, onClick = { onSelect(category.id) })
    }
  }
}

@Composable
private fun CategoryTile(category: CatalogCategory, onClick: () -> Unit, modifier: Modifier = Modifier) {
  Surface(
    modifier = modifier
      .size(width = 96.dp, height = 116.dp)
      .clip(RoundedCornerShape(16.dp))
      .clickableTile(onClick),
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = 1.dp,
  ) {
    Column(
      modifier = Modifier.padding(8.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      ProductImage(
        url = category.imageUrl,
        fallbackLabel = category.name,
        modifier = Modifier
          .size(56.dp)
          .clip(RoundedCornerShape(12.dp)),
      )
      Text(
        text = category.name,
        style = MaterialTheme.typography.labelMedium,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
      )
      // A null count means the server could not count them; nothing is invented.
      category.productCount?.let { count ->
        Text(
          text = "$count items",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

/** A non-blocking failure notice shown above content that is still usable. */
@Composable
private fun InlineErrorBanner(
  message: String,
  offline: Boolean,
  onRetry: (() -> Unit)?,
  modifier: Modifier = Modifier,
) {
  Surface(
    color = if (offline) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.errorContainer,
    contentColor = if (offline) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onErrorContainer,
    shape = RoundedCornerShape(12.dp),
    modifier = modifier.fillMaxWidth(),
  ) {
    Row(
      modifier = Modifier.padding(12.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text(
        text = if (offline) "You are offline — showing the last loaded shop." else message,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.weight(1f),
      )
      if (onRetry != null) {
        Text(
          text = "Retry",
          style = MaterialTheme.typography.labelLarge,
          modifier = Modifier
            .testTag(HomeScreenTags.REFRESH)
            .clickableTile(onRetry)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        )
      }
    }
  }
}

/**
 * Tappable modifier with an explicit minimum touch target.
 *
 * Text-only affordances ("Retry", a category tile) are smaller than the 48dp
 * accessibility minimum on their own, so the target is padded out here rather
 * than left to chance on a small screen.
 */
private fun Modifier.clickableTile(onClick: () -> Unit): Modifier =
  this
    .heightIn(min = 48.dp)
    .clickable(onClick = onClick)
