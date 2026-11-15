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

function requiredDocuments(audience: AcceptanceAudience): LegalDocument[] {
  return REQUIRED_ACCEPTANCE[audience]
    .map((key) => LEGAL_DOCUMENTS.find((doc) => doc.key === key))
    .filter((doc): doc is LegalDocument => Boolean(doc));
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
  const items = requiredDocuments(audience).map((document) => ({
    document,
    acceptedAt: data?.find((row) => row.document_key === document.key && row.document_version === document.version)?.accepted_at ?? null,
  }));
  return { available: true, items, pending: items.filter((item) => !item.acceptedAt).length };
}

/**
 * Record acceptance of the current versions. The document list and version
 * numbers come from the server-side registry — never from the browser — and
 * the database stamps the user and the time (record_legal_acceptance, 0095).
 */
export async function acceptLegalDocumentsAction(formData: FormData): Promise<void> {
  await requireUser();
  const audience = formData.get('audience');
  if (audience !== 'retailer' && audience !== 'seller') return;
  if (formData.get('confirm') !== 'on') return;
  const supabase = await createClient();
  for (const document of requiredDocuments(audience)) {
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
  revalidatePath('/seller/profile');
}
