package com.maharanitraders.feature.catalog.ui

// `clickable` is an extension on Modifier, so it is not in scope from
// `androidx.compose.ui.Modifier` alone.
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.model.ProductDetail
import com.maharanitraders.core.model.ProductPackDetail
import com.maharanitraders.feature.catalog.ProductDetailUiState
import com.maharanitraders.feature.catalog.ProductDetailViewModel

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
  const val NOT_FOUND = "product_not_found"
}

/**
 * The product detail screen.
 *
 * This screen shows money, and none of it is computed here: the per-piece rate,
 * the GST-inclusive line total at the MOQ and the slab table all arrive from the
 * same pricing engine checkout uses, so what the shopper reads is what an order
 * would be charged.
 *
 * There is deliberately no "Add to cart" button. Cart and checkout are a later
 * phase; a control that looks like it works but cannot place an order would be a
 * lie, and the migration contract forbids it.
 */
@Composable
fun ProductDetailScreen(
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: ProductDetailViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  ProductDetailContent(
    state = state,
    onRetry = viewModel::load,
    onSelectPack = viewModel::selectPack,
    onBack = onBack,
    modifier = modifier,
  )
}

@Composable
fun ProductDetailContent(
  state: ProductDetailUiState,
  onRetry: () -> Unit,
  onSelectPack: (String) -> Unit,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
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

    else -> ProductDetailBody(
      detail = state.detail!!,
      selectedPack = state.selectedPack,
      gallery = state.gallery,
      refreshing = state.refreshing,
      errorMessage = state.errorMessage,
      onSelectPack = onSelectPack,
      onRetry = onRetry,
      modifier = modifier,
    )
  }
}

@Composable
private fun ProductDetailBody(
  detail: ProductDetail,
  selectedPack: ProductPackDetail?,
  gallery: List<String>,
  refreshing: Boolean,
  errorMessage: String?,
  onSelectPack: (String) -> Unit,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState()),
  ) {
    ProductGallery(images = gallery, productName = detail.name)

    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (refreshing) {
        Text(
          text = "Refreshing…",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (errorMessage != null) {
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(12.dp),
          modifier = Modifier.fillMaxWidth(),
        ) {
          Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(text = errorMessage, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            TextButton(onClick = onRetry) { Text("Retry") }
          }
        }
      }

      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (detail.isNewLaunch) NewLaunchBadge()
        if (detail.hasOffer) OfferBadge()
      }

      detail.brandName?.let { brand ->
        Text(
          text = brand,
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }

      Text(
        text = detail.name,
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier.testTag(ProductDetailTags.TITLE),
      )

      detail.categoryName?.let { category ->
        MetaLabel(text = "Category: $category")
      }

      HorizontalDivider()

      if (detail.packs.isEmpty()) {
        Text(
          text = "No pack is currently available for this product.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        PackSelector(
          packs = detail.packs,
          selectedPackId = selectedPack?.packId,
          onSelect = onSelectPack,
        )

        selectedPack?.let { pack -> PackPricingPanel(pack = pack) }
      }

      HorizontalDivider()

      ProductFacts(detail = detail)
    }
  }
}

@Composable
private fun ProductGallery(images: List<String>, productName: String, modifier: Modifier = Modifier) {
  Box(
    modifier = modifier
      .fillMaxWidth()
      .testTag(ProductDetailTags.GALLERY),
  ) {
    if (images.isEmpty()) {
      ProductImage(
        url = null,
        fallbackLabel = productName,
        modifier = Modifier
          .fillMaxWidth()
          .height(280.dp),
      )
    } else {
      val pagerState = androidx.compose.foundation.pager.rememberPagerState(pageCount = { images.size })
      androidx.compose.foundation.pager.HorizontalPager(
        state = pagerState,
        modifier = Modifier.fillMaxWidth(),
      ) { page ->
        ProductImage(
          url = images[page],
          fallbackLabel = productName,
          contentScale = ContentScale.Fit,
          modifier = Modifier
            .fillMaxWidth()
            .height(280.dp),
        )
      }
      PagerDots(
        pageCount = images.size,
        currentPage = pagerState.currentPage,
        modifier = Modifier
          .align(Alignment.BottomCenter)
          .padding(bottom = 12.dp),
      )
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
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(text = "Pack size", style = MaterialTheme.typography.titleSmall)
    LazyRow(
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      modifier = Modifier.testTag(ProductDetailTags.PACK_SELECTOR),
    ) {
      items(packs, key = { it.packId }) { pack ->
        val selected = pack.packId == selectedPackId
        Surface(
          modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = { onSelect(pack.packId) }),
          shape = RoundedCornerShape(12.dp),
          color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
          border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
          ),
        ) {
          Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
          ) {
            Text(text = pack.packName, style = MaterialTheme.typography.titleSmall)
            Text(
              text = pack.unitPricePaise?.let { "${MoneyFormat.formatPaise(it)}/pc" } ?: "Price unavailable",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
    }
  }
}

/** Price, MOQ, case size, GST and the slab table for the selected pack. */
@Composable
private fun PackPricingPanel(pack: ProductPackDetail, modifier: Modifier = Modifier) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween,
    ) {
      Column {
        PriceText(
          unitPricePaise = pack.unitPricePaise,
          style = MaterialTheme.typography.headlineSmall,
          modifier = Modifier.testTag(ProductDetailTags.PRICE),
        )
        Text(
          text = "GST inclusive · ${formatPercent(pack.gstPercent)} GST",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      AvailabilityChip(
        availability = pack.availability,
        modifier = Modifier.testTag(ProductDetailTags.AVAILABILITY),
      )
    }

    MrpText(mrpPaise = pack.mrpPaise)

    // The line total at the MOQ is server-computed. The app never multiplies a
    // price by a quantity itself.
    pack.lineTotalAtMoqPaise?.let { total ->
      Text(
        text = "Min order total ${MoneyFormat.formatPaise(total)}",
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.testTag(ProductDetailTags.LINE_TOTAL),
      )
    }

    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
      Column {
        Text(text = "Minimum order", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
          text = "${pack.moq} pcs",
          style = MaterialTheme.typography.titleSmall,
          modifier = Modifier.testTag(ProductDetailTags.MOQ),
        )
      }
      Column {
        Text(text = "Units per case", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
          text = "${pack.unitsPerCase}",
          style = MaterialTheme.typography.titleSmall,
          modifier = Modifier.testTag(ProductDetailTags.CASE_SIZE),
        )
      }
    }

    if (!pack.allowLoosePieces) {
      Text(
        text = "Sold in whole cases only.",
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
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

    if (pack.tiers.size > 1) {
      TierTable(pack = pack)
    }
  }
}

/** The server's slab table, so "buy more, pay less" is a real published rate. */
@Composable
private fun TierTable(pack: ProductPackDetail, modifier: Modifier = Modifier) {
  Surface(
    color = MaterialTheme.colorScheme.surfaceVariant,
    shape = RoundedCornerShape(12.dp),
    modifier = modifier
      .fillMaxWidth()
      .testTag(ProductDetailTags.TIER_TABLE),
  ) {
    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(text = "Quantity slabs", style = MaterialTheme.typography.titleSmall)
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Quantity", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Per piece", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      pack.tiers.forEach { tier ->
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(
            text = tier.maxQuantity?.let { "${tier.minQuantity}–${it - 1} pcs" } ?: "${tier.minQuantity}+ pcs",
            style = MaterialTheme.typography.bodySmall,
          )
          Text(
            text = MoneyFormat.formatPaise(tier.unitPricePaise),
            style = MaterialTheme.typography.bodySmall,
          )
        }
      }
    }
  }
}

@Composable
private fun ProductFacts(detail: ProductDetail, modifier: Modifier = Modifier) {
  Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(text = "Product information", style = MaterialTheme.typography.titleSmall)
    detail.hsnCode?.let { FactRow(label = "HSN code", value = it) }
    FactRow(label = "Selling unit", value = detail.unit.ifBlank { "Not specified" })
    FactRow(label = "GST", value = formatPercent(detail.gstPercent))
    if (detail.leadTimeDays > 0) {
      FactRow(label = "Lead time", value = "${detail.leadTimeDays} days")
    }
    FactRow(
      label = "Availability",
      value = detail.selectedPack?.availability?.label() ?: "Not confirmed",
    )
  }
}

@Composable
private fun FactRow(label: String, value: String, modifier: Modifier = Modifier) {
  Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(
      text = label,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    Text(text = value, style = MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun OfferBadge(modifier: Modifier = Modifier) {
  Surface(
    color = MaterialTheme.colorScheme.secondaryContainer,
    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    shape = RoundedCornerShape(6.dp),
    modifier = modifier,
  ) {
    Text(
      text = "Offer",
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
    )
  }
}

/** `5` -> `5%`, `12.5` -> `12.5%`; a whole number never shows a trailing `.0`. */
private fun formatPercent(value: Double): String =
  if (value % 1.0 == 0.0) "${value.toLong()}%" else "${value}%"
