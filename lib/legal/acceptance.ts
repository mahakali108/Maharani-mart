'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { LEGAL_DOCUMENTS, REQUIRED_ACCEPTANCE, type LegalDocument } from '@/lib/legal/documents';

export type AcceptanceAudience = keyof typeof REQUIRED_ACCEPTANCE;
export type AcceptanceItem = { document: LegalDocument; acceptedAt: string | null };
export type AcceptanceStatus =
  | { available: true; items: AcceptanceItem[]; pending: number }
  /** The acceptance table (migration 0095) is not installed, or could not be read. */
  | { available: false };

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function baseRequiredDocuments(audience: AcceptanceAudience): LegalDocument[] {
  return REQUIRED_ACCEPTANCE[audience]
    .map((key) => LEGAL_DOCUMENTS.find((doc) => doc.key === key))
    .filter((doc): doc is LegalDocument => Boolean(doc));
}

/**
 * The version a user must accept is the version the DATABASE says is current
 * (`legal_document_current_versions`, 0098), because that is the version
 * `record_legal_acceptance()` will accept. Since migration 0104/0105 a Super Admin
 * can publish a new version of a policy from /admin/content without a deploy, and
 * `publish_site_page()` updates that table; reading the registry alone would then
 * ask people to accept a version the database refuses.
 *
 * `lib/legal/documents.ts` remains the registry of WHICH documents exist, their
 * addresses and their default version. A missing row falls back to it, so an
 * environment that has not applied 0098 keeps working as before.
 */
async function currentVersions(
  supabase: SupabaseClient,
  keys: readonly string[],
): Promise<Map<string, string>> {
  try {
    const { data, error } = await supabase
      .from('legal_document_current_versions' as never)
      .select('document_key, document_version')
      .in('document_key', [...keys])
      .returns<{ document_key: string; document_version: string }[]>();
    if (error || !data) return new Map();
    return new Map(data.map((row) => [row.document_key, row.document_version]));
  } catch {
    return new Map();
  }
}

function withCurrentVersions(documents: LegalDocument[], versions: Map<string, string>): LegalDocument[] {
  return documents.map((document) => {
    const current = versions.get(document.key);
    return current ? { ...document, version: current } : document;
  });
}

/** Which CURRENT document versions the signed-in user has accepted. */
export async function getAcceptanceStatus(audience: AcceptanceAudience): Promise<AcceptanceStatus> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('legal_document_acceptances' as never)
    .select('document_key, document_version, accepted_at')
    .eq('user_id', user.id)
    .returns<{ document_key: string; document_version: string; accepted_at: string }[]>();
  if (error) return { available: false };

  const required = baseRequiredDocuments(audience);
  const versions = await currentVersions(supabase, required.map((document) => document.key));
  const items = withCurrentVersions(required, versions).map((document) => ({
    document,
    acceptedAt:
      data?.find((row) => row.document_key === document.key && row.document_version === document.version)
        ?.accepted_at ?? null,
  }));
  return { available: true, items, pending: items.filter((item) => !item.acceptedAt).length };
}

/**
 * Record acceptance of the current versions. The document list and version
 * numbers come from the server (the database's current-version table, falling back
 * to the registry) — never from the browser — and the database stamps the user and
 * the time (record_legal_acceptance, 0095/0098).
 */
export async function acceptLegalDocumentsAction(formData: FormData): Promise<void> {
  await requireUser();
  const audience = formData.get('audience');
  if (audience !== 'retailer' && audience !== 'seller') return;
  if (formData.get('confirm') !== 'on') return;
  const supabase = await createClient();
  const required = baseRequiredDocuments(audience);
  const versions = await currentVersions(supabase, required.map((document) => document.key));
  for (const document of withCurrentVersions(required, versions)) {
    const { error } = await supabase.rpc('record_legal_acceptance' as never, {
      p_document_key: document.key,
      p_document_version: document.version,
      p_context: audience === 'seller' ? 'seller_onboarding' : 'account',
    } as never);
    if (error) {
      // LEGAL_VERSION_NOT_CURRENT (0098): the published version moved on while the
      // page was open. Nothing is recorded; the refreshed page shows the document
      // as still pending, so the person reads and accepts the current text.
      console.warn(
        error.message.includes('LEGAL_VERSION_NOT_CURRENT')
          ? `Legal acceptance refused: ${document.key} ${document.version} is not the current version.`
          : `Legal acceptance could not be recorded: ${error.message}`,
      );
      break;
    }
  }
  revalidatePath('/retailer/account/security');
}
