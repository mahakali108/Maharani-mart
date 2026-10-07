package com.maharanitraders.feature.orders.ui

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.feature.orders.BuyAgainItem
import com.maharanitraders.feature.orders.BuyAgainStatus
import com.maharanitraders.feature.orders.BuyAgainUiState
import com.maharanitraders.feature.orders.BuyAgainViewModel

/** Test tags for the Buy again surface. */
object BuyAgainTags {
  const val SCREEN = "buy_again_screen"
  const val ITEM = "buy_again_item"
  const val SELECT_ALL = "buy_again_select_all"
  const val CLEAR = "buy_again_clear"
  const val QUANTITY = "buy_again_quantity"
  const val ADD = "buy_again_add"
  const val RESULT = "buy_again_result"
  const val UNAVAILABLE = "buy_again_unavailable"
}

/**
 * Buy again — the shop's own repeat purchases, at TODAY's prices.
 *
 * Every row is a real pack from this retailer's order history, revalidated
 * against the current catalogue before it can be selected: the price, minimum
 * and stock on a row are the server's answers from a moment ago, never the
 * figures the old order was placed at. A row that can no longer be ordered is
 * listed below with the reason, and is never quietly replaced by a different
 * pack.
 */
@Composable
fun BuyAgainScreen(
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: BuyAgainViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }

  LaunchedEffect(state.resultMessage) {
    val message = state.resultMessage
    if (message != null) {
      snackbarHostState.showSnackbar(message)
      viewModel.consumeResult()
    }
  }

  Column(modifier = modifier.fillMaxSize()) {
    when {
      state.loading -> LoadingState("Reading what your shop buys most…")

      state.error != null && state.items.isEmpty() -> if (state.offline) {
        OfflineState(onRetry = viewModel::load)
      } else {
        ErrorState(
          message = state.error.orEmpty(),
          retryable = true,
          onRetry = viewModel::load,
        )
      }

      state.items.isEmpty() -> EmptyState(
        title = "Nothing to buy again yet",
        message = "Once the server confirms an order, the products in it appear here — " +
          "revalidated at today's price, stock and minimum.",
        actionLabel = "Browse the catalogue",
        onAction = onBrowseCatalog,
      )

      else -> BuyAgainContent(
        state = state,
        onToggle = viewModel::toggleSelection,
        onSelectAll = viewModel::selectAllAvailable,
        onClear = viewModel::clearSelection,
        onQuantityChange = viewModel::onQuantityChange,
        onAdd = viewModel::addSelected,
        modifier = Modifier.weight(1f),
      )
    }
    SnackbarHost(hostState = snackbarHostState)
  }
}

@Composable
private fun BuyAgainContent(
  state: BuyAgainUiState,
  onToggle: (String) -> Unit,
  onSelectAll: () -> Unit,
  onClear: () -> Unit,
  onQuantityChange: (String, String) -> Unit,
  onAdd: () -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyColumn(
    modifier = modifier
      .fillMaxSize()
      .testTag(BuyAgainTags.SCREEN),
    contentPadding = PaddingValues(
      horizontal = MaharaniDimens.pageGutter,
      vertical = MaharaniDimens.spaceMd,
    ),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
        Text(
          "Buy again",
          style = MaterialTheme.typography.headlineSmall,
          fontWeight = FontWeight.SemiBold,
        )
        Text(
          "What your shop orders most, checked against live stock and today's prices before you add it.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    item {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          text = "${state.selectedCount} of ${state.availableItems.size} available selected",
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.weight(1f),
        )
        TextButton(
          onClick = onSelectAll,
          modifier = Modifier
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(BuyAgainTags.SELECT_ALL),
        ) { Text("Select all") }
        TextButton(
          onClick = onClear,
          enabled = state.selected.isNotEmpty(),
          modifier = Modifier
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(BuyAgainTags.CLEAR),
        ) { Text("Clear") }
      }
    }

    items(state.availableItems, key = { it.packId }) { item ->
      BuyAgainRow(
        item = item,
        selected = item.packId in state.selected,
        quantity = state.quantities[item.packId] ?: item.suggestedQuantity(),
        onToggle = { onToggle(item.packId) },
        onQuantityChange = { raw -> onQuantityChange(item.packId, raw) },
      )
    }

    if (state.unavailableItems.isNotEmpty()) {
      item {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        SectionHeader(
          title = "Cannot be ordered today",
          subtitle = "Checked against live stock just now — these are not added",
        )
      }
      items(state.unavailableItems, key = { "unavailable-${it.packId}" }) { item ->
        BuyAgainUnavailableRow(item = item)
      }
    }

    if (state.lineResults.isNotEmpty()) {
      item {
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          modifier = Modifier
            .fillMaxWidth()
            .testTag(BuyAgainTags.RESULT),
        ) {
          Column(
            modifier = Modifier.padding(MaharaniDimens.spaceMd),
            verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          ) {
            Text("Lines the server did not accept", style = MaterialTheme.typography.titleSmall)
            state.lineResults.forEach { result ->
              Text(
                text = "${result.productName}: ${result.message}",
                style = MaterialTheme.typography.bodySmall,
              )
            }
          }
        }
      }
    }

    item {
      Button(
        onClick = onAdd,
        enabled = !state.adding && state.selectedCount > 0,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(BuyAgainTags.ADD),
        shape = RoundedCornerShape(MaharaniDimens.radiusTile),
      ) {
        if (state.adding) {
          CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        } else {
          Text(
            if (state.selectedCount == 0) {
              "Select products to add"
            } else {
              "Add ${
                state.selectedCount
              } product${if (state.selectedCount == 1) "" else "s"} to cart"
            },
          )
        }
      }
      Text(
        "Quantities start at what you ordered last time and are never below the current minimum. " +
          "The server re-checks stock, pack rules and price as each line is added.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = MaharaniDimens.spaceXs),
      )
    }
  }
}

@Composable
private fun BuyAgainRow(
  item: BuyAgainItem,
  selected: Boolean,
  quantity: Int,
  onToggle: () -> Unit,
  onQuantityChange: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val current = item.current
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier
      .fillMaxWidth()
      .testTag("${BuyAgainTags.ITEM}_${item.packId}"),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.cardPadding),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        Checkbox(
          checked = selected,
          onCheckedChange = { onToggle() },
          modifier = Modifier.size(MaharaniDimens.touchTarget),
        )
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
        ) {
          Text(
            text = item.candidate.productName ?: "Product",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
          )
          Text(
            text = buildList {
              item.candidate.packName?.let { add(it) }
              add("Ordered ${item.candidate.timesOrdered} time${if (item.candidate.timesOrdered == 1) "" else "s"}")
              IsoDateDisplay.formatDate(item.candidate.lastOrderedAt)
                ?.let { add("last on $it") }
            }.joinToString(" · "),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
          )
          Text(
            text = "Last order: ${item.candidate.lastPieces} pcs",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        PriceBlock(
          unitPricePaise = current?.unitPricePaise,
          mrpPaise = current?.mrpPaise,
          emphasis = PriceEmphasis.Card,
          caption = current?.lineTotalAtMoqPaise?.let { total ->
            "Min order total ${com.maharanitraders.core.designsystem.MoneyFormat.formatPaise(total)}"
          },
          casePricePaise = current?.derivedCasePricePaise,
          unitsPerCase = current?.unitsPerCase,
          modifier = Modifier.weight(1f, fill = false),
        )
        StockBadge(
          availability = current?.availability ?: com.maharanitraders.core.model.PackAvailability.UNKNOWN,
          compact = true,
        )
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        FactChip(
          text = "Min ${current?.moq ?: 1} pcs",
          modifier = Modifier.testTag("${BuyAgainTags.QUANTITY}_moq_${item.packId}"),
        )
        current?.unitsPerCase?.let { units -> FactChip(text = "$units pcs/case") }
        Box(modifier = Modifier.weight(1f))
        OutlinedTextField(
          value = quantity.toString(),
          onValueChange = onQuantityChange,
          label = { Text("Qty") },
          singleLine = true,
          modifier = Modifier
            .width(96.dp)
            .testTag("${BuyAgainTags.QUANTITY}_${item.packId}"),
        )
      }
    }
  }
}

@Composable
private fun BuyAgainUnavailableRow(item: BuyAgainItem, modifier: Modifier = Modifier) {
  val tokens = MaharaniThemeTokens.colors
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = modifier
      .fillMaxWidth()
      .testTag("${BuyAgainTags.UNAVAILABLE}_${item.packId}"),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
    ) {
      Text(
        text = item.candidate.productName ?: "Product",
        style = MaterialTheme.typography.titleSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      Text(
        text = when (item.status) {
          BuyAgainStatus.UNAVAILABLE -> "Out of stock or no longer sold. It cannot be reordered right now."
          BuyAgainStatus.CHECKING -> "Checking current price and stock…"
          else -> item.current?.message
            ?: "Its current price could not be confirmed, so it is not offered."
        },
        style = MaterialTheme.typography.bodySmall,
        color = if (item.status == BuyAgainStatus.UNAVAILABLE) tokens.outOfStock else MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
