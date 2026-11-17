import 'server-only';
import type { createClient } from '@/lib/supabase/server';

export interface SuperAdminAuditEntry {
  actorId: string;
  actorRole: string;
  action: string;
  /** Must be a real profiles.id UUID (FK to profiles), or null for non-profile entities. */
  targetProfileId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  reason?: string | null;
}

/**
 * Writes an append-only row into `super_admin_audit_logs` when the caller is
 * `super_admin`. Non-blocking on audit insert errors so audited domain writes
 * still commit while primary table triggers (`log_audit`) maintain DB audit
 * history unconditionally.
 */
export async function recordSuperAdminAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entry: SuperAdminAuditEntry
): Promise<void> {
  if (entry.actorRole !== 'super_admin') return;
  try {
    await supabase.from('super_admin_audit_logs' as never).insert({
      actor_id: entry.actorId,
      target_id: entry.targetProfileId ?? null,
      action: entry.action,
      before_data: entry.beforeData ?? null,
      after_data: entry.afterData ?? null,
      reason: entry.reason ?? null,
    } as never);
  } catch {
    // Non-blocking: DB triggers on business tables still record audit_logs.
  }
}
