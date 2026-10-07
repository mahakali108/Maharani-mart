package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.AccentIcon
import com.maharanitraders.core.designsystem.components.BellGlyph
import com.maharanitraders.core.designsystem.components.BookmarkGlyph
import com.maharanitraders.core.designsystem.components.ChatGlyph
import com.maharanitraders.core.designsystem.components.BoltGlyph
import com.maharanitraders.core.designsystem.components.BrandGlyph
import com.maharanitraders.core.designsystem.components.CartGlyph
import com.maharanitraders.core.designsystem.components.CategoryGlyph
import com.maharanitraders.core.designsystem.components.CoinGlyph
import com.maharanitraders.core.designsystem.components.CrownGlyph
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.HeartGlyph
import com.maharanitraders.core.designsystem.components.HomeGlyph
import com.maharanitraders.core.designsystem.components.HomeSkeleton
import com.maharanitraders.core.designsystem.components.MetricTile
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.OfferGlyph
import com.maharanitraders.core.designsystem.components.OrdersGlyph
import com.maharanitraders.core.designsystem.components.QuickActionTile
import com.maharanitraders.core.designsystem.components.RefreshGlyph
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.components.SortGlyph
import com.maharanitraders.core.designsystem.theme.AccentTone
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.feature.catalog.CatalogTab
import com.maharanitraders.feature.catalog.HomeCoins
import com.maharanitraders.feature.catalog.HomeDashboard
import com.maharanitraders.feature.catalog.HomeOrderSummary
import com.maharanitraders.feature.catalog.HomeQuickAction
import com.maharanitraders.feature.catalog.HomeQuickActionIcon
import com.maharanitraders.feature.catalog.HomeUiState
import com.maharanitraders.feature.catalog.HomeViewModel
import com.maharanitraders.feature.catalog.RecentlyViewedProduct
import com.maharanitraders.feature.catalog.ui.components.BrandTile
import com.maharanitraders.feature.catalog.ui.components.BannerCarousel
import com.maharanitraders.feature.catalog.ui.components.CategoryTile
import com.maharanitraders.feature.catalog.ui.components.ProductCard
import com.maharanitraders.feature.catalog.ui.components.ProductImage
import com.maharanitraders.feature.catalog.ui.components.productCardItems
import com.maharanitraders.feature.catalog.ui.components.quickAddQuantity

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

  /** The shortcut grid: one tag per tile, suffixed with the action's route. */
  const val QUICK_ACTIONS = "home_quick_actions"
  fun quickAction(route: String) = "home_quick_action_$route"

  /** The shop's own numbers. Each renders only when the server returned one. */
  const val COINS_TILE = "home_coins_tile"
  const val LAST_ORDER_CARD = "home_last_order_card"
  const val RECENTLY_VIEWED_ROW = "home_recently_viewed_row"
  const val DASHBOARD_RETRY = "home_dashboard_retry"
}

/**
 * The retailer home screen — the shop front.
 *
 * Top to bottom, the order the brief asks for: the admin's promotional banners
 * (or a branded, non-promotional welcome panel when no promotion is live), the
 * real category rail, the real brand rail, a "Recently added" rail fed by the
 * catalogue's own newest-first ordering, and the discovery grid — the first
 * batch of the real catalogue. A "Today's offers" rail is deliberately ABSENT:
 * PROMO-04 is blocked on a mobile schemes endpoint, and inventing one would be
 * fake data. This screen renders no section the server did not fill.
 * Every value arrives from `GET /api/mobile/v1/home` plus one `sort=newest`
 * catalogue batch; the screen has no fallback content, so when the request
 * fails the shopper sees an honest error or offline state with a retry rather
 * than a plausible looking shop that the warehouse cannot fulfil.
 *
 * Search lives in the shopping app bar above this screen (the shell owns the
 * field so it stays visible while scrolling, exactly like the reference UX);
 * submitting it hands the term to the catalogue.
 *
 * Below the welcome panel sit the RETAILER tools, each fed by its own endpoint:
 * shortcut tiles (only for routes this session may open), the Coins tile from
 * the wallet summary, the last order from the caller's own history — with a
 * "Buy again" action that opens the order, where the real reorder replays the
 * stored pieces at TODAY's price and stock — and a recently-viewed rail from the
 * device history. None of them is a fallback: a section the server did not fill
 * is not drawn, and a failed dashboard read is reported without taking the shop
 * off the screen.
 */
@Composable
fun RetailerHomeScreen(
  onOpenCatalog: (search: String, categoryId: String?, brandId: String?, brandLabel: String?) -> Unit,
  onOpenProduct: (productId: String) -> Unit,
  /**
   * Open the catalogue on one of its directory panes. The home rails' "View all"
   * lands on the pane it summarises (categories, brands) rather than on a
   * separate screen, because there is only one catalogue.
   */
  onOpenDirectory: (CatalogTab) -> Unit,
  /**
   * Open another destination of this account — the shortcut tiles' destination.
   * The caller passes only routes the SERVER-verified session can open, so a
   * tile is never a dead end.
   */
  onOpenDestination: (String) -> Unit = {},
  /** The shortcuts to draw. Empty (the default) draws no shortcut grid at all. */
  quickActions: List<HomeQuickAction> = emptyList(),
  /** The shop's own numbers: Coins, the last order, recently viewed products. */
  dashboard: HomeDashboard? = null,
  onRetryDashboard: () -> Unit = {},
  /** The server's own saved-cart line count, or null before it has answered. */
  cartLineCount: Int? = null,
  /** Open the Coins destination (the shell owns the route table). */
  onOpenCoins: () -> Unit = {},
  /** Open one order's detail — where the real reorder lives. */
  onOpenOrder: (String) -> Unit = {},
  /**
   * Quick add to the cart from a card, `(packId, quantity)`. Null (the default)
   * hides the card's add control entirely, which is what a non-retailer — or a
   * surface with no cart behind it — must get.
   */
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  /** The pack currently being added, so exactly one card shows a spinner. */
  quickAddPackId: String? = null,
  modifier: Modifier = Modifier,
  viewModel: HomeViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val favorites by viewModel.favoriteState.collectAsStateWithLifecycle()

  HomeContent(
    state = state,
    isFavorite = { product -> favorites.isFavorite(product.id, product.isFavorite) },
    isFavoritePending = { product -> favorites.isPending(product.id) },
    onToggleFavorite = viewModel::toggleFavorite,
    onRetry = viewModel::load,
    onOpenCatalog = { onOpenCatalog("", null, null, null) },
    onOpenCategory = { categoryId -> onOpenCatalog("", categoryId, null, null) },
    onOpenBrand = { brand -> onOpenCatalog("", null, brand.id, brand.name) },
    onOpenDirectory = onOpenDirectory,
    onOpenProduct = onOpenProduct,
    onOpenDestination = onOpenDestination,
    quickActions = quickActions,
    dashboard = dashboard,
    onRetryDashboard = onRetryDashboard,
    cartLineCount = cartLineCount,
    onOpenCoins = onOpenCoins,
    onOpenOrder = onOpenOrder,
    onQuickAddToCart = onQuickAddToCart,
    quickAddPackId = quickAddPackId,
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
  /**
   * Favourite state for one home card. Defaulted to the flag the SERVER put on
   * the product row so a preview (or a caller without the store) still renders a
   * truthful heart rather than a wrong one.
   */
  isFavorite: (CatalogProduct) -> Boolean = { it.isFavorite },
  isFavoritePending: (CatalogProduct) -> Boolean = { false },
  onToggleFavorite: ((String) -> Unit)? = null,
  onOpenCategory: (String) -> Unit,
  onOpenBrand: (CatalogBrand) -> Unit,
  onOpenDirectory: (CatalogTab) -> Unit,
  onOpenProduct: (String) -> Unit,
  onOpenDestination: (String) -> Unit = {},
  quickActions: List<HomeQuickAction> = emptyList(),
  dashboard: HomeDashboard? = null,
  onRetryDashboard: () -> Unit = {},
  cartLineCount: Int? = null,
  onOpenCoins: () -> Unit = {},
  onOpenOrder: (String) -> Unit = {},
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  quickAddPackId: String? = null,
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

          // Shortcuts first: the fastest way to a repeat order. The list is
          // built by the shell from the destinations THIS session may open, so
          // every tile lands on a real screen.
          if (quickActions.isNotEmpty()) {
            item(span = full) {
              QuickActionGrid(
                actions = quickActions,
                onOpenDestination = onOpenDestination,
                cartLineCount = cartLineCount,
              )
            }
          }

          // The shop's own numbers. Each card renders only when the server
          // actually returned that figure.
          if (dashboard != null) {
            if (dashboard.errorMessage != null) {
              item(span = full) {
                InlineErrorBanner(
                  message = dashboard.errorMessage,
                  offline = dashboard.offline,
                  onRetry = if (dashboard.retryable) onRetryDashboard else null,
                  retryTag = HomeScreenTags.DASHBOARD_RETRY,
                )
              }
            }
            dashboard.coins?.let { coins ->
              item(span = full) {
                CoinsTile(coins = coins, onOpenCoins = onOpenCoins)
              }
            }
            dashboard.lastOrder?.let { order ->
              item(span = full) {
                LastOrderCard(order = order, onOpenOrder = onOpenOrder)
              }
            }
            if (dashboard.recentlyViewed.isNotEmpty()) {
              item(span = full) {
                Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                  SectionHeader(
                    title = "Recently viewed",
                    subtitle = "Pick up where you left off — today's price loads on the product",
                  )
                  RecentlyViewedRail(
                    products = dashboard.recentlyViewed,
                    onOpenProduct = onOpenProduct,
                  )
                }
              }
            }
          }

          if (home.categories.isNotEmpty()) {
            item(span = full) {
              Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                SectionHeader(
                  title = "Shop by category",
                  subtitle = "Everything the shop stocks, by aisle",
                  actionLabel = "View all",
                  onAction = { onOpenDirectory(CatalogTab.CATEGORIES) },
                )
                CategoryRail(categories = home.categories, onSelect = onOpenCategory)
              }
            }
          }

          if (home.brands.isNotEmpty()) {
            item(span = full) {
              Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
                SectionHeader(
                  title = "Featured brands",
                  subtitle = "The houses you stock",
                  actionLabel = "View all",
                  onAction = { onOpenDirectory(CatalogTab.BRANDS) },
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
                RecentRail(
                  products = state.recent,
                  onOpenProduct = onOpenProduct,
                  isFavorite = isFavorite,
                  isFavoritePending = isFavoritePending,
                  onToggleFavorite = onToggleFavorite,
                  onQuickAddToCart = onQuickAddToCart,
                  quickAddPackId = quickAddPackId,
                )
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
            productCardItems(
              products = home.products,
              onOpenProduct = onOpenProduct,
              isFavorite = isFavorite,
              isFavoritePending = isFavoritePending,
              onToggleFavorite = onToggleFavorite,
              onQuickAddToCart = onQuickAddToCart,
              quickAddPackId = quickAddPackId,
            )
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
  isFavorite: (CatalogProduct) -> Boolean,
  isFavoritePending: (CatalogProduct) -> Boolean,
  onToggleFavorite: ((String) -> Unit)?,
  onQuickAddToCart: ((String, Int) -> Unit)? = null,
  quickAddPackId: String? = null,
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
        isFavorite = isFavorite(product),
        favoritePending = isFavoritePending(product),
        onToggleFavorite = onToggleFavorite?.let { toggle -> { toggle(product.id) } },
        onAddToCart = onQuickAddToCart?.let { add ->
          {
            val pack = product.pack
            if (pack != null) add(pack.packId, quickAddQuantity(pack))
          }
        },
        addPending = quickAddPackId != null && quickAddPackId == product.pack?.packId,
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
  retryTag: String = HomeScreenTags.REFRESH,
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
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(retryTag),
        ) {
          Text("Retry")
        }
      }
    }
  }
}

/**
 * The shortcut grid: four tiles per row, wrapping as the window widens.
 *
 * The tiles come from the shell, which builds them from the destinations the
 * session can actually open — so this grid can never advertise a screen the
 * account may not enter, and there is no "coming soon" tile anywhere in it.
 * The cart tile carries the SERVER's own line count (the same number the shell's
 * bottom-bar badge shows); a null count draws no bubble rather than a false 0.
 */
@Composable
private fun QuickActionGrid(
  actions: List<HomeQuickAction>,
  onOpenDestination: (String) -> Unit,
  cartLineCount: Int?,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.QUICK_ACTIONS),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    actions.chunked(4).forEach { row ->
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
      ) {
        row.forEach { action ->
          QuickActionTile(
            label = action.label,
            tone = action.tone,
            onClick = { onOpenDestination(action.route) },
            // Only the cart tile badges, and only with the server's own count.
            badgeCount = if (action.icon == HomeQuickActionIcon.CART) cartLineCount else null,
            modifier = Modifier
              .weight(1f)
              .testTag(HomeScreenTags.quickAction(action.route)),
            glyph = { tint -> QuickActionGlyph(action.icon, tint) },
          )
        }
        // Keeps the last row's tiles the same width as every other row, rather
        // than stretching three tiles across four columns.
        repeat(4 - row.size) {
          Box(modifier = Modifier.weight(1f))
        }
      }
    }
  }
}

/** The glyph for one shortcut. Drawn from the shared 24-grid icon set. */
@Composable
private fun QuickActionGlyph(icon: HomeQuickActionIcon, tint: Color) {
  val size = Modifier.size(22.dp)
  when (icon) {
    HomeQuickActionIcon.SHOP -> HomeGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.CATEGORY -> CategoryGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.BRAND -> BrandGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.ORDERS -> OrdersGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.CART -> CartGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.REORDER -> RefreshGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.FAVORITES -> HeartGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.QUICK_ORDER -> BoltGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.SAVED_CARTS -> BookmarkGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.COINS -> CoinGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.COUPONS -> OfferGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.SUPPORT -> ChatGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.NOTIFICATIONS -> BellGlyph(modifier = size, tint = tint)
    HomeQuickActionIcon.REPORTS -> SortGlyph(modifier = size, tint = tint)
  }
}

/**
 * The Coins balance, as the wallet endpoint reported it.
 *
 * The caption spells out what the number IS (funded minus spent) instead of
 * showing a bare figure, and no coin rule is invented here: the wallet screen
 * remains the place where the ledger and the redemption rules live.
 */
@Composable
private fun CoinsTile(
  coins: HomeCoins,
  onOpenCoins: () -> Unit,
  modifier: Modifier = Modifier,
) {
  MetricTile(
    label = "Maharani Coins",
    value = MoneyFormat.formatPaise(coins.balancePaise),
    tone = AccentTone.AMBER,
    caption = "Funded ${MoneyFormat.formatPaise(coins.fundedPaise)} · " +
      "spent ${MoneyFormat.formatPaise(coins.spentPaise)}",
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.COINS_TILE),
    trailing = {
      TextButton(onClick = onOpenCoins, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) {
        Text("Ledger")
      }
    },
    glyph = { tint -> CoinGlyph(modifier = Modifier.size(22.dp), tint = tint) },
  )
}

/**
 * The most recent order, from the caller's own history endpoint.
 *
 * "Reorder" opens the ORDER, not a rebuilt basket: the order detail replays the
 * stored pieces through the cart API, so today's price, stock and MOQ decide —
 * a reorder built from this card's summary would be quoting history.
 */
@Composable
private fun LastOrderCard(
  order: HomeOrderSummary,
  onOpenOrder: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.LAST_ORDER_CARD),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
      ) {
        AccentIcon(tone = AccentTone.BLUE, size = 40.dp) { tint ->
          OrdersGlyph(modifier = Modifier.size(22.dp), tint = tint)
        }
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
        ) {
          Text(
            text = "Last order",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          Text(
            text = order.orderNumber,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
          Text(
            text = order.statusLabel,
            style = MaterialTheme.typography.labelSmall,
            color = tokens.info,
          )
        }
        Column(horizontalAlignment = Alignment.End) {
          Text(
            text = MoneyFormat.formatPaise(order.totalPaise),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
          )
          Text(
            text = "${order.itemCount} item(s)",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
      OutlinedButton(
        onClick = { onOpenOrder(order.id) },
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = MaharaniDimens.touchTarget),
      ) {
        Text("Buy again")
      }
    }
  }
}

/**
 * Recently viewed products, from the DEVICE history only.
 *
 * The tile shows what the server said about the product's identity when it was
 * opened — name, brand, pack and artwork — and deliberately no price: a rate
 * cached on the device would be yesterday's, and this app never displays money
 * the server did not just confirm. Tapping opens the product detail, where the
 * live price arrives.
 */
@Composable
private fun RecentlyViewedRail(
  products: List<RecentlyViewedProduct>,
  onOpenProduct: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyRow(
    modifier = modifier
      .fillMaxWidth()
      .testTag(HomeScreenTags.RECENTLY_VIEWED_ROW),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
  ) {
    items(products, key = { it.id }) { product ->
      Surface(
        onClick = { onOpenProduct(product.id) },
        shape = RoundedCornerShape(MaharaniDimens.radiusCard),
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.width(MaharaniDimens.railCardWidth),
      ) {
        Column(
          modifier = Modifier.padding(MaharaniDimens.cardPadding),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        ) {
          ProductImage(
            url = product.imageUrl,
            fallbackLabel = product.name,
            modifier = Modifier
              .fillMaxWidth()
              .aspectRatio(MaharaniDimens.productImageRatio)
              .clip(RoundedCornerShape(MaharaniDimens.radiusTile)),
          )
          product.brandName?.let { brand ->
            Text(
              text = brand.uppercase(),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.primary,
              fontWeight = FontWeight.SemiBold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          Text(
            text = product.name,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            minLines = 2,
          )
          product.packName?.let { pack ->
            Text(
              text = pack,
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          Text(
            text = "Tap for today's price",
            style = MaterialTheme.typography.labelSmall,
            color = MaharaniThemeTokens.colors.info,
          )
        }
      }
    }
  }
}
