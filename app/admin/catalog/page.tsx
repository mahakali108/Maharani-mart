import { redirect } from 'next/navigation';
import { CATEGORIES_LIST_PATH } from '@/lib/admin/master-data-query';

/**
 * The combined Categories & Brands screen was split into two dedicated,
 * paginated lists (Phase 7). This route stays alive as a redirect so the
 * sidebar entry and every existing link to /admin/catalog keeps working.
 */
export default function CatalogPage() {
  redirect(CATEGORIES_LIST_PATH);
}
