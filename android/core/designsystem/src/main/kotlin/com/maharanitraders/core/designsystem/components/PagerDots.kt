package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Page indicator for banner carousels and image galleries: one dot per page,
 * the current page enlarged and tinted with the primary colour.
 *
 * Rendered for two pages or more — a single page has nothing to indicate.
 */
@Composable
fun PagerDots(
  pageCount: Int,
  currentPage: Int,
  modifier: Modifier = Modifier,
) {
  if (pageCount < 2) return
  Row(
    modifier = modifier.semantics { contentDescription = "Page ${currentPage + 1} of $pageCount" },
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    repeat(pageCount) { index ->
      val selected = index == currentPage
      Box(
        modifier = Modifier
          .size(if (selected) 8.dp else 6.dp)
          .clip(CircleShape)
          .background(
            if (selected) {
              MaterialTheme.colorScheme.primary
            } else {
              MaterialTheme.colorScheme.outline
            },
          ),
      )
    }
  }
}
