package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.MaharaniSearchBar
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.orders.BulkMatchLine
import com.maharanitraders.feature.orders.BulkMatchPack
import com.maharanitraders.feature.orders.QuickOrderPack
import com.maharanitraders.feature.orders.QuickOrderProduct
import com.maharanitraders.feature.orders.QuickOrderViewModel
import com.maharanitraders.feature.orders.QuickOrderUiState

object QuickOrderTags {
  const val SCREEN = "quick_order_screen"
  const val RESULT = "quick_order_result"
  const val ADD = "quick_order_add"
  const val QUANTITY = "quick_order_quantity"
  const val BULK_RAW = "quick_order_bulk_raw"
  const val BULK_MATCH = "quick_order_bulk_match"
  const val BULK_ADD = "quick_order_bulk_add"
  const val BULK_LINE = "quick_order_bulk_line"
  const val BULK_LINE_ERROR = "quick_order_bulk_line_error"
  const val BULK_REMOVE = "quick_order_bulk_remove"
}

/**
 * Quick order: restock known items without leaving one screen.
 *
 * The whole page is server-priced: the search hits the quick-order endpoint
 * (name search, active products and packs, retailer price at MOQ) and each Add
 * goes through the real cart endpoint, which revalidates MOQ, piece steps and
 * availability. The pasted-list panel mirrors the web bulk panel: parse and
 * match server-side, then add the confirmed lines.
 */
@Composable
fun QuickOrderScreen(
  modifier: Modifier = Modifier,
  viewModel: QuickOrderViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }

  LaunchedEffect(state.message) {
    val message = state.message ?: return@LaunchedEffect
    snackbarHostState.showSnackbar(message)
    viewModel.consumeMessage()
  }

  Column(modifier = modifier.fillMaxSize().testTag(QuickOrderTags.SCREEN)) {
    LazyColumn(
      contentPadding = PaddingValues(MaharaniDimens.pageGutter),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      modifier = Modifier.weight(1f),
    ) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
          Text("Quick order", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
          Text(
            "Search by name, pick a pack and add quantities without leaving this screen.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      item {
        MaharaniSearchBar(
          value = state.term,
          onValueChange = viewModel::onTermChange,
          onSubmit = viewModel::search,
          placeholder = "Try “rice”, “oil” or a brand name",
          loading = state.searching,
          testTag = QuickOrderTags.QUANTITY,
        )
      }

      when {
        state.searching && state.products.isEmpty() -> item { LoadingState("Searching products…") }

        state.searchError != null -> item {
          if (state.offline) {
            OfflineState(onRetry = viewModel::search)
          } else {
            ErrorState(state.searchError.orEmpty(), retryable = true, onRetry = viewModel::search)
          }
        }

        state.noResults -> item {
          EmptyState(
            title = "No products found",
            message = "Check the spelling, try a shorter term, or browse the catalogue.",
          )
        }

        !state.searched -> item {
          Text(
            "Results include only active products and packs, priced for your shop with GST and MOQ shown before you add.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }

        else -> items(state.products, key = { it.id }) { product ->
          QuickOrderProductCard(
            product = product,
            quantities = state.quantities,
            adding = state.adding,
            onQuantityChange = viewModel::onQuantityChange,
            onAdd = viewModel::addToCart,
          )
        }
      }

      item {
        BulkOrderPanel(
          state = state,
          onRawChange = viewModel::onBulkRawChange,
          onMatch = viewModel::matchBulkLines,
          onSelectPack = viewModel::onBulkPackSelect,
          onQuantityChange = viewModel::onBulkChoiceChange,
          onToggleLine = viewModel::toggleBulkLine,
          onAdd = viewModel::addBulkMatches,
          onClear = viewModel::clearBulk,
        )
      }
    }
    SnackbarHost(hostState = snackbarHostState)
  }
}

@Composable
private fun QuickOrderProductCard(
  product: QuickOrderProduct,
  quantities: Map<String, Int>,
  adding: Set<String>,
  onQuantityChange: (QuickOrderPack, String) -> Unit,
  onAdd: (QuickOrderPack) -> Unit,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    tonalElevation = 1.dp,
    modifier = Modifier.fillMaxWidth().testTag(QuickOrderTags.RESULT),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      Text(product.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      product.brandName?.let { brand ->
        Text(brand, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      product.packs.forEach { pack ->
        QuickOrderPackRow(
          pack = pack,
          quantity = quantities[pack.packId] ?: pack.moq,
          adding = pack.packId in adding,
          onQuantityChange = { raw -> onQuantityChange(pack, raw) },
          onAdd = { onAdd(pack) },
        )
        HorizontalDivider()
      }
    }
  }
}

@Composable
private fun QuickOrderPackRow(
  pack: QuickOrderPack,
  quantity: Int,
  adding: Boolean,
  onQuantityChange: (String) -> Unit,
  onAdd: () -> Unit,
) {
  Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(pack.packName, style = MaterialTheme.typography.bodyMedium)
        Text(
          buildString {
            append("MOQ ${pack.moq}")
            if (!pack.allowLoosePieces) append(" · whole cases only")
            append(" · ${pack.unitsPerCase} pcs/case")
          },
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      StockBadge(availability = PackAvailability.fromWire(pack.availability), compact = true)
    }

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      val price = pack.unitPricePaise
      Text(
        text = if (price != null) "${MoneyFormat.formatPaise(price)} / pc" else "Not orderable",
        style = MaterialTheme.typography.bodyMedium,
        color = if (price != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
        modifier = Modifier.weight(1f),
      )
      OutlinedTextField(
        value = quantity.toString(),
        onValueChange = onQuantityChange,
        label = { Text("Qty") },
        singleLine = true,
        modifier = Modifier.width(96.dp).testTag(QuickOrderTags.QUANTITY),
      )
      Button(
        onClick = onAdd,
        enabled = !adding && pack.isPriced,
        modifier = Modifier.testTag(QuickOrderTags.ADD),
        shape = RoundedCornerShape(MaharaniDimens.radiusTile),
      ) {
        if (adding) {
          CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        } else {
          Text("Add")
        }
      }
    }
  }
}

@Composable
private fun BulkOrderPanel(
  state: QuickOrderUiState,
  onRawChange: (String) -> Unit,
  onMatch: () -> Unit,
  onSelectPack: (Int, BulkMatchPack) -> Unit,
  onQuantityChange: (Int, BulkMatchPack, String) -> Unit,
  onToggleLine: (Int) -> Unit,
  onAdd: () -> Unit,
  onClear: () -> Unit,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surfaceVariant,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Text("Paste a list", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      Text(
        "One product a line — `2 x parle-g 50g`, `rice 5kg x 3`, or just the name. The server matches real packs and prices.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      OutlinedTextField(
        value = state.bulkRaw,
        onValueChange = onRawChange,
        label = { Text("Order lines") },
        minLines = 3,
        maxLines = 6,
        modifier = Modifier.fillMaxWidth().height(120.dp).testTag(QuickOrderTags.BULK_RAW),
      )
      Row(horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
        Button(
          onClick = onMatch,
          enabled = !state.bulkMatching,
          modifier = Modifier.testTag(QuickOrderTags.BULK_MATCH),
        ) {
          if (state.bulkMatching) {
            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
          } else {
            Text("Match lines")
          }
        }
        if (state.bulkMatches.isNotEmpty()) {
          TextButton(onClick = onClear) { Text("Clear") }
        }
      }

      state.bulkError?.let { error ->
        Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
      }

      state.bulkMatches.forEachIndexed { index, line ->
        BulkMatchCard(
          index = index,
          line = line,
          chosenPackId = state.bulkChoices[index]?.packId,
          quantity = state.bulkChoices[index]?.quantity,
          error = state.lineErrors[index],
          excluded = index in state.bulkExcluded,
          onSelectPack = { pack -> onSelectPack(index, pack) },
          onQuantityChange = { pack, raw -> onQuantityChange(index, pack, raw) },
          onToggleLine = { onToggleLine(index) },
        )
      }

      if (state.bulkMatches.isNotEmpty()) {
        Button(
          onClick = onAdd,
          enabled = !state.bulkAdding && state.bulkChoices.isNotEmpty(),
          modifier = Modifier.fillMaxWidth().testTag(QuickOrderTags.BULK_ADD),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) {
          if (state.bulkAdding) {
            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
          } else {
            Text("Add matched lines to cart")
          }
        }
      }
    }
  }
}

@Composable
private fun BulkMatchCard(
  index: Int,
  line: BulkMatchLine,
  chosenPackId: String?,
  quantity: Int?,
  /** The server's refusal for THIS line, shown next to it. */
  error: String? = null,
  /** Taken out of the run by the shopper. */
  excluded: Boolean = false,
  onSelectPack: (BulkMatchPack) -> Unit,
  onQuantityChange: (BulkMatchPack, String) -> Unit,
  onToggleLine: () -> Unit = {},
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    modifier = Modifier.fillMaxWidth().testTag(QuickOrderTags.BULK_LINE),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceSm),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          text = line.line,
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.weight(1f),
          maxLines = 2,
          overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
        if (line.matched) {
          TextButton(
            onClick = onToggleLine,
            modifier = Modifier
              .heightIn(min = 40.dp)
              .testTag("${QuickOrderTags.BULK_REMOVE}_$index"),
          ) {
            Text(
              if (excluded) "Include" else "Remove",
              style = MaterialTheme.typography.labelSmall,
              color = if (excluded) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            )
          }
        }
      }
      if (excluded) {
        Text(
          "Left out of this run.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return@Column
      }
      // The server's own reason for THIS line, in its own words.
      error?.let { reason ->
        Text(
          reason,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
          modifier = Modifier.testTag("${QuickOrderTags.BULK_LINE_ERROR}_$index"),
        )
      }
      if (!line.matched) {
        Text(
          line.error ?: "No orderable pack found.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
        )
        return@Column
      }
      Text(line.productName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
      line.matches.forEach { pack ->
        val selected = pack.packId == chosenPackId
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          OutlinedButton(
            onClick = { onSelectPack(pack) },
            shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          ) {
            Text(if (selected) "✓ ${pack.packName}" else pack.packName)
          }
          Text(
            pack.unitPricePaise?.let { "${MoneyFormat.formatPaise(it)} / pc" } ?: "Not orderable",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.weight(1f),
          )
          if (selected) {
            OutlinedTextField(
              value = (quantity ?: pack.moq).toString(),
              onValueChange = { raw -> onQuantityChange(pack, raw) },
              label = { Text("Qty") },
              singleLine = true,
              modifier = Modifier.width(92.dp),
            )
          }
        }
      }
    }
  }
}
