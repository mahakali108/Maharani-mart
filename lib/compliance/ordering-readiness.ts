import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  businessProfileSchema,
  contactGrievanceSchema,
  ORDERING_READINESS_CATEGORY_KEYS,
  orderingReadinessConfigSchema,
} from '@/lib/admin/business-settings/types';

export const ORDERING_NOT_ENABLED_MESSAGE =
  'Ordering is not enabled because mandatory business compliance configuration is incomplete.';

const ORDERING_READINESS_SETTING_KEY = 'ordering_launch_readiness';
const REQUIRED_SETTING_KEYS = [
  'business_profile',
  'contact_grievance',
  ORDERING_READINESS_SETTING_KEY,
] as const;

type RequiredSettingKey = (typeof REQUIRED_SETTING_KEYS)[number];

interface SettingRow {
  key: string;
  value: unknown;
}

function isSettingRow(value: unknown): value is SettingRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as { key?: unknown }).key === 'string' && 'value' in value;
}

/**
 * Pure, fail-closed verifier for the protected settings rows. It deliberately
 * returns only a boolean: callers must never receive approval references,
 * business details, or a category-by-category explanation.
 */
export function orderingIsReadyFromSettingsRows(rows: unknown, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  if (!Array.isArray(rows) || rows.length !== REQUIRED_SETTING_KEYS.length || !rows.every(isSettingRow)) return false;

  const settings = new Map<string, unknown>();
  for (const row of rows) {
    if (!REQUIRED_SETTING_KEYS.includes(row.key as RequiredSettingKey) || settings.has(row.key)) return false;
    settings.set(row.key, row.value);
  }
  if (settings.size !== REQUIRED_SETTING_KEYS.length) return false;

  const business = businessProfileSchema.safeParse(settings.get('business_profile'));
  if (!business.success || business.data.verificationStatus !== 'verified') return false;

  const contacts = contactGrievanceSchema.safeParse(settings.get('contact_grievance'));
  if (!contacts.success || contacts.data.isConfigured !== true) return false;

  const readiness = orderingReadinessConfigSchema.safeParse(settings.get(ORDERING_READINESS_SETTING_KEY));
  if (!readiness.success) return false;

  const recordedAtMs = Date.parse(readiness.data.recordedAt);
  const validUntilMs = Date.parse(readiness.data.approvalValidityPolicy.validUntil);
  // A policy is explicit rather than defaulted. The record cannot be dated in
  // the future, cannot outlive its policy, and stops authorizing new orders at
  // the exact configured expiry instant.
  if (!Number.isFinite(recordedAtMs) || !Number.isFinite(validUntilMs)) return false;
  if (recordedAtMs > nowMs || validUntilMs < recordedAtMs || validUntilMs <= nowMs) return false;

  return ORDERING_READINESS_CATEGORY_KEYS.every((category) => readiness.data[category].status === 'approved');
}

type ProtectedSettingsRead = { data: unknown; error: unknown | null };
type ProtectedSettingsReader = () => Promise<ProtectedSettingsRead>;

async function readProtectedOrderingSettings(): Promise<ProtectedSettingsRead> {
  const supabase = createServiceRoleClient() as unknown as {
    from: (table: 'platform_settings') => {
      select: (columns: 'key, value') => {
        in: (column: 'key', values: readonly string[]) => Promise<ProtectedSettingsRead>;
      };
    };
  };
  return supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', REQUIRED_SETTING_KEYS);
}

/**
 * Central server-side launch gate. The service-role read is confined to this
 * server-only module because retailer-scoped sessions cannot read protected
 * platform settings. A missing row, a database error, or any parser failure
 * is indistinguishable to callers and blocks ordering.
 *
 * The optional reader exists solely for server-side tests; order callers never
 * receive a setting value or supply this dependency.
 */
export async function isOrderingReady(readSettings: ProtectedSettingsReader = readProtectedOrderingSettings): Promise<boolean> {
  try {
    const { data, error } = await readSettings();
    if (error) return false;
    return orderingIsReadyFromSettingsRows(data);
  } catch {
    return false;
  }
}
