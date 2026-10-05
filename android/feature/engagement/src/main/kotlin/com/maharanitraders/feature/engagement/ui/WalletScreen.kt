package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.engagement.WalletLedgerEntry
import com.maharanitraders.feature.engagement.WalletSummary
import com.maharanitraders.feature.engagement.WalletViewModel

object WalletTags {
  const val SCREEN = "wallet_screen"
  const val SUMMARY = "wallet_summary"
  const val LEDGER = "wallet_ledger"
  const val LOAD_MORE = "wallet_load_more"
}

@Composable
fun WalletScreen(
  modifier: Modifier = Modifier,
  viewModel: WalletViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  WalletContent(
    state = state,
    onRefresh = viewModel::load,
    onLoadMore = viewModel::loadMore,
    modifier = modifier,
  )
}

@Composable
fun WalletContent(
  state: com.maharanitraders.feature.engagement.WalletUiState,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.summaryLoading && state.summary == null) {
    LoadingState("Loading your coins…", modifier)
    return
  }
  if (state.summary == null && state.errorMessage != null) {
    if (state.offline) OfflineState(modifier, onRetry = onRefresh)
    else ErrorState(state.errorMessage.orEmpty(), modifier, retryable = true, onRetry = onRefresh)
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(WalletTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Text(
        "Maharani Coins",
        style = MaterialTheme.typography.headlineSmall,
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        "Your coin balance and every transaction, computed by the server.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Text(
        "Spendable on your next order.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    state.summary?.let { summary ->
      item {
        WalletSummaryCard(summary = summary, modifier = Modifier.testTag(WalletTags.SUMMARY))
      }
    }

    state.errorMessage?.let { message ->
      item {
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(12.dp),
        ) {
          Text(message, Modifier.fillMaxWidth().padding(12.dp), style = MaterialTheme.typography.bodySmall)
        }
      }
    }

    item {
      Text(
        "Coin transactions",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
      )
      if (state.ledgerTotal > 0) {
        // The server's own count of recorded rows, and nothing estimated: the web
        // ledger says "recorded data only" for exactly this reason.
        Text(
          "${state.ledgerTotal} entr${if (state.ledgerTotal == 1) "y" else "ies"} · recorded data only",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    if (state.ledgerLoading && state.entries.isEmpty()) {
      item {
        CircularProgressIndicator(modifier = Modifier.padding(16.dp))
      }
    } else if (state.entries.isEmpty()) {
      item {
        com.maharanitraders.core.designsystem.components.EmptyState(
          title = "No transactions yet",
          message = "Coins added, coins spent and reversals will appear here.",
          actionLabel = "Refresh",
          onAction = onRefresh,
          modifier = Modifier.fillMaxWidth(),
        )
      }
    } else {
      items(state.entries, key = { it.id }) { entry ->
        LedgerEntryCard(entry = entry)
      }
    }

    if (state.ledgerHasMore) {
      item {
        OutlinedButton(
          onClick = onLoadMore,
          enabled = !state.loadingMore,
          modifier = Modifier.fillMaxWidth().testTag(WalletTags.LOAD_MORE),
        ) {
          if (state.loadingMore) CircularProgressIndicator(strokeWidth = 2.dp)
          else Text("Load more transactions")
        }
      }
    }
  }
}

/**
 * The shop's one balance, in the only framing this product uses: coins, 1:1 with
 * rupees, spendable on any order.
 */
@Composable
private fun WalletSummaryCard(summary: WalletSummary, modifier: Modifier = Modifier) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.primaryContainer,
    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
  ) {
    Column(
      modifier = Modifier.padding(20.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        "🪙 Coins available",
        style = MaterialTheme.typography.labelLarge,
      )
      Text(
        MoneyFormat.formatPaise(summary.coinBalancePaise),
        style = MaterialTheme.typography.headlineLarge,
        fontWeight = FontWeight.Bold,
      )
      HorizontalDivider(color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.15f))
      Text(
        "Spend coins on any order — 1 coin = ₹1.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f),
      )
      // No credit limit, no "outstanding", no over-limit warning, no pay-later
      // affordance: Maharani Traders retired retailer credit, and the web card
      // this one mirrors (`components/retailer/coins-balance-card.tsx`) shows the
      // same single number. The balance is still the server's — the app only
      // formats what `availablePaise` said, clamped at zero so a shop that has
      // spent more than it was funded sees no spendable coins rather than a debt.
    }
  }
}

@Composable
private fun LedgerEntryCard(entry: WalletLedgerEntry, modifier: Modifier = Modifier) {
  val isCredit = entry.direction == "credit"
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Row(
      modifier = Modifier.padding(14.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
          entry.description.ifEmpty { entry.type.replace('_', ' ') },
          style = MaterialTheme.typography.bodyMedium,
        )
        Text(
          entry.type.replace('_', ' '),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        entry.reason?.takeIf { it.isNotBlank() }?.let {
          Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (entry.isReversed) {
          Text(
            "Reversed",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
          )
        }
      }
      Text(
        text = (if (isCredit) "+" else "−") + MoneyFormat.formatPaise(entry.amountPaise),
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = if (isCredit) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
      )
    }
  }
}