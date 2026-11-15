'use server';

/**
 * Super Admin marketplace launch controls.
 *
 * These actions are a thin, validated front for two database functions from
 * migration 0098. They run under the Super Admin's OWN session — never the
 * service role — so the database's own checks (Super Admin only, two distinct
 * non-placeholder approval references, append-only log) always apply. The UI
 * cannot open the marketplace in any way the database would refuse.
 *
 * Nothing here supplies an approval reference: both are typed by the Super
 * Admin from documents the owner and the Chartered Accountant actually gave.
 */

import { revalidatePath } from 'next/cache';

import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { legalDocumentByKey } from '@/lib/legal/documents';
import { SELLER_AGREEMENT_KEY } from '@/lib/seller/offer-gate';
import { createClient } from '@/lib/supabase/server';

import { mapMarketplaceDecisionError, validateMarketplaceDecision } from './validation';

export type MarketplaceActionState = { error?: string; success?: string } | null;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function revalidate() {
  revalidatePath('/admin/marketplace-launch');
  revalidatePath('/admin/control-center');
  revalidatePath('/admin/offers');
  revalidatePath('/seller/dashboard');
  revalidatePath('/seller/offers');
  revalidatePath('/seller/profile');
}

export async function recordMarketplaceDecisionAction(
  _previous: MarketplaceActionState,
  formData: FormData
): Promise<MarketplaceActionState> {
  try {
    await requireSuperAdmin();
  } catch {
    return { error: 'Only a Super Admin can change this. Nothing was changed.' };
  }

  const decision = formData.get('decision');
  if (decision !== 'enable' && decision !== 'disable') {
    return { error: 'Choose whether third-party seller offers are enabled or disabled.' };
  }
  const checked = validateMarketplaceDecision({
    enable: decision === 'enable',
    ownerReference: String(formData.get('owner_reference') ?? ''),
    caReference: String(formData.get('ca_reference') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    confirmation: String(formData.get('confirmation') ?? ''),
  });
  if (!checked.ok) return { error: checked.error };

  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as RpcClient).rpc('record_marketplace_launch_approval', {
    p_enabled: checked.value.enable,
    p_owner_approval_reference: checked.value.ownerReference,
    p_ca_approval_reference: checked.value.caReference,
    p_reason: checked.value.reason,
  });
  if (error) return { error: mapMarketplaceDecisionError(error.message) };
  if (typeof data !== 'string' || data.length === 0) {
    // No confirmation that a history row was written: report nothing as done.
    return { error: mapMarketplaceDecisionError(null) };
  }

  revalidate();
  return {
    success: checked.value.enable
      ? 'Recorded. Third-party seller offers are now enabled. Each seller must still accept the current Seller Agreement before an offer can go live.'
      : 'Recorded. Third-party seller offers are now disabled. No new seller offer can go live and seller stock cannot be added to new orders.',
  };
}

/**
 * Makes the Seller Agreement version that THIS build publishes the version
 * the database enforces. The version is read from the server-side registry,
 * never from the form, so a version whose text does not exist cannot be
 * published. Every seller must then accept that version again.
 */
export async function publishSellerAgreementVersionAction(
  _previous: MarketplaceActionState,
  formData: FormData
): Promise<MarketplaceActionState> {
  try {
    await requireSuperAdmin();
  } catch {
    return { error: 'Only a Super Admin can change this. Nothing was changed.' };
  }
  if (formData.get('confirm') !== 'on') {
    return { error: 'Tick the box to confirm you have read the agreement text that will be enforced.' };
  }
  const document = legalDocumentByKey(SELLER_AGREEMENT_KEY);
  if (!document) return { error: 'The Seller Agreement is not in the legal register of this build. Nothing was changed.' };

  const supabase = await createClient();
  const { error } = await (supabase as unknown as RpcClient).rpc('publish_legal_document_version', {
    p_document_key: SELLER_AGREEMENT_KEY,
    p_document_version: document.version,
  });
  if (error) return { error: mapMarketplaceDecisionError(error.message) };

  // Confirm the database now enforces that version before reporting success.
  const { data: row } = await supabase
    .from('legal_document_current_versions' as never)
    .select('document_version')
    .eq('document_key', SELLER_AGREEMENT_KEY)
    .maybeSingle<{ document_version: string }>();
  if (row?.document_version !== document.version) {
    return { error: 'The version could not be confirmed after saving. Refresh and check before relying on it.' };
  }

  revalidate();
  return {
    success: `Seller Agreement version ${document.version} is now the enforced version. Sellers who accepted an earlier version must accept this one before their offers can go live.`,
  };
}
