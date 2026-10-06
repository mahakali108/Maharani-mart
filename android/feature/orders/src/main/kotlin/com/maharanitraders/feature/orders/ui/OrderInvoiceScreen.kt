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
 * The GST invoice, rendered entirely from server figures.
 *
 * The tax columns follow the server's `taxMode`: CGST + SGST for an intra-state
 * invoice, IGST for an inter-state one, and a single GST column when the server
 * could not split it (a missing or invalid GSTIN is never guessed). This screen
 * never divides by a tax rate.
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
    LoadingState("Loading this invoice…", modifier)
    return
  }
  if (invoice == null) {
    if (state.offline) {
      OfflineState(modifier, onRetry = onRetry)
    } else {
      ErrorState(state.error ?: "This invoice could not be loaded.", modifier, retryable = true, onRetry = onRetry)
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
        "Prices are GST-inclusive. The tax columns are extracted from the line " +
          "totals and are already contained in the grand total.",
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
      "Tax invoice",
      style = MaterialTheme.typography.labelMedium,
      color = MaterialTheme.colorScheme.primary,
    )
    Text(invoice.orderNumber, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Text(invoice.placedAt, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun InvoiceParties(invoice: OrderInvoice) {
  Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
    InvoiceCard(title = "From") {
      invoice.biller.name?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
      invoice.biller.address?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      invoice.biller.gstin?.let { Text("GSTIN: $it", style = MaterialTheme.typography.bodySmall) }
      invoice.biller.phone?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    InvoiceCard(title = "Billed to") {
      invoice.billedTo.shopName?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
      invoice.billedTo.address?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      invoice.billedTo.areaName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      invoice.billedTo.gstin?.let { Text("GSTIN: $it", style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
private fun InvoiceLineCard(line: InvoiceLine, invoice: OrderInvoice) {
  InvoiceCard(title = line.displayName, testTag = InvoiceTags.LINE) {
    Text(
      "${line.packName} · ${line.quantityLabel}" + (line.hsn?.let { " · HSN $it" } ?: ""),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    line.unitPrices.forEach { unitPrice ->
      Text(
        "${MoneyFormat.formatPaise(unitPrice.unitPricePaise)} / ${unitPrice.unit}",
        style = MaterialTheme.typography.bodySmall,
      )
    }
    Text("GST ${formatPercent(line.gstPercent)}", style = MaterialTheme.typography.bodySmall)
    // Only the columns the server actually split are shown.
    if (invoice.isIntraState) {
      Text("CGST ${MoneyFormat.formatPaise(line.cgstPaise)} · SGST ${MoneyFormat.formatPaise(line.sgstPaise)}", style = MaterialTheme.typography.bodySmall)
    } else if (invoice.isInterState) {
      Text("IGST ${MoneyFormat.formatPaise(line.igstPaise)}", style = MaterialTheme.typography.bodySmall)
    } else {
      Text("GST ${MoneyFormat.formatPaise(line.taxPaise)}", style = MaterialTheme.typography.bodySmall)
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
        InvoiceAmountRow("CGST", invoice.totals.cgstPaise)
        InvoiceAmountRow("SGST", invoice.totals.sgstPaise)
      }
      invoice.isInterState -> InvoiceAmountRow("IGST", invoice.totals.igstPaise)
      // The stored order tax is the printed value whenever the server could not
      // split it — the same figure the web invoice shows.
      else -> InvoiceAmountRow("GST", invoice.totals.gstTotalPaise)
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
