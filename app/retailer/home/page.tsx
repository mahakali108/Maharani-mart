import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
}

export default async function RetailerHomePage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  // banners_read RLS (0001_init.sql) already limits this to is_active
  // rows for non-staff roles; the area and date-window filters here
  // are just which of those active banners are relevant right now.
  const nowIso = new Date().toISOString();
  const { data: bannerRows } = await supabase
    .from('banners')
    .select('id, title, image_url, link_url, area_id, starts_at, ends_at')
    .eq('is_active', true)
    .order('sort_order');

  const banners = ((bannerRows ?? []) as unknown as (BannerRow & {
    area_id: string | null;
    starts_at: string | null;
    ends_at: string | null;
  })[]).filter((b) => {
    const areaMatches = !b.area_id || b.area_id === retailer?.area_id;
    const started = !b.starts_at || b.starts_at <= nowIso;
    const notEnded = !b.ends_at || b.ends_at >= nowIso;
    return areaMatches && started && notEnded;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Welcome</h1>
        <p className="mt-1 text-sm text-ink-500">New launches, schemes, and offers for your shop.</p>
      </div>

      {banners.length > 0 ? (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {banners.map((b) =>
            b.link_url ? (
              <a
                key={b.id}
                href={b.link_url}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-[2/1] w-full max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl border border-ink-100"
              >
                <Image src={b.image_url} alt={b.title} fill className="object-cover" unoptimized />
              </a>
            ) : (
              <div
                key={b.id}
                className="relative aspect-[2/1] w-full max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl border border-ink-100"
              >
                <Image src={b.image_url} alt={b.title} fill className="object-cover" unoptimized />
              </div>
            )
          )}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Catalog coming soon</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          Your distributor is setting up the product catalog. Check back shortly, or contact your
          assigned salesman for updates.
        </p>
      </Card>
    </div>
  );
}
