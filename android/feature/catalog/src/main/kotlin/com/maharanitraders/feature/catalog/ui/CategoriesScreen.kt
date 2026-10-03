package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items as lazyRowItems
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.MaharaniSearchBar
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.ProductGridSkeleton
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.feature.catalog.CategoriesUiState
import com.maharanitraders.feature.catalog.CategoriesViewModel
import com.maharanitraders.feature.catalog.ui.components.BrandTile
import com.maharanitraders.feature.catalog.ui.components.CategoryCard

/** Test tags for the categories surface. */
object CategoriesScreenTags {
  const val FILTER = "categories_filter"
  const val GRID = "categories_grid"
  const val BRAND_ROW = "categories_brand_row"
}

/**
 * The Categories tab: the real taxonomy of the shop.
 *
 * Categories and brands come from the same endpoints the home rail and the
 * catalogue filter use; tapping either opens the catalogue scoped to it. The
 * field at the top narrows the ALREADY LOADED list on the device — it is a
 * directory filter, not a server search, and it says so by only ever showing
 * names the server sent.
 */
@Composable
fun CategoriesScreen(
  onOpenCategory: (categoryId: String) -> Unit,
  onOpenBrand: (brand: CatalogBrand) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: CategoriesViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  CategoriesContent(
    state = state,
    onFilterChange = viewModel::onFilterChange,
    onRetry = viewModel::load,
    onOpenCategory = onOpenCategory,
    onOpenBrand = onOpenBrand,
    modifier = modifier,
  )
}

@Composable
fun CategoriesContent(
  state: CategoriesUiState,
  onFilterChange: (String) -> Unit,
  onRetry: () -> Unit,
  onOpenCategory: (String) -> Unit,
  onOpenBrand: (CatalogBrand) -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(modifier = modifier.fillMaxSize()) {
    Surface(
      color = MaterialTheme.colorScheme.surface,
      shadowElevation = MaharaniDimens.appBarElevation,
      modifier = Modifier.fillMaxWidth(),
    ) {
      MaharaniSearchBar(
        value = state.filter,
        onValueChange = onFilterChange,
        onSubmit = { },
        placeholder = "Filter categories and brands",
        testTag = CategoriesScreenTags.FILTER,
        modifier = Modifier.padding(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceSm,
        ),
      )
    }

    when {
      state.loading -> Box(
        modifier = Modifier
          .fillMaxSize()
          .padding(MaharaniDimens.pageGutter),
      ) { ProductGridSkeleton(columns = 2, rows = 3) }

      state.errorMessage != null && state.categories.isEmpty() -> if (state.offline) {
        OfflineState(onRetry = onRetry)
      } else {
        ErrorState(
          message = state.errorMessage.orEmpty(),
          retryable = state.retryable,
          onRetry = onRetry,
        )
      }

      state.isEmpty -> EmptyState(
        title = "No categories yet",
        message = "The shop's taxonomy has not been published yet. Try again shortly.",
        actionLabel = "Try again",
        onAction = onRetry,
      )

      else -> LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 158.dp),
        modifier = Modifier
          .fillMaxSize()
          .testTag(CategoriesScreenTags.GRID),
        contentPadding = PaddingValues(
          horizontal = MaharaniDimens.pageGutter,
          vertical = MaharaniDimens.spaceMd,
        ),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.cardGap),
      ) {
        val brands = state.visibleBrands
        if (brands.isNotEmpty()) {
          item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
              SectionHeader(title = "Brands")
              LazyRow(
                modifier = Modifier
                  .fillMaxWidth()
                  .testTag(CategoriesScreenTags.BRAND_ROW),
                horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
              ) {
                lazyRowItems(brands, key = { it.id }) { brand ->
                  BrandTile(brand = brand, onClick = { onOpenBrand(brand) })
                }
              }
            }
          }
        }

        item(span = { GridItemSpan(maxLineSpan) }) {
          SectionHeader(
            title = "Categories",
            subtitle = if (state.filter.isBlank()) {
              "${state.categories.size} published"
            } else {
              "${state.visibleCategories.size} of ${state.categories.size} match “${state.filter.trim()}”"
            },
          )
        }

        if (state.noFilterMatch) {
          item(span = { GridItemSpan(maxLineSpan) }) {
            EmptyState(
              title = "No match",
              message = "Nothing in the taxonomy is called “${state.filter.trim()}”. " +
                "Clear the filter to see every category.",
            )
          }
        }

        items(state.visibleCategories, key = { it.id }) { category ->
          CategoryCard(
            category = category,
            onClick = { onOpenCategory(category.id) },
            modifier = Modifier.fillMaxWidth(),
          )
        }
      }
    }
  }
}
