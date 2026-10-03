package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.CrownGlyph
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.HomeSkeleton
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.feature.catalog.HomeUiState
import com.maharanitraders.feature.catalog.HomeViewModel
import com.maharanitraders.feature.catalog.ui.components.BrandTile
import com.maharanitraders.feature.catalog.ui.components.BannerCarousel
import com.maharanitraders.feature.catalog.ui.components.CategoryTile
import com.maharanitraders.feature.catalog.ui.components.ProductCard
import com.maharanitraders.feature.catalog.ui.components.productCardItems

/** Test tags for the retailer home surface. */
object HomeScreenTags {
  const val SEARCH_FIELD = "home_search_field"
  const val BANNER_PAGER = "home_banner_pager"
  const val CATEGORY_ROW = "home_category_row"
  const val BRAND_ROW = "home_brand_row"
  const val RECENT_ROW = "home_recent_row"
  const val PRODUCT_GRID = "home_product_grid"
  const val REFRESH = "home_refresh"
  const val WELCOME = "home_welcome_panel"
}

/**
 * The retailer home screen — the shop front.
 *
 * Top to bottom: the admin's promotional banners (or a branded, non-promotional
 * welcome panel when no promotion is live), the real category rail, the real
 * brand rail, a "Recently added" rail fed by the catalogue's own newest-first
 * ordering, and the discovery grid — the first batch of the real catalogue.
 * Every value arrives from `GET /api/mobile/v1/home` plus one `sort=newest`
 * catalogue batch; the screen has no fallback content, so when the request
 * fails the shopper sees an honest error or offline state with a retry rather
 * than a plausible looking shop that the warehouse cannot fulfil.
 *
 * Search lives in the shopping app bar above this screen (the shell owns the
 * field so it stays visible while scrolling, exactly like the reference UX);
 * submitting it hands the term to the catalogue.
 *
 * Cart, coins and orders are intentionally absent — they are later phases, and
 * this screen offers no affordance that pretends otherwise.
 */
@Composable
fun RetailerHomeScreen(
  onOpenCatalog: (search: String, categoryId: String?, brandId: String?, brandLabel: String?) -> Unit,
  onOpenProduct: (productId: String) -> Unit,
  onOpenCategories: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: HomeViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  HomeContent(
    state = state,
    onRetry = viewModel::load,
    onOpenCatalog = { onOpenCatalog("", null, null, null) },
    onOpenCategory = { categoryId -> onOpenCatalog("", categoryId, null, null) },
    onOpenBrand = { brand -> onOpenCatalog("", null, brand.id, brand.name) },
    onOpenCategories = onOpenCategories,
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
  onOpenCatalog: () -> Unit,
  onOpenCategory: (String) -> Unit,
  onOpenBrand: (CatalogBrand) -> Unit,
  onOpenCategories: () -> Unit,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minSize = 158.dp),
    state = rememberLazyGridState(),
    modifier = modifier
      .fillMaxSize()
      .testTag(HomeScreenTags.PRODUCT_GRID),
    contentPadding = PaddingValues(
      horizontal = MaharaniDimens.pageGutter,
      vertical = MaharaniDimens.spaceMd,
    ),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    // The receiver type has to be written out: without it Kotlin infers
    // `() -> GridItemSpan`, which has no `maxLineSpan` and does not match the
    // `LazyGridItemSpanScope.() -> GridItemSpan` that `item(span = …)` expects.
    val full: LazyGridItemSpanScope.() -> GridItemSpan = { GridItemSpan(maxLineSpan) }

    when {
      // First load with nothing on screen yet: a skeleton, not a blank page.
      state.loading && state.home == null -> item(span = full) {
        HomeSkeleton()
      }

      // A failure with no cached content: offline gets its own state, because
      // "check your connection" and "the server failed" need different action.
      state.errorMessage != null && state.home == null -> item(span = full) {
        if (state.offline) {
          OfflineState(onRetry = onRetry)
        } else {
          ErrorState(
            message = state.errorMessage.orEmpty(),
            retryable = state.retryable,
            onRetry = onRetry,
          )
        }
      }

      // Nothing to show at all, and no error: the account genuinely has no
      // catalogue yet. Retry stays available because that is usually a sync
      // problem rather than an empty shop.
      state.home == null -> item(span = full) {
        EmptyState(
          title = "Nothing to show yet",
          message = "The catalogue is empty right now. Try again shortly — new stock " +
            "appears here as soon as the warehouse publishes it.",
          actionLabel = "Try again",
          onAction = onRetry,
        )
      }

      else -> {
        val home = state.home
        if (home != null) {
          // A failure WITH content keeps the content and explains above it, so
          // a failed refresh never blanks a shop the shopper was reading.
          if (state.errorMessage != null) {
            item(span = full) {
              InlineErrorBanner(
                message = state.errorMessage.orEmpty(),
                offline = state.offline,
                onRetry = if (state.retryable) onRetry else null,
              )
            }
          }

          item(span = full) {
            if (home.banners.isNotEmpty()) {
              BannerCarousel(banners = home.banners)
            } else {
              WelcomePanel()
            }
          }

          if (home.categories.isNotEmpty()) {
            item(span = full) {
              Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                SectionHeader(
                  title = "Shop by category",
                  actionLabel = "View all",
                  onAction = onOpenCategories,
                )
                CategoryRail(categories = home.categories, onSelect = onOpenCategory)
              }
            }
          }

          if (home.brands.isNotEmpty()) {
            item(span = full) {
              Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                SectionHeader(
                  title = "Shop by brand",
                  actionLabel = "View all",
                  onAction = onOpenCategories,
                )
                BrandRail(brands = home.brands, onSelect = onOpenBrand)
              }
            }
          }

          if (state.recent.isNotEmpty()) {
            item(span = full) {
              Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                SectionHeader(
                  title = "Recently added",
                  subtitle = "Newest in your catalogue",
                )
                RecentRail(products = state.recent, onOpenProduct = onOpenProduct)
              }
            }
          }

          if (home.products.isNotEmpty()) {
            item(span = full) {
              SectionHeader(
                title = "Browse products",
                subtitle = "Wholesale rates priced for your shop",
                actionLabel = "View all",
                onAction = onOpenCatalog,
              )
            }
            productCardItems(home.products, onOpenProduct)
          }

          item(span = full) {
            Text(
              text = "Prices are GST-inclusive wholesale rates for your shop, " +
                "confirmed by the server at order time.",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              textAlign = TextAlign.Center,
              modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = MaharaniDimens.spaceMd),
            )
          }
        }
      }
    }
  }
}

/**
 * The non-promotional fallback for a home with no live banner: brand identity
 * and a true statement about how pricing works. No discount, no offer, no
 * invented campaign — an empty banner list is a normal server answer.
 */
@Composable
private fun WelcomePanel(modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.WELCOME),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(MaharaniDimens.radiusCard))
        .background(
          Brush.verticalGradient(
            listOf(tokens.actionContainer, MaterialTheme.colorScheme.surface),
          ),
        )
        .padding(MaharaniDimens.spaceLg),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Box(
        modifier = Modifier
          .size(46.dp)
          .clip(CircleShape)
          .background(tokens.brandMarkSurface),
        contentAlignment = Alignment.Center,
      ) {
        CrownGlyph(modifier = Modifier.size(26.dp), tint = tokens.brandMark)
      }
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
        Text(
          text = "Wholesale, priced for your shop",
          style = MaterialTheme.typography.titleMedium,
          color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
          text = "Live stock, pack sizes and slab rates — the same numbers checkout uses.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

/** The horizontally scrolling category rail. Real categories only. */
@Composable
private fun CategoryRail(
  categories: List<CatalogCategory>,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.CATEGORY_ROW),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    items(categories, key = { it.id }) { category ->
      CategoryTile(category = category, onClick = { onSelect(category.id) })
    }
  }
}

/** The horizontally scrolling brand rail. Real brands only. */
@Composable
private fun BrandRail(
  brands: List<CatalogBrand>,
  onSelect: (CatalogBrand) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.BRAND_ROW),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    items(brands, key = { it.id }) { brand ->
      BrandTile(brand = brand, onClick = { onSelect(brand) })
    }
  }
}

/** The "Recently added" rail: real cards at rail width. */
@Composable
private fun RecentRail(
  products: List<CatalogProduct>,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.RECENT_ROW),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    items(products, key = { it.id }) { product ->
      ProductCard(
        product = product,
        onClick = { onOpenProduct(product.id) },
        modifier = Modifier.width(MaharaniDimens.railCardWidth),
      )
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
    color = if (offline) {
      MaterialTheme.colorScheme.surfaceVariant
    } else {
      MaterialTheme.colorScheme.errorContainer
    },
    contentColor = if (offline) {
      MaterialTheme.colorScheme.onSurfaceVariant
    } else {
      MaterialTheme.colorScheme.onErrorContainer
    },
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier.fillMaxWidth(),
  ) {
    Row(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Text(
        text = if (offline) "You are offline — showing the last loaded shop." else message,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.weight(1f),
      )
      if (onRetry != null) {
        TextButton(
          onClick = onRetry,
          modifier = Modifier
            .heightIn(min = 40.dp)
            .testTag(HomeScreenTags.REFRESH),
        ) {
          Text("Retry")
        }
      }
    }
  }
}
