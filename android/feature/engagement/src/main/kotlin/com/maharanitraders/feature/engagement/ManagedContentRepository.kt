package com.maharanitraders.feature.engagement

import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.common.map
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.network.ApiCallExecutor
import com.maharanitraders.core.network.MaharaniApi
import com.maharanitraders.core.network.dto.ManagedPageDto
import com.maharanitraders.core.network.dto.ManagedPageSectionDto
import com.maharanitraders.core.network.dto.ManagedPageSummaryDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The app's only source of About/policy text: the managed website content
 * (migration 0104) through `GET /api/mobile/v1/pages[/{slug}]`.
 *
 * WHY THIS IS A REPOSITORY AND NOT A CONSTANT LIST
 * The website and the app must show the same wording. A hardcoded list would
 * drift the moment the Super Admin edits a page, and it would mean the app ships
 * policy text that nobody reviewed for that release. Here the app knows only how
 * to *render* a page; the content, its version and its effective date come from
 * the server.
 *
 * PUBLISHED ONLY
 * The endpoints are anonymous and read `published_page()`/`published_pages()`,
 * which return the published snapshot. An unpublished page answers 404 with a
 * machine-readable reason (`AppError.Api` / `NOT_FOUND`); the app shows the customer-friendly
 * message and never a draft, an internal note or a review status.
 */
interface ManagedContentRepository {
  /** Every published page, in the Super Admin's order. */
  suspend fun loadPages(): AppResult<List<ManagedPageSummaryDto>>

  /**
   * One published page. An unpublished page is [AppError.Api] with
   * `NOT_FOUND` — the same 404 as a page that does not exist, so the app cannot
   * (and must not) tell a draft from a missing page.
   */
  suspend fun loadPage(slug: String): AppResult<ManagedPageDto>
}

@Singleton
class NetworkManagedContentRepository @Inject constructor(
  private val api: MaharaniApi,
  private val executor: ApiCallExecutor,
) : ManagedContentRepository {

  override suspend fun loadPages(): AppResult<List<ManagedPageSummaryDto>> =
    executor.executeEnvelope { api.publishedPages() }
      // An empty list is a real answer (nothing published yet), not an error: the
      // screen renders "no published information pages" instead of a retry loop.
      .map { it.pages.filter { page -> page.slug.isNotBlank() } }

  override suspend fun loadPage(slug: String): AppResult<ManagedPageDto> {
    if (!SLUG_PATTERN.matches(slug)) {
      // Refuse before the network: the server would answer 404 anyway, and a
      // malformed slug is a programming mistake we do not want to hide.
      return AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, UNAVAILABLE_MESSAGE))
    }
    return executor.executeEnvelope { api.publishedPage(slug) }
      .map(ManagedContentPresentation::sanitize)
  }

  companion object {
    /** Mirrors the database's `site_pages_slug_format` check. */
    val SLUG_PATTERN = Regex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

    /** The website's exact wording for an unpublished page. */
    const val UNAVAILABLE_MESSAGE = "This page is not available right now."
  }
}

/** Presentation helpers shared by the two screens and their tests. */
object ManagedContentPresentation {

  /** Order used by the policy index: the server's order, minus unusable rows. */
  fun index(pages: List<ManagedPageSummaryDto>): List<ManagedPageSummaryDto> =
    pages.filter { page -> page.slug.isNotBlank() && (page.navLabel.isNotBlank() || page.title.isNotBlank()) }

  /** "Version 1.0 · effective 14 Nov 2026", or only the parts that exist. */
  fun versionLine(version: String, effectiveDate: String): String {
    val parts = buildList {
      if (version.isNotBlank()) add("Version $version")
      if (effectiveDate.isNotBlank()) add("effective $effectiveDate")
    }
    return parts.joinToString(" · ")
  }

  /**
   * Drop a link label that has no destination.
   *
   * A label with no href would render a button that does nothing. The database
   * constraint already forbids the pair being half-filled, so this only protects
   * against a future server or a partial snapshot — cheaply, and without failing
   * the whole page for one bad section.
   */
  fun sanitize(page: ManagedPageDto): ManagedPageDto = page.copy(
    sections = page.sections.map { section ->
      if (section.linkLabel != null && section.linkHref.isNullOrBlank()) {
        section.copy(linkLabel = null, linkHref = null)
      } else {
        section
      }
    },
  )

  /** A section is renderable when it has a heading or anything under it. */
  fun isRenderable(section: ManagedPageSectionDto): Boolean =
    section.heading.isNotBlank() || section.paragraphs.isNotEmpty() || section.bullets.isNotEmpty()

  fun renderableSections(page: ManagedPageDto): List<ManagedPageSectionDto> =
    page.sections.filter(::isRenderable)
}
