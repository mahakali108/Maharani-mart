package com.maharanitraders.feature.engagement.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.network.dto.MobileReportProductDto
import com.maharanitraders.core.network.dto.MobileReportTotalsDto
import com.maharanitraders.feature.engagement.PurchaseReportsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object PurchaseReportsTags {
  const val SCREEN = "purchase_reports_screen"
  const val EXPORT_ORDERS = "reports_export_orders"
  const val EXPORT_LEDGER = "reports_export_ledger"
}

@Composable
fun PurchaseReportsScreen(
  modifier: Modifier = Modifier,
  viewModel: PurchaseReportsViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  var fromDate by remember { mutableStateOf("") }
  var toDate by remember { mutableStateOf("") }
  var pendingType by remember { mutableStateOf("orders") }
  var targetUri by remember { mutableStateOf<android.net.Uri?>(null) }
  var exportMessage by remember { mutableStateOf<String?>(null) }
  val context = LocalContext.current
  val documentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
    if (uri == null) {
      targetUri = null
    } else {
      targetUri = uri
      viewModel.export(pendingType, fromDate.trim().ifEmpty { null }, toDate.trim().ifEmpty { null })
    }
  }

  LaunchedEffect(state.exportCsv, targetUri) {
    val csv = state.exportCsv ?: return@LaunchedEffect
    val uri = targetUri ?: return@LaunchedEffect
    val saved = withContext(Dispatchers.IO) {
      runCatching {
        context.contentResolver.openOutputStream(uri, "wt")?.bufferedWriter()?.use { it.write(csv) }
          ?: error("Could not open the selected file.")
      }.isSuccess
    }
    exportMessage = if (saved) "Statement saved." else "The statement could not be written to the selected location."
    targetUri = null
    viewModel.clearExport()
  }
  LaunchedEffect(state.exportError) {
    state.exportError?.let {
      exportMessage = it
      targetUri = null
      viewModel.clearExport()
    }
  }

  if (state.loading && state.reports == null) {
    LoadingState("Loading your purchase reports…", modifier)
    return
  }
  if (state.reports == null && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }
  val reports = state.reports
  if (reports == null) {
    EmptyState("Reports unavailable", "No report data was returned.", modifier = modifier.fillMaxSize())
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(PurchaseReportsTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Purchase reports", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Summaries are calculated from your completed orders and Coins ledger.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item { ReportTotalsCard("This week", reports.week.totals) }
    item { ProductSection("Top products this week", reports.week.topProducts) }
    item { ReportTotalsCard("This month", reports.month.totals) }
    item { ProductSection("Top products this month", reports.month.topProducts) }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text("Coins summary", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          ReportValue("Coins funded", reports.coins.coinsFundedPaise)
          ReportValue("Coins spent", reports.coins.coinsSpentPaise)
          ReportValue("Coins available", reports.coins.coinsAvailablePaise, emphasize = true)
        }
      }
    }
    if (reports.trend.isNotEmpty()) {
      item { Text("Monthly purchase trend", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
      items(reports.trend, key = { it.monthKey }) { row ->
        Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(MaharaniDimens.radiusTile), modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(row.label, style = MaterialTheme.typography.titleSmall)
            Text("${row.orderCount} orders · ${MoneyFormat.formatPaise(row.purchaseValuePaise)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    item { ProductSection("Most purchased", reports.mostPurchased) }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Download a statement", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text("Optional dates use YYYY-MM-DD in India time. Leave both blank for the server's default period.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          OutlinedTextField(value = fromDate, onValueChange = { fromDate = it }, label = { Text("From date") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth())
          OutlinedTextField(value = toDate, onValueChange = { toDate = it }, label = { Text("To date") }, placeholder = { Text("YYYY-MM-DD") }, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), modifier = Modifier.fillMaxWidth())
          Button(
            onClick = { pendingType = "orders"; documentLauncher.launch("maharani-orders-statement.csv") },
            enabled = state.exportingType == null,
            modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(PurchaseReportsTags.EXPORT_ORDERS),
          ) {
            if (state.exportingType == "orders") CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
            Text(if (state.exportingType == "orders") "Preparing…" else "Save order statement CSV")
          }
          Button(
            onClick = { pendingType = "ledger"; documentLauncher.launch("maharani-coins-statement.csv") },
            enabled = state.exportingType == null,
            modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(PurchaseReportsTags.EXPORT_LEDGER),
          ) {
            if (state.exportingType == "ledger") CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
            Text(if (state.exportingType == "ledger") "Preparing…" else "Save Coins statement CSV")
          }
          exportMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
        }
      }
    }
  }
}

@Composable
private fun ReportTotalsCard(title: String, totals: MobileReportTotalsDto) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text("${totals.orderCount} orders", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      ReportValue("Purchase value", totals.purchaseValuePaise, emphasize = true)
      ReportValue("GST", totals.gstTotalPaise)
      ReportValue("Discounts", totals.discountTotalPaise)
    }
  }
}

@Composable
private fun ReportValue(label: String, paise: Long, emphasize: Boolean = false) {
  androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = if (emphasize) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
    Text(MoneyFormat.formatPaise(paise), style = if (emphasize) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun ProductSection(title: String, products: List<MobileReportProductDto>) {
  Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    if (products.isEmpty()) {
      Text("No purchase data for this period.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else products.forEach { product ->
      Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(MaharaniDimens.radiusTile), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(product.name, style = MaterialTheme.typography.titleSmall)
          product.brandName?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
          Text("${product.totalPieces} pieces · ${product.orderCount} orders · ${MoneyFormat.formatPaise(product.totalValuePaise)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}
