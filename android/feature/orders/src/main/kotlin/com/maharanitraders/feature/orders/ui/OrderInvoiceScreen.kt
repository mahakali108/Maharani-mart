package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.orders.InvoiceLine
import com.maharanitraders.feature.orders.InvoiceUiState
import com.maharanitraders.feature.orders.InvoiceViewModel
import com.maharanitraders.feature.orders.OrderInvoice

/** Test tags for the invoice surface. */
object InvoiceTags {
  const val SCREEN = "invoice_screen"
  const val LINE = "invoice_line"
  const val BACK = "invoice_back"
}

/**
 * Legacy invoice route renders an ORDER SUMMARY, never an issued tax invoice.
 * No supplier or place of supply is verified. Values come from stored order
 * rows; this screen never performs its own tax arithmetic.
 */
@Composable
fun OrderInvoiceScreen(
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: InvoiceViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  OrderInvoiceContent(state = state, onRetry = viewModel::load, onBack = onBack, modifier = modifier)
}

@Composable
fun OrderInvoiceContent(
  state: InvoiceUiState,
  onRetry: () -> Unit,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val invoice = state.invoice
  if (state.loading && invoice == null) {
    LoadingState("Loading order summary…", modifier)
    return
  }
  if (invoice == null) {
    if (state.offline) {
      OfflineState(modifier, onRetry = onRetry)
    } else {
      ErrorState(state.error ?: "This order summary could not be loaded.", modifier, retryable = true, onRetry = onRetry)
    }
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(InvoiceTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item { InvoiceHeader(invoice) }
    item { InvoiceParties(invoice) }

    items(invoice.lines, key = { line -> line.key }) { line ->
      InvoiceLineCard(line = line, invoice = invoice)
    }

    item { InvoiceTotalsCard(invoice) }

    item {
      Text(
        "Catalog HSN is current, not an order-time snapshot. Per-line GST is estimated, may not reconcile to stored order tax and is not an issued tax calculation.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }

    item {
      OutlinedButton(
        onClick = onBack,
        modifier = Modifier.fillMaxWidth().testTag(InvoiceTags.BACK),
      ) { Text("Back") }
    }
  }
}

@Composable
private fun InvoiceHeader(invoice: OrderInvoice) {
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(
      "Order summary — NOT a tax invoice",
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.primary,
    )
    Text(invoice.orderNumber, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Text(invoice.documentNotice ?: "Order summary only — not a GST tax invoice. Contact support about any supplier-issued tax invoice.",
      style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(invoice.placedAt, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun InvoiceParties(invoice: OrderInvoice) {
  Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
    InvoiceCard(title = "Current account profile (not a billing snapshot)") {
      invoice.billedTo.shopName?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
      invoice.billedTo.address?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      invoice.billedTo.areaName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      invoice.billedTo.gstin?.let { Text("GSTIN on account (unverified): $it", style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
private fun InvoiceLineCard(line: InvoiceLine, invoice: OrderInvoice) {
  InvoiceCard(title = line.displayName, testTag = InvoiceTags.LINE) {
    Text(
      "${line.packName} · ${line.quantityLabel}" + (line.hsn?.let { " · Catalog HSN (unverified) $it" } ?: ""),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    line.unitPrices.forEach { unitPrice ->
      Text(
        "${MoneyFormat.formatPaise(unitPrice.unitPricePaise)} / ${unitPrice.unit}",
        style = MaterialTheme.typography.bodySmall,
      )
    }
    Text("Recorded GST rate (unverified) ${formatPercent(line.gstPercent)}", style = MaterialTheme.typography.bodySmall)
    // Only the columns the server actually split are shown.
    if (invoice.isIntraState) {
      Text("Estimated CGST/SGST (unverified): ${MoneyFormat.formatPaise(line.cgstPaise)} · ${MoneyFormat.formatPaise(line.sgstPaise)}", style = MaterialTheme.typography.bodySmall)
    } else if (invoice.isInterState) {
      Text("Estimated IGST (unverified) ${MoneyFormat.formatPaise(line.igstPaise)}", style = MaterialTheme.typography.bodySmall)
    } else {
      Text("Estimated GST (unverified) ${MoneyFormat.formatPaise(line.taxPaise)}", style = MaterialTheme.typography.bodySmall)
    }
    Text("Line total ${MoneyFormat.formatPaise(line.lineTotalPaise)}", style = MaterialTheme.typography.titleSmall)
  }
}

@Composable
private fun InvoiceTotalsCard(invoice: OrderInvoice) {
  InvoiceCard(title = "Totals") {
    InvoiceAmountRow("Subtotal", invoice.totals.subtotalPaise)
    when {
      invoice.isIntraState -> {
        InvoiceAmountRow("Estimated CGST (unverified)", invoice.totals.cgstPaise)
        InvoiceAmountRow("Estimated SGST (unverified)", invoice.totals.sgstPaise)
      }
      invoice.isInterState -> InvoiceAmountRow("Estimated IGST (unverified)", invoice.totals.igstPaise)
      // The stored order tax is the printed value whenever the server could not
      // split it — the same figure the web invoice shows.
      else -> InvoiceAmountRow("Stored order GST (unverified)", invoice.totals.gstTotalPaise)
    }
    if (invoice.totals.discountPaise > 0) InvoiceAmountRow("Discount", -invoice.totals.discountPaise)
    HorizontalDivider()
    InvoiceAmountRow("Grand total", invoice.totals.grandTotalPaise, emphasized = true)
  }
}

@Composable
private fun InvoiceCard(title: String, testTag: String? = null, content: @Composable () -> Unit) {
  Surface(
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = if (testTag != null) Modifier.fillMaxWidth().testTag(testTag) else Modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      content()
    }
  }
}

@Composable
private fun InvoiceAmountRow(label: String, paise: Long, emphasized: Boolean = false) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
    Text(MoneyFormat.formatPaise(paise), style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
  }
}
