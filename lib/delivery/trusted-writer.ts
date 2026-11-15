import 'server-only';

import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Trusted writer for delivery fields that migration 0094 closes to ordinary
 * staff sessions (OTP hash, assignment, proof, completion, order → delivered).
 *
 * The database rejects those writes from a non-admin `authenticated` session,
 * so that a delivery person cannot complete a delivery through the Data API
 * without the retailer's OTP. A server action may use this writer ONLY after
 * it has (1) authenticated the user, (2) checked the permission, (3) checked
 * the user is the assignee or an admin, and (4) where relevant verified the
 * OTP. Every write must be filtered by the exact row id and expected status.
 *
 * Admin and Super Admin sessions are trusted by the same database guard and
 * keep using their own session, so the audit log records them as the actor.
 */
export function createTrustedDeliveryWriter(): ReturnType<typeof createServiceRoleClient> | null {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    return null;
  }
  return createServiceRoleClient();
}

export const TRUSTED_WRITER_UNAVAILABLE =
  'Delivery verification is not configured on the server. Ask an administrator to complete this step.';
