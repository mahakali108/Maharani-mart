import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { legalDocumentByKey } from '@/lib/legal/documents';
import { SELLER_AGREEMENT_KEY } from '@/lib/seller/offer-gate';

export interface MarketplaceApprovalRow {
  id: string;
  enabled: boolean;
  ownerReference: string | null;
  caReference: string | null;
  reason: string | null;
  recordedBy: string;
  recordedByName: string | null;
  recordedAt: string;
}

export interface MarketplaceLaunchState {
  /** False when migration 0098 is not installed or the read failed. */
  available: boolean;
  /** Fails closed: false unless the database positively reports it open. */
  open: boolean;
  history: MarketplaceApprovalRow[];
  agreement: {
    /** Version this build publishes on /legal/seller-agreement. */
    buildVersion: string | null;
    /** Version the database currently enforces. */
    databaseVersion: string | null;
    publishedAt: string | null;
    inSync: boolean;
  };
}

/** Read-only state for the Super Admin marketplace screen. Never throws. */
export async function getMarketplaceLaunchState(): Promise<MarketplaceLaunchState> {
  const buildVersion = legalDocumentByKey(SELLER_AGREEMENT_KEY)?.version ?? null;
  const closed: MarketplaceLaunchState = {
    available: false,
    open: false,
    history: [],
    agreement: { buildVersion, databaseVersion: null, publishedAt: null, inSync: false },
  };
  try {
    const supabase = await createClient();
    // The switch is the newest row of the append-only log (no row = closed);
    // the same rule the database function third_party_offers_enabled() applies.
    const [historyResult, versionResult] = await Promise.all([
      supabase
        .from('marketplace_launch_approvals' as never)
        .select('id, third_party_offers_enabled, owner_approval_reference, ca_approval_reference, reason, recorded_by, recorded_at')
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(100)
        .returns<{
          id: string; third_party_offers_enabled: boolean; owner_approval_reference: string | null;
          ca_approval_reference: string | null; reason: string | null; recorded_by: string; recorded_at: string;
        }[]>(),
      supabase
        .from('legal_document_current_versions' as never)
        .select('document_version, published_at')
        .eq('document_key', SELLER_AGREEMENT_KEY)
        .maybeSingle<{ document_version: string; published_at: string }>(),
    ]);
    if (historyResult.error || versionResult.error) return closed;

    const rows = historyResult.data ?? [];
    const names = new Map<string, string | null>();
    const ids = [...new Set(rows.map((row) => row.recorded_by))];
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids)
        .returns<{ id: string; full_name: string | null }[]>();
      for (const profile of profiles ?? []) names.set(profile.id, profile.full_name);
    }

    const databaseVersion = versionResult.data?.document_version ?? null;
    return {
      available: true,
      open: rows[0]?.third_party_offers_enabled === true,
      history: rows.map((row) => ({
        id: row.id,
        enabled: row.third_party_offers_enabled,
        ownerReference: row.owner_approval_reference,
        caReference: row.ca_approval_reference,
        reason: row.reason,
        recordedBy: row.recorded_by,
        recordedByName: names.get(row.recorded_by) ?? null,
        recordedAt: row.recorded_at,
      })),
      agreement: {
        buildVersion,
        databaseVersion,
        publishedAt: versionResult.data?.published_at ?? null,
        inSync: buildVersion !== null && buildVersion === databaseVersion,
      },
    };
  } catch {
    return closed;
  }
}
