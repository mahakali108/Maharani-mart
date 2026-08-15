import Link from 'next/link';
import { Search, Store } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface RetailerRow {
  id: string;
  shop_name: string;
  address: string | null;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
}

interface RetailerCard extends RetailerRow {
  areaName: string | null;
  ownerName: string | null;
  phone: string | null;
}

const STATUS_STYLES: Record<RetailerRow['status'], string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  active: 'bg-green-50 text-green-700',
  suspended: 'bg-primary-50 text-primary-700',
};

export default async function SalesmanRetailersPage({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireUser();
  const supabase = createClient();
  const q = searchParams.q?.trim().toLowerCase() ?? '';

  // Keep retailers/profiles/areas as separate queries, matching the
  // proven-safe admin retailer implementation. The shared-primary-key
  // profiles relationship is intentionally not embedded through PostgREST.
  const { data: retailerData } = await supabase
    .from('retailers')
    .select('id, shop_name, address, area_id, status')
    .eq('assigned_salesman_id', user.id)
    .order('shop_name')
    .returns<RetailerRow[]>();

  const retailers = retailerData ?? [];
  const retailerIds = retailers.map((retailer) => retailer.id);
  const areaIds = [...new Set(retailers.map((retailer) => retailer.area_id))];
  const [{ data: profileData }, { data: areaData }] = await Promise.all([
    retailerIds.length
      ? supabase.from('profiles').select('id, full_name, phone').in('id', retailerIds)
      : Promise.resolve({ data: [] as unknown[] }),
    areaIds.length
      ? supabase.from('areas').select('id, name').in('id', areaIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const profileById = new Map(
    ((profileData ?? []) as unknown as { id: string; full_name: string; phone: string }[]).map((profile) => [profile.id, profile])
  );
  const areaById = new Map(
    ((areaData ?? []) as unknown as { id: string; name: string }[]).map((area) => [area.id, area.name])
  );

  let cards: RetailerCard[] = retailers.map((retailer) => ({
    ...retailer,
    areaName: areaById.get(retailer.area_id) ?? null,
    ownerName: profileById.get(retailer.id)?.full_name ?? null,
    phone: profileById.get(retailer.id)?.phone ?? null,
  }));

  if (q) {
    cards = cards.filter(
      (retailer) =>
        retailer.shop_name.toLowerCase().includes(q) ||
        retailer.ownerName?.toLowerCase().includes(q) ||
        retailer.phone?.includes(q) ||
        retailer.areaName?.toLowerCase().includes(q)
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">My Retailers</h1>
        <p className="mt-1 text-sm text-ink-500">Only retailers currently assigned to you are shown.</p>
      </div>

      <form method="get" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search shop, owner, phone, or area" className="pl-9" />
        </div>
        <Button type="submit" size="sm" variant="outline">Search</Button>
      </form>

      {cards.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Store className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">{q ? 'No assigned retailers match' : 'No retailers assigned yet'}</p>
          <p className="text-sm text-ink-400">{q ? 'Try a different search.' : 'Your admin can assign retailers from the retailer details screen.'}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((retailer) => (
            <Link key={retailer.id} href={`/salesman/retailers/${retailer.id}`}>
              <Card className="h-full p-4 transition-colors hover:border-primary-200">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{retailer.shop_name}</p>
                    <p className="text-xs text-ink-500">{retailer.ownerName ?? 'Owner name unavailable'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_STYLES[retailer.status]}`}>
                    {retailer.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-ink-400">
                  <p>{retailer.phone ?? 'Phone unavailable'}</p>
                  <p>{retailer.areaName ?? 'Area unavailable'}</p>
                  {retailer.address ? <p className="line-clamp-2">{retailer.address}</p> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
