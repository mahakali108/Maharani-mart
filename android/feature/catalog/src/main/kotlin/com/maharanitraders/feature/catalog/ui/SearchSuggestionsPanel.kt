package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.BrandGlyph
import com.maharanitraders.core.designsystem.components.CategoryGlyph
import com.maharanitraders.core.designsystem.components.SearchGlyph
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.SearchSuggestion
import com.maharanitraders.core.model.SearchSuggestions
import com.maharanitraders.feature.catalog.ui.components.ProductImage

/** Test tags for the cross-entity suggestion panel. */
object SearchSuggestionTags {
  const val PANEL = "search_suggestion_panel"
  const val PRODUCT_ROW = "search_suggestion_product"
  const val BRAND_ROW = "search_suggestion_brand"
  const val CATEGORY_ROW = "search_suggestion_category"
  const val LOADING = "search_suggestion_loading"
  const val ERROR = "search_suggestion_error"
  const val RETRY = "search_suggestion_retry"
  const val EMPTY = "search_suggestion_empty"
  const val DISMISS = "search_suggestion_dismiss"
}

/**
 * The cross-entity search panel: PRODUCTS, CATEGORIES and BRANDS for the term
 * being typed.
 *
 * WHY THIS EXISTS
 * Before it, the native search field was a product search only, so a retailer
 * who typed a brand name or a category name got "no products found" where the
 * web storefront would have offered the brand and the category. The rows come
 * from `GET /api/mobile/v1/catalog/search`, which runs the same four reads the
 * storefront's own suggestion loader runs — products by name or product barcode,
 * packs by pack name or PACK barcode folded onto their parent product, brands,
 * and categories with their real parent name.
 *
 * WHAT IT NEVER DOES
 *  - it shows no price, no stock and no MOQ. A suggestion is a shortcut to the
 *    priced row, not a second copy of it, so it cannot quote a number checkout
 *    would reject;
 *  - it does not render "no match" for a failed read. `error` draws the reason
 *    and a Retry, because the product list underneath may well have results;
 *  - it does not invent popular searches — there is no popularity table in this
 *    backend, and a made-up trending list is a lie with good typography.
 *
 * A barcode hit says so: the shopper typed a number and the app found the product
 * behind it, which a plain name match would hide.
 */
@Composable
fun SearchSuggestionPanel(
  suggestions: SearchSuggestions,
  loading: Boolean,
  error: String?,
  term: String,
  onRetry: () -> Unit,
  onSelectProduct: (String) -> Unit,
  onSelectBrand: (String, String) -> Unit,
  onSelectCategory: (String) -> Unit,
  onDismiss: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier
      .fillMaxWidth()
      .testTag(SearchSuggestionTags.PANEL),
    color = MaterialTheme.colorScheme.surface,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    shadowElevation = MaharaniDimens.cardElevation,
    tonalElevation = 0.dp,
  ) {
    Column(modifier = Modifier.fillMaxWidth()) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(
            start = MaharaniDimens.spaceMd,
            end = MaharaniDimens.spaceXs,
            top = MaharaniDimens.spaceSm,
          ),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          text = "Search suggestions",
          style = MaterialTheme.typography.labelSmall,
          fontWeight = FontWeight.SemiBold,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.weight(1f),
        )
        TextButton(
          onClick = onDismiss,
          modifier = Modifier
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(SearchSuggestionTags.DISMISS),
        ) { Text("Close") }
      }

      when {
        error != null -> SuggestionError(message = error, onRetry = onRetry)
        loading && suggestions.isEmpty -> Box(
          modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(SearchSuggestionTags.LOADING),
          contentAlignment = Alignment.Center,
        ) {
          CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        }

        suggestions.isEmpty -> Text(
          text = "No product, brand or category matches \u201C${term.trim()}\u201D. " +
            "The list below still shows the product results.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier
            .fillMaxWidth()
            .padding(MaharaniDimens.spaceMd)
            .testTag(SearchSuggestionTags.EMPTY),
        )

        else -> Column(modifier = Modifier.fillMaxWidth()) {
          suggestions.suggestions.forEach { suggestion ->
            SuggestionRow(suggestion, onSelectProduct, onSelectBrand, onSelectCategory)
          }
        }
      }
      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
  }
}

@Composable
private fun SuggestionError(message: String, onRetry: () -> Unit) {
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .padding(MaharaniDimens.spaceMd)
      .testTag(SearchSuggestionTags.ERROR),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
  ) {
    Text(
      text = message,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.error,
    )
    TextButton(
      onClick = onRetry,
      modifier = Modifier
        .heightIn(min = MaharaniDimens.touchTarget)
        .testTag(SearchSuggestionTags.RETRY),
    ) { Text("Retry") }
  }
}

/**
 * One suggestion row.
 *
 * The three kinds share one layout so a brand, a category and a product are the
 * same size, the same rhythm and the same tap target — what differs is the mark,
 * the caption and (for a barcode hit) the badge that says how it matched.
 */
@Composable
private fun SuggestionRow(
  suggestion: SearchSuggestion,
  onSelectProduct: (String) -> Unit,
  onSelectBrand: (String, String) -> Unit,
  onSelectCategory: (String) -> Unit,
) {
  when (suggestion) {
    is SearchSuggestion.Product -> SuggestionRowShell(
      tag = SearchSuggestionTags.PRODUCT_ROW,
      title = suggestion.label,
      caption = suggestion.packName?.let { pack ->
        if (suggestion.brandName == null) pack else "${suggestion.brandName} \u00B7 $pack"
      } ?: suggestion.brandName,
      badge = if (suggestion.matchedBarcode) "Barcode match" else null,
      onClick = { onSelectProduct(suggestion.id) },
      leading = {
        ProductImage(
          url = suggestion.imageUrl,
          fallbackLabel = suggestion.label,
          modifier = Modifier.size(40.dp),
        )
      },
    )

    is SearchSuggestion.Category -> SuggestionRowShell(
      tag = SearchSuggestionTags.CATEGORY_ROW,
      title = suggestion.label,
      caption = suggestion.parentName?.let { "Category in $it" } ?: "Category",
      badge = null,
      onClick = { onSelectCategory(suggestion.id) },
      leading = {
        CategoryGlyph(modifier = Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
      },
    )

    is SearchSuggestion.Brand -> SuggestionRowShell(
      tag = SearchSuggestionTags.BRAND_ROW,
      title = suggestion.label,
      caption = "Brand",
      badge = null,
      onClick = { onSelectBrand(suggestion.id, suggestion.label) },
      leading = {
        val logo = suggestion.logoUrl
        if (logo == null) {
          BrandGlyph(modifier = Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
        } else {
          ProductImage(
            url = logo,
            fallbackLabel = suggestion.label,
            modifier = Modifier.size(40.dp),
            brandedMonogram = true,
          )
        }
      },
    )
  }
}

@Composable
private fun SuggestionRowShell(
  tag: String,
  title: String,
  caption: String?,
  badge: String?,
  onClick: () -> Unit,
  leading: @Composable () -> Unit,
) {
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget)
      .clickable(onClick = onClick)
      .padding(horizontal = MaharaniDimens.spaceMd, vertical = MaharaniDimens.spaceSm)
      .testTag(tag),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    Box(modifier = Modifier.size(40.dp), contentAlignment = Alignment.Center) { leading() }
    Column(modifier = Modifier.weight(1f)) {
      Text(
        text = title,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      if (caption != null) {
        Text(
          text = caption,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    if (badge != null) {
      Surface(
        shape = RoundedCornerShape(MaharaniDimens.radiusChip),
        color = MaterialTheme.colorScheme.secondaryContainer,
      ) {
        Text(
          text = badge,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSecondaryContainer,
          modifier = Modifier.padding(horizontal = MaharaniDimens.spaceSm, vertical = 2.dp),
        )
      }
    } else {
      SearchGlyph(
        modifier = Modifier.size(16.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
