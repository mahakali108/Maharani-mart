package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.network.dto.ManagedPageDto
import com.maharanitraders.core.network.dto.ManagedPageSectionDto
import com.maharanitraders.core.network.dto.ManagedPageSummaryDto
import com.maharanitraders.feature.engagement.LegalCentreViewModel
import com.maharanitraders.feature.engagement.ManagedContentPresentation
import com.maharanitraders.feature.engagement.ManagedPageViewModel
import com.maharanitraders.feature.engagement.NetworkManagedContentRepository

/** Test tags, so a UI test can address each state without reading prose. */
object ManagedContentTags {
  const val INDEX = "managed_content_index"
  const val PAGE = "managed_content_page"
  const val UNAVAILABLE = "managed_content_unavailable"
  const val SECTION = "managed_content_section"
  fun pageLink(slug: String): String = "managed_content_link_$slug"
}

/**
 * The policy index: About, Contact and every published legal page.
 *
 * Nothing here is hardcoded — the list, its labels and its order come from the
 * Super Admin's published content, so publishing or unpublishing a page changes
 * this screen without an app release. A page that is not published is simply not
 * in the list; the address still answers "not available right now" if someone
 * follows an old link.
 */
@Composable
fun LegalCentreScreen(
  onOpenPage: (slug: String) -> Unit,
  onOpenContact: () -> Unit = {},
  modifier: Modifier = Modifier,
  viewModel: LegalCentreViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  when {
    state.loading && state.pages.isEmpty() -> LoadingState("Loading policies…", modifier)
    state.error != null -> {
      ErrorState(state.error.orEmpty(), modifier, retryable = state.retryable, onRetry = viewModel::load)
    }
    state.isEmpty -> EmptyState(
      title = "No published pages yet",
      message = "Maharani Traders has not published its information pages yet. Please try again later or contact the shop.",
      modifier = modifier,
      actionLabel = "Check again",
      onAction = viewModel::load,
    )
    else -> LazyColumn(
      modifier = modifier.fillMaxSize().testTag(ManagedContentTags.INDEX),
      contentPadding = PaddingValues(MaharaniDimens.pageGutter),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
          Text(
            "Policies & information",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() },
          )
          Text(
            "Published by Maharani Traders. The same wording as the website, with its version and effective date.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
          )
        }
      }
      items(state.pages, key = { it.slug }) { page ->
        PolicyIndexRow(page = page, onOpen = { onOpenPage(page.slug) })
      }
      item {
        OutlinedButton(
          onClick = onOpenContact,
          modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
        ) {
          Text("Contact Maharani Traders")
        }
      }
    }
  }
}

@Composable
private fun PolicyIndexRow(page: ManagedPageSummaryDto, onOpen: () -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      Text(
        page.shortLabel ?: page.navLabel.ifBlank { page.title },
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
      )
      if (page.title.isNotBlank() && page.title != page.navLabel) {
        Text(page.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      val versionLine = ManagedContentPresentation.versionLine(page.version, page.effectiveDate)
      if (versionLine.isNotBlank()) {
        Text(versionLine, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Button(
        onClick = onOpen,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(ManagedContentTags.pageLink(page.slug)),
      ) {
        Text("Read ${page.shortLabel ?: page.navLabel}")
      }
    }
  }
}

/**
 * One published page, rendered section by section.
 *
 * The body is plain text plus optional bullets and one optional link — the server
 * sends no HTML, so there is no HTML to sanitise and no way for a page to inject
 * layout. An on-site link (`/contact`) opens the same page inside the app; an
 * external one is handed to the platform only for `https`, `mailto:` and `tel:`,
 * the schemes the server already validates, and anything else becomes plain text
 * instead of a control that would silently do nothing.
 *
 * Images are deliberately NOT rendered in this release: no published page uses
 * one, and an `<img>` that fails to load is worse than no image. The field is
 * carried by the contract so a later release can add it without a server change.
 */
@Composable
fun ManagedPageScreen(
  onOpenPage: (slug: String) -> Unit,
  onOpenIndex: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: ManagedPageViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val uriHandler = LocalUriHandler.current
  // Captured once: the state flow can emit between reads, and a screen must never
  // mix one emission's flags with another's body.
  val page = state.page

  when {
    state.loading && page == null -> LoadingState("Loading page…", modifier)
    state.unavailable -> Column(
      modifier = modifier.fillMaxSize().padding(MaharaniDimens.pageGutter).testTag(ManagedContentTags.UNAVAILABLE),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Text(
        NetworkManagedContentRepository.UNAVAILABLE_MESSAGE,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        "This page has not been published. The rest of the policies are still available.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Button(onClick = onOpenIndex, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) {
        Text("See all policies")
      }
    }
    state.error != null && page == null ->
      ErrorState(state.error.orEmpty(), modifier, retryable = state.retryable, onRetry = viewModel::load)
    page == null ->
      // Defensive: a success with no body is treated like an unpublished page
      // rather than an empty white screen.
      EmptyState(
        title = "Nothing to show",
        message = NetworkManagedContentRepository.UNAVAILABLE_MESSAGE,
        modifier = modifier,
        actionLabel = "See all policies",
        onAction = onOpenIndex,
      )
    else -> ManagedPageBody(
      page = page,
      sections = state.sections,
      onOpenPage = onOpenPage,
      onOpenIndex = onOpenIndex,
      onOpenLink = { href -> openLink(href, onOpenPage) { uriHandler.openUri(it) } },
      modifier = modifier,
    )
  }
}

/**
 * Route one published link.
 *
 * An on-site path (`/contact`) is a page of this very app, so it opens the real
 * screen instead of trying to hand a relative path to the browser (which cannot
 * resolve it and would leave a dead button). Everything else must be an absolute
 * scheme the server validates; anything unknown is ignored, never guessed.
 */
internal fun openLink(href: String, onOpenPage: (String) -> Unit, openExternally: (String) -> Unit) {
  val trimmed = href.trim()
  if (trimmed.startsWith("/")) {
    val slug = trimmed.trim('/')
    if (NetworkManagedContentRepository.SLUG_PATTERN.matches(slug)) onOpenPage(slug)
    return
  }
  val allowed = trimmed.startsWith("https://") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")
  if (!allowed) return
  runCatching { openExternally(trimmed) }
}

@Composable
private fun ManagedPageBody(
  page: ManagedPageDto,
  sections: List<ManagedPageSectionDto>,
  onOpenPage: (slug: String) -> Unit,
  onOpenIndex: () -> Unit,
  onOpenLink: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(ManagedContentTags.PAGE),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
        page.eyebrow?.takeIf { it.isNotBlank() }?.let {
          Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        Text(
          page.title.ifBlank { page.navLabel },
          style = MaterialTheme.typography.headlineSmall,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.semantics { heading() },
        )
        val versionLine = ManagedContentPresentation.versionLine(page.version, page.effectiveDate)
        if (versionLine.isNotBlank()) {
          Text(versionLine, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (page.intro.isNotBlank()) {
          Text(page.intro, style = MaterialTheme.typography.bodyMedium)
        }
      }
    }

    items(sections) { section ->
      Card(
        modifier = Modifier.fillMaxWidth().testTag(ManagedContentTags.SECTION),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
      ) {
        Column(
          modifier = Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd),
          verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        ) {
          if (section.heading.isNotBlank()) {
            Text(
              section.heading,
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.SemiBold,
              modifier = Modifier.semantics { heading() },
            )
          }
          section.paragraphs.forEach { paragraph ->
            Text(paragraph, style = MaterialTheme.typography.bodyMedium)
          }
          if (section.bullets.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
              section.bullets.forEach { bullet ->
                Row(verticalAlignment = Alignment.Top) {
                  Text("•  ", style = MaterialTheme.typography.bodyMedium)
                  Text(bullet, style = MaterialTheme.typography.bodyMedium)
                }
              }
            }
          }
          val label = section.linkLabel
          val href = section.linkHref
          if (label != null && href != null) {
            OutlinedButton(
              onClick = { onOpenLink(href) },
              modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
            ) {
              Text(label, textDecoration = TextDecoration.Underline)
            }
          }
        }
      }
    }

    if (page.relatedSlugs.isNotEmpty()) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Related", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          page.relatedSlugs.forEach { slug ->
            OutlinedButton(
              onClick = { onOpenPage(slug) },
              modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
            ) {
              Text(slug.replace('-', ' ').replaceFirstChar { it.uppercase() })
            }
          }
        }
      }
    }

    item {
      OutlinedButton(
        onClick = onOpenIndex,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
      ) {
        Text("See all policies")
      }
    }
  }
}
