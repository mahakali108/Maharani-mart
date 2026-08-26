import { Gauge, ShieldCheck } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { isCommandCenterTab, type SalesIntelFilters } from '@/lib/admin/command-center/types';
import { gatherCommandCenterData, parseSalesIntelFilters } from '@/lib/admin/command-center/data';
import { CommandCenterTabNav } from '@/components/command-center/tab-nav';
import { OverviewSection } from '@/components/command-center/overview-section';
import { SalesSection, type SalesOptions } from '@/components/command-center/sales-section';
import { InventorySection } from '@/components/command-center/inventory-section';
import { CreditSection } from '@/components/command-center/credit-section';
import { RetailerSection } from '@/components/command-center/retailer-section';
import { SalesmanSection } from '@/components/command-center/salesman-section';
import { SupplierSection } from '@/components/command-center/supplier-section';
import { SecuritySection } from '@/components/command-center/security-section';
import { CopilotTab } from '@/components/command-center/copilot-tab';

export const dynamic = 'force-dynamic';

/**
 * Super Admin Command Center.
 *
 * Authorization (defense-in-depth, each layer independent):
 *   1. middleware.ts — /admin/* is only reachable by super_admin/admin roles.
 *   2. requirePermission('command_center.view') — a permission granted to
 *      super_admin ONLY (lib/permissions/permissions.ts), so a normal admin
 *      is rejected here.
 *   3. Data access — the page reads exclusively through the caller's
 *      RLS-scoped Supabase client; Postgres RLS is the final enforcement
 *      boundary and is unchanged.
 *   4. AI copilot — executive tools are registered for the super_admin role
 *      only and are READ-only (see lib/ai/tools/super-admin.ts).
 */
export default async function CommandCenterPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requirePermission('command_center.view');

  const rawTab = typeof searchParams.tab === 'string' ? searchParams.tab : undefined;
  const tab = isCommandCenterTab(rawTab) ? rawTab : 'overview';
  const salesValidation = parseSalesIntelFilters({
    from: typeof searchParams.from === 'string' ? searchParams.from : undefined,
    to: typeof searchParams.to === 'string' ? searchParams.to : undefined,
    category: typeof searchParams.category === 'string' ? searchParams.category : undefined,
    brand: typeof searchParams.brand === 'string' ? searchParams.brand : undefined,
    product: typeof searchParams.product === 'string' ? searchParams.product : undefined,
    retailer: typeof searchParams.retailer === 'string' ? searchParams.retailer : undefined,
    salesman: typeof searchParams.salesman === 'string' ? searchParams.salesman : undefined,
  });
  const salesFilters: SalesIntelFilters = salesValidation.filters;

  const supabase = createClient();

  const [data, options] = await Promise.all([
    gatherCommandCenterData(supabase, { salesFilters }),
    gatherSalesOptions(supabase),
  ]);

  const urgentCount = data.actions.filter((a) => a.severity === 'urgent').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
              <Gauge className="h-5 w-5 text-white" />
            </span>
            <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Super Admin Command Center</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Real data only · Super Admin authorization enforced at route, permission and RLS layers
          </p>
        </div>
      </div>

      <CommandCenterTabNav active={tab} urgentCount={urgentCount} />

      {tab === 'overview' ? <OverviewSection data={data} /> : null}
      {tab === 'sales' ? <SalesSection intel={data.salesIntel} filters={salesFilters} options={options} /> : null}
      {tab === 'inventory' ? <InventorySection intel={data.inventory} /> : null}
      {tab === 'credit' ? <CreditSection credit={data.credit} /> : null}
      {tab === 'retailers' ? <RetailerSection intel={data.retailers} /> : null}
      {tab === 'salesmen' ? <SalesmanSection intel={data.salesmen} /> : null}
      {tab === 'suppliers' ? <SupplierSection intel={data.suppliers} /> : null}
      {tab === 'security' ? <SecuritySection security={data.security} /> : null}
      {tab === 'copilot' ? <CopilotTab /> : null}
    </div>
  );
}

/** Filter dropdown options for the Sales Intelligence tab (bounded). */
async function gatherSalesOptions(supabase: ReturnType<typeof createClient>): Promise<SalesOptions> {
  const [brands, categories, products, retailers, salesmen] = await Promise.all([
    supabase.from('brands').select('id, name').eq('is_active', true).order('name').limit(300),
    supabase.from('categories').select('id, name').eq('is_active', true).order('name').limit(300),
    supabase.from('products').select('id, name, sku_code').eq('is_active', true).order('name').limit(300),
    supabase.from('retailers').select('id, shop_name').neq('status', 'pending_approval').order('shop_name').limit(300),
    supabase.from('profiles').select('id, full_name').eq('role', 'salesman').eq('is_active', true).order('full_name').limit(100),
  ]);
  return {
    brands: (brands.data ?? []) as { id: string; name: string }[],
    categories: (categories.data ?? []) as { id: string; name: string }[],
    products: ((products.data ?? []) as { id: string; name: string; sku_code: string }[]).map((p) => ({ id: p.id, name: p.name, sku: p.sku_code })),
    retailers: ((retailers.data ?? []) as { id: string; shop_name: string }[]).map((r) => ({ id: r.id, shopName: r.shop_name })),
    salesmen: (salesmen.data ?? []) as { id: string; name: string }[],
  };
}
