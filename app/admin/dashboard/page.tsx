import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { gatherDashboardData } from '@/lib/admin/dashboard/data';
import { parseDashboardRange } from '@/lib/admin/dashboard/range';
import { dashboardVisibility } from '@/lib/admin/dashboard/visibility';
import { DashboardView } from '@/components/admin/dashboard-view';

export const dynamic = 'force-dynamic';

/**
 * Admin Dashboard — operational KPIs for admin + super_admin.
 *
 * Authorization:
 *   1. middleware.ts restricts /admin/* to super_admin/admin
 *   2. requirePermission('dashboard.view')
 *   3. Section visibility uses the existing permission matrix
 *   4. All reads go through the cookie-bound RLS client (never service role)
 *
 * Numbers come only from real tables. Empty/unavailable sections render
 * honest states — never placeholder business records.
 */
export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const user = await requirePermission('dashboard.view');
  const visibility = dashboardVisibility(user.role);
  const range = parseDashboardRange(searchParams);
  const supabase = createClient();
  const data = await gatherDashboardData(supabase, range);

  return <DashboardView data={data} visibility={visibility} />;
}
