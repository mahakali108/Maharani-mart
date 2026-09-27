import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getStorageUsageReport } from '@/lib/storage/usage';
import type { UserRole } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

/**
 * Admin-only Supabase Storage usage report (monitoring only).
 *
 * GET /api/admin/storage-report
 *
 * Read-only. Never deletes or migrates anything. Gated to super_admin/admin
 * by checking the Supabase session + role on every request.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single<{ role: UserRole; is_active: boolean }>();

  // Deactivated admins are refused here too: this route reads storage usage
  // with the service role, so the database's is_active checks do not apply.
  if (!profile || profile.is_active !== true || (profile.role !== 'super_admin' && profile.role !== 'admin')) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  }

  const report = await getStorageUsageReport();
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
