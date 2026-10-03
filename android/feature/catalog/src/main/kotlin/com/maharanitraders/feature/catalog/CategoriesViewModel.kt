package com.maharanitraders.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.CatalogBrand
import com.maharanitraders.core.model.CatalogCategory
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The Categories tab: the real taxonomy, nothing else.
 *
 * The list is `GET /api/mobile/v1/catalog/categories` + `/brands` — the same
 * active taxonomy the home rail and the catalogue filter use. The search field
 * on this screen filters the ALREADY LOADED names on the device; it never
 * pretends to be a server search, and it cannot surface a category the server
 * did not send.
 */
data class CategoriesUiState(
  val loading: Boolean = true,
  val categories: List<CatalogCategory> = emptyList(),
  val brands: List<CatalogBrand> = emptyList(),
  val filter: String = "",
  val errorMessage: String? = null,
  val offline: Boolean = false,
  val retryable: Boolean = true,
) {
  val visibleCategories: List<CatalogCategory>
    get() = if (filter.isBlank()) {
      categories
    } else {
      categories.filter { it.name.contains(filter.trim(), ignoreCase = true) }
    }

  val visibleBrands: List<CatalogBrand>
    get() = if (filter.isBlank()) {
      brands
    } else {
      brands.filter { it.name.contains(filter.trim(), ignoreCase = true) }
    }

  val isEmpty: Boolean
    get() = !loading && errorMessage == null && categories.isEmpty() && brands.isEmpty()

  val noFilterMatch: Boolean
    get() = !loading && errorMessage == null && categories.isNotEmpty() &&
      visibleCategories.isEmpty() && visibleBrands.isEmpty()
}

@HiltViewModel
class CategoriesViewModel @Inject constructor(
  private val repository: CatalogRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(CategoriesUiState())
  val state: StateFlow<CategoriesUiState> = _state.asStateFlow()

  private var request: Job? = null

  init {
    load()
  }

  fun onFilterChange(value: String) {
    _state.update { it.copy(filter = value) }
  }

  /** Load or reload the taxonomy. Concurrent calls collapse into one. */
  fun load() {
    if (request?.isActive == true) return
    _state.update { it.copy(loading = true, errorMessage = null, offline = false) }

    request = viewModelScope.launch {
      val (categories, brands) = coroutineScope {
        val cats = async { repository.loadCategories() }
        val brandList = async { repository.loadBrands() }
        cats.await() to brandList.await()
      }

      when (categories) {
        is AppResult.Success -> _state.update {
          it.copy(
            loading = false,
            categories = categories.value,
            // A missing brand list must not blank the category directory.
            brands = (brands as? AppResult.Success)?.value.orEmpty(),
            errorMessage = null,
            offline = false,
          )
        }

        is AppResult.Failure -> _state.update {
          it.copy(
            loading = false,
            errorMessage = categories.error.message,
            offline = categories.error.isOffline,
            retryable = categories.error.retryable,
          )
        }
      }
    }
  }
}
