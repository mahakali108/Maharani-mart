package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.FavoriteButton
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.PagerDots
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import com.maharanitraders.feature.catalog.ProductDetailUiState
import com.maharanitraders.feature.catalog.ProductDetailViewModel
import com.maharanitraders.feature.catalog.ui.components.ProductImage

/** Test tags for the product detail surface. */
object ProductDetailTags {
  const val GALLERY = "product_gallery"
  const val TITLE = "product_title"
  const val PACK_SELECTOR = "product_pack_selector"
  const val PRICE = "product_price"
  const val LINE_TOTAL = "product_line_total"
  const val MOQ = "product_moq"
  const val CASE_SIZE = "product_case_size"
  const val TIER_TABLE = "product_tier_table"
  const val AVAILABILITY = "product_availability"
  const val ADD_TO_CART = "product_add_to_cart"
  const val NOT_FOUND = "product_not_found"
  const val FAVORITE_TOGGLE = "product_favorite_toggle"
}

/**
 * The product detail screen.
 *
 * This screen shows money, and none of it is computed here: the per-piece rate,
 * the GST-inclusive line total at the MOQ, the case price and the slab table all
 * arrive from the same pricing engine checkout uses, so what the shopper reads
 * is what an order would be charged.
 *
 * The add action sends only the server-selected pack id and MOQ piece intent;
 * it never sends a price. The authenticated backend revalidates quantity and
 * persists the shared cart, and checkout obtains a fresh authoritative quote.
 */
@Composable
fun ProductDetailScreen(
  onBack: () -> Unit,
  onAddToCart: (packId: String, quantity: Int) -> Unit,
  canAddToCart: Boolean,
  modifier: Modifier = Modifier,
  viewModel: ProductDetailViewModel = hiltViewModel(),
  addingToCart: Boolean = false,
  cartLoading: Boolean = false,
  cartMessage: String? = null,
  cartError: String? = null,
  cartNeedsRefresh: Boolean = false,
  onRefreshCart: () -> Unit = {},
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val favorites by viewModel.favoriteState.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }
  val productId = state.detail?.id

  // A favourite that did not save is reported, never swallowed.
  LaunchedEffect(state.actionMessage) {
    val message = state.actionMessage
    if (message != null) {
      snackbarHostState.showSnackbar(message)
      viewModel.consumeActionMessage()
    }
  }

  Scaffold(
    snackbarHost = { SnackbarHost(snackbarHostState) },
    modifier = modifier,
  ) { padding ->
    ProductDetailContent(
      state = state,
      onRetry = viewModel::load,
      onSelectPack = viewModel::selectPack,
      onBack = onBack,
      onAddToCart = onAddToCart,
      canAddToCart = canAddToCart,
      addingToCart = addingToCart,
      cartLoading = cartLoading,
      cartMessage = cartMessage,
      cartError = cartError,
      cartNeedsRefresh = cartNeedsRefresh,
      onRefreshCart = onRefreshCart,
      // Favourite state comes from the shared store, keyed on the PRODUCT id
      // the server returned — never on the route argument, which may be a pack.
      isFavorite = productId?.let { id ->
        favorites.isFavorite(id, state.detail?.isFavorite == true)
      } ?: false,
      favoritePending = productId?.let(favorites::isPending) == true,
      onToggleFavorite = viewModel::toggleFavorite,
      modifier = Modifier.padding(padding),
    )
  }
}

@Composable
fun ProductDetailContent(
  state: ProductDetailUiState,
  onRetry: () -> Unit,
  onSelectPack: (String) -> Unit,
  onBack: () -> Unit,
  onAddToCart: (packId: String, quantity: Int) -> Unit,
  canAddToCart: Boolean,
  modifier: Modifier = Modifier,
  addingToCart: Boolean = false,
  cartLoading: Boolean = false,
  cartMessage: String? = null,
  cartError: String? = null,
  cartNeedsRefresh: Boolean = false,
  onRefreshCart: () -> Unit = {},
  isFavorite: Boolean = false,
  favoritePending: Boolean = false,
  /** Null hides the favourite control (for surfaces that cannot save). */
  onToggleFavorite: (() -> Unit)? = null,
) {
  when {
    state.loading && state.detail == null -> LoadingState(message = "Loading product…")

    state.notFound -> EmptyState(
      title = "Product not available",
      message = state.errorMessage ?: "This product is no longer available in the catalogue.",
      actionLabel = "Back to catalogue",
      onAction = onBack,
      modifier = modifier.testTag(ProductDetailTags.NOT_FOUND),
    )

    state.detail == null && state.errorMessage != null -> if (state.offline) {
      OfflineState(onRetry = onRetry)
    } else {
      ErrorState(message = state.errorMessage.orEmpty(), retryable = state.retryable, onRetry = onRetry)
    }

    state.detail == null -> LoadingState(message = "Loading product…")

    else -> {
      val detail = state.detail
      if (detail != null) {
        Column(modifier = modifier.fillMaxSize()) {
          Column(
            modifier = Modifier
              .weight(1f)
              .verticalScroll(rememberScrollState()),
          ) {
            Box(modifier = Modifier.fillMaxWidth()) {
              ProductGallery(images = state.gallery, productName = detail.name)

              if (onToggleFavorite != null) {
                FavoriteButton(
                  isFavorite = isFavorite,
                  pending = favoritePending,
                  onToggle = onToggleFavorite,
                  modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(MaharaniDimens.spaceMd)
                    .testTag(ProductDetailTags.FAVORITE_TOGGLE),
                )
              }
            }

            Column(
              modifier = Modifier.padding(MaharaniDimens.pageGutter),
              verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
            ) {
              if (state.errorMessage != null) {
                InlineRetryNote(message = state.errorMessage.orEmpty(), onRetry = onRetry)
              }

              ProductTitleBlock(detail = detail)

              state.selectedPack?.let { pack ->
                PackPricingPanel(pack = pack)
              }

              if (detail.packs.isNotEmpty()) {
                PackSelector(
                  packs = detail.packs,
                  selectedPackId = state.selectedPack?.packId,
                  onSelect = onSelectPack,
                )
              } else {
                Text(
                  text = "No pack is currently available for this product.",
                  style = MaterialTheme.typography.bodyMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }

              state.selectedPack?.let { pack ->
                if (pack.tiers.size > 1) TierTable(pack = pack)
              }

              HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

              ProductFacts(detail = detail)

              OrderingNote(canAddToCart = canAddToCart)
              cartMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
              }
              cartError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
              }
            }
          }

          state.selectedPack?.let { pack ->
            DetailBottomBar(
              pack = pack,
              canAddToCart = canAddToCart,
              addingToCart = addingToCart,
              cartLoading = cartLoading,
              cartNeedsRefresh = cartNeedsRefresh,
              onRefreshCart = onRefreshCart,
              onAddToCart = { onAddToCart(pack.packId, pack.moq) },
            )
          }
        }
      }
    }
  }
}

@Composable
private fun ProductGallery(
  images: List<String>,
  productName: String,
  modifier: Modifier = Modifier,
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    modifier = modifier.fillMaxWidth(),
  ) {
    Box(modifier = Modifier.fillMaxWidth().testTag(ProductDetailTags.GALLERY)) {
      if (images.isEmpty()) {
        ProductImage(
          url = null,
          fallbackLabel = productName,
          modifier = Modifier
            .fillMaxWidth()
            .height(MaharaniDimens.heroImageHeight),
        )
      } else {
        val pagerState = rememberPagerState(pageCount = { images.size })
        HorizontalPager(
          state = pagerState,
          modifier = Modifier.fillMaxWidth(),
        ) { page ->
          ProductImage(
            url = images[page],
            fallbackLabel = productName,
            contentScale = ContentScale.Fit,
            modifier = Modifier
              .fillMaxWidth()
              .height(MaharaniDimens.heroImageHeight),
          )
        }

        Surface(
          color = MaterialTheme.colorScheme.scrim,
          contentColor = MaterialTheme.colorScheme.onPrimary,
          shape = RoundedCornerShape(MaharaniDimens.radiusPill),
          modifier = Modifier
            .align(Alignment.TopEnd)
            .padding(MaharaniDimens.spaceMd),
        ) {
          Text(
            text = "${pagerState.currentPage + 1}/${images.size}",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
          )
        }

        PagerDots(
          pageCount = images.size,
          currentPage = pagerState.currentPage,
          modifier = Modifier
            .align(Alignment.BottomCenter)
            .padding(bottom = MaharaniDimens.spaceMd),
        )
      }
    }
  }
}

@Composable
private fun ProductTitleBlock(detail: ProductDetail, modifier: Modifier = Modifier) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
    if (detail.isNewLaunch || detail.hasOffer) {
      Row(horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
        if (detail.isNewLaunch) NewLaunchBadge()
        if (detail.hasOffer) OfferBadge()
      }
    }

    detail.brandName?.let { brand ->
      Text(
        text = brand,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }

    Text(
      text = detail.name,
      style = MaterialTheme.typography.headlineSmall,
      color = MaterialTheme.colorScheme.onBackground,
      modifier = Modifier.testTag(ProductDetailTags.TITLE),
    )

    val scope = listOfNotNull(detail.categoryName, detail.unit.takeIf { it.isNotBlank() })
      .joinToString(" · ")
    if (scope.isNotEmpty()) {
      MetaLabel(text = scope)
    }
  }
}

/** Price, stock, MOQ, case size, GST and the server's line total at the MOQ. */
@Composable
private fun PackPricingPanel(pack: ProductPackDetail, modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceLg),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        PriceBlock(
          unitPricePaise = pack.unitPricePaise,
          mrpPaise = pack.mrpPaise,
          emphasis = PriceEmphasis.Detail,
          caption = "GST inclusive · ${formatPercent(pack.gstPercent)} GST",
          modifier = Modifier
            .weight(1f, fill = false)
            .testTag(ProductDetailTags.PRICE),
        )
        StockBadge(
          availability = pack.availability,
          modifier = Modifier.testTag(ProductDetailTags.AVAILABILITY),
        )
      }

      // The line total at the MOQ is server-computed. The app never multiplies
      // a price by a quantity itself.
      pack.lineTotalAtMoqPaise?.let { total ->
        Text(
          text = "Min order total ${MoneyFormat.formatPaise(total)}",
          style = MaterialTheme.typography.titleSmall,
          color = tokens.onActionContainer,
          modifier = Modifier.testTag(ProductDetailTags.LINE_TOTAL),
        )
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        // Weighted: three facts must fit a narrow phone without wrapping the
        // panel or clipping a number mid-digit.
        FactChip(
          text = "Min order ${pack.moq} pcs",
          modifier = Modifier
            .weight(1f, fill = false)
            .testTag(ProductDetailTags.MOQ),
        )
        FactChip(
          text = "${pack.unitsPerCase} pcs/case",
          modifier = Modifier
            .weight(1f, fill = false)
            .testTag(ProductDetailTags.CASE_SIZE),
        )
        pack.derivedCasePricePaise?.let { casePrice ->
          FactChip(
            text = "${MoneyFormat.formatPaiseShort(casePrice)}/case",
            accent = true,
            modifier = Modifier.weight(1f, fill = false),
          )
        }
      }

      pack.message?.let { message ->
        // The pricing engine's own explanation (below MOQ, no price configured).
        // It is shown verbatim rather than paraphrased, so the app cannot soften
        // a refusal into something that reads like an offer.
        Text(
          text = message,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
        )
      }
    }
  }
}

/**
 * Variant selector.
 *
 * Only packs the server returned and priced can be selected; the ViewModel
 * ignores an id it does not recognise, so the screen cannot show a price for a
 * pack that was never quoted.
 */
@Composable
private fun PackSelector(
  packs: List<ProductPackDetail>,
  selectedPackId: String?,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
    SectionHeader(title = "Pack size")
    LazyRow(
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      modifier = Modifier.testTag(ProductDetailTags.PACK_SELECTOR),
    ) {
      items(packs, key = { it.packId }) { pack ->
        val selected = pack.packId == selectedPackId
        Surface(
          modifier = Modifier
            .clip(RoundedCornerShape(MaharaniDimens.radiusTile))
            .clickable(onClick = { onSelect(pack.packId) }),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
          } else {
            MaterialTheme.colorScheme.surface
          },
          border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = if (selected) {
              MaterialTheme.colorScheme.primary
            } else {
              MaterialTheme.colorScheme.outlineVariant
            },
          ),
          shadowElevation = if (selected) 0.dp else MaharaniDimens.cardElevation,
        ) {
          Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
          ) {
            Text(
              text = pack.packName,
              style = MaterialTheme.typography.titleSmall,
              color = if (selected) {
                MaterialTheme.colorScheme.onPrimaryContainer
              } else {
                MaterialTheme.colorScheme.onSurface
              },
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
            Text(
              text = pack.unitPricePaise?.let { "${MoneyFormat.formatPaiseShort(it)}/pc" }
                ?: "Price unavailable",
              style = MaterialTheme.typography.labelSmall,
              color = if (selected) {
                MaterialTheme.colorScheme.onPrimaryContainer
              } else {
                MaterialTheme.colorScheme.onSurfaceVariant
              },
              maxLines = 1,
            )
          }
        }
      }
    }
  }
}

/** The server's slab table, so "buy more, pay less" is a real published rate. */
@Composable
private fun TierTable(pack: ProductPackDetail, modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier
      .fillMaxWidth()
      .testTag(ProductDetailTags.TIER_TABLE),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      Text(
        text = "Slab rates (per piece)",
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurface,
      )
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          text = "Quantity",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
          text = "Price / pc",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      pack.tiers.forEachIndexed { index, tier ->
        val upper = tier.maxQuantity
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(MaharaniDimens.radiusChip))
            .then(
              if (index == 0) Modifier.background(tokens.saffronSurface) else Modifier,
            )
            .padding(horizontal = MaharaniDimens.spaceSm, vertical = MaharaniDimens.spaceXs),
          horizontalArrangement = Arrangement.SpaceBetween,
        ) {
          Text(
            text = if (upper == null) "${tier.minQuantity}+ pcs" else "${tier.minQuantity}–$upper pcs",
            style = MaterialTheme.typography.labelMedium,
            color = if (index == 0) tokens.onSaffronSurface else MaterialTheme.colorScheme.onSurface,
          )
          Text(
            text = "${MoneyFormat.formatPaise(tier.unitPricePaise)}/pc",
            style = MaterialTheme.typography.labelMedium,
            color = if (index == 0) tokens.onSaffronSurface else MaterialTheme.colorScheme.onSurface,
          )
        }
      }
      Text(
        text = "Published slab rates for your shop; the price above is the rate at the " +
          "minimum order quantity.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/** Server facts about the product, rendered as label/value rows. */
@Composable
private fun ProductFacts(detail: ProductDetail, modifier: Modifier = Modifier) {
  val facts = buildList {
    detail.hsnCode?.let { add("HSN code" to it) }
    add("Unit" to detail.unit)
    add("GST" to formatPercent(detail.gstPercent))
    add("Lead time" to "${detail.leadTimeDays} day(s)")
    detail.categoryName?.let { add("Category" to it) }
    detail.brandName?.let { add("Brand" to it) }
  }

  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
    SectionHeader(title = "Product details")
    facts.forEach { (label, value) ->
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          text = label,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.widthIn(max = 120.dp),
        )
        Text(
          text = value,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
  }
}

/** Explains the server-owned ordering rules without advertising checkout to other roles. */
@Composable
private fun OrderingNote(canAddToCart: Boolean, modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = tokens.saffronSurface,
    contentColor = tokens.onSaffronSurface,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier.fillMaxWidth(),
  ) {
    Text(
      text = if (canAddToCart) {
        "Add the pack at its minimum piece quantity. The shared cart and checkout use " +
          "current server pricing; stock, GST, eligibility and MOQ are rechecked before an order is saved."
      } else {
        "Current prices and stock are shown for browsing; checkout is subject to server verification."
      },
      style = MaterialTheme.typography.labelMedium,
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
    )
  }
}

/** Sticky server price and MOQ-based add action; no money is sent by this button. */
@Composable
private fun DetailBottomBar(
  pack: ProductPackDetail,
  canAddToCart: Boolean,
  addingToCart: Boolean,
  cartLoading: Boolean,
  cartNeedsRefresh: Boolean,
  onRefreshCart: () -> Unit,
  onAddToCart: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shadowElevation = MaharaniDimens.appBarElevation,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(
        horizontal = MaharaniDimens.pageGutter,
        vertical = MaharaniDimens.spaceMd,
      ),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        PriceBlock(
          unitPricePaise = pack.unitPricePaise,
          emphasis = PriceEmphasis.Card,
          caption = "Min order ${pack.moq} pcs · ${pack.packName}",
        )
        StockBadge(availability = pack.availability, compact = true)
      }
      if (cartNeedsRefresh) {
        OutlinedButton(
          onClick = onRefreshCart,
          enabled = !addingToCart && !cartLoading,
          modifier = Modifier.fillMaxWidth(),
        ) { Text("Refresh shared cart") }
      }
      if (canAddToCart) {
        Button(
          onClick = onAddToCart,
          enabled = !addingToCart && !cartLoading && !cartNeedsRefresh && pack.moq > 0 && pack.unitPricePaise != null &&
            pack.availability == PackAvailability.IN_STOCK,
          modifier = Modifier.fillMaxWidth().testTag(ProductDetailTags.ADD_TO_CART),
        ) {
          if (addingToCart || cartLoading) CircularProgressIndicator(strokeWidth = 2.dp)
          else Text("Add ${pack.moq} pieces to cart")
        }
      } else {
        Text(
          "Ordering is unavailable for this account.",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (pack.availability != PackAvailability.IN_STOCK) {
        Text(
          text = if (pack.availability == PackAvailability.OUT_OF_STOCK) {
            "This pack is currently out of stock."
          } else {
            "Availability is unconfirmed; refresh before adding to cart."
          },
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

@Composable
private fun InlineRetryNote(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
  Surface(
    color = MaterialTheme.colorScheme.errorContainer,
    contentColor = MaterialTheme.colorScheme.onErrorContainer,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier.fillMaxWidth(),
  ) {
    Row(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        text = message,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.weight(1f),
      )
      TextButton(onClick = onRetry) { Text("Retry") }
    }
  }
}

/** `5.0` → `5%`, `12.5` → `12.5%` — display formatting of a server percentage. */
private fun formatPercent(value: Double): String {
  val rounded = Math.round(value * 100.0) / 100.0
  return if (rounded == Math.floor(rounded)) {
    "${rounded.toInt()}%"
  } else {
    "$rounded%"
  }
}
