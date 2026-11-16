import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePagePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { BannerForm } from '@/components/admin/banner-form';
import { BannerRowActions } from '@/components/admin/banner-row-actions';
import { formatIndiaDateTime } from '@/lib/datetime/india';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  image_url_mobile: string | null;
  status: 'draft' | 'published';
  link_url: string | null;
  area_id: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export default async function BannersPage() {
  await requirePagePermission('banners.manage');
  const supabase = (await createClient());

  // Separate queries rather than an embed — same reasoning as the fix
  // in app/admin/retailers/page.tsx.
  const [{ data: bannerRows, error: bannerError }, { data: areaRows }] = await Promise.all([
    supabase
      .from('banners')
      .select('id, title, image_url, image_url_mobile, status, link_url, area_id, sort_order, is_active, starts_at, ends_at')
      .order('sort_order')
      .order('id'),
    supabase.from('areas').select('id, name'),
  ]);

  const banners = (bannerRows ?? []) as unknown as BannerRow[];
  const areaById = new Map(((areaRows ?? []) as unknown as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Banners</h1>
          <p className="mt-1 text-sm text-ink-500">
            Promotional banners shown at the top of the retailer home screen.
          </p>
        </div>
        <Link
          href="/admin/banners/campaigns"
          className="text-sm font-medium text-primary-700 hover:underline"
        >
          Paid Seller Ad Campaigns (Super Admin) →
        </Link>
      </div>

      {bannerError ? (
        /* A failed read must never be rendered as "No banners yet": an empty
           list and a broken query look identical to the operator otherwise.
           The most likely cause for this exact select is a schema that is
           behind the application (42703 for `status` / `image_url_mobile`,
           both added by migration 0074), so the notice says so explicitly. */
        <Card className="border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-ink-900">Banners could not be loaded</p>
          <p className="mt-1 text-sm text-ink-600">
            The list below is empty because the query failed, not because there are no banners.
            Check that migration 0074 (banner <code>status</code> and <code>image_url_mobile</code>)
            has been applied to this project, then retry.
          </p>
          <p className="mt-2 font-mono text-xs text-ink-500">{bannerError.message}</p>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a new banner</CardTitle>
        </CardHeader>
        <BannerForm areas={areaRows ?? []} priority={banners.length * 10} />
      </Card>

      {banners.length === 0 ? (
        bannerError ? null : (
          <AdminEmptyState
            icon={ImageIcon}
            title="No banners yet"
            body="Add your first banner above — it'll appear on the retailer home screen once active."
          />
        )
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Preview</th>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Area</th>
                <th className="px-5 py-3 font-medium">Priority</th>
                <th className="px-5 py-3 font-medium">Schedule (IST)</th>
                <th className="px-5 py-3 font-medium">Visibility</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {banners.map((b, index) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <div className="relative h-10 w-20 overflow-hidden rounded-lg border border-ink-100">
                      <Image src={b.image_url} alt="" fill className="object-cover" unoptimized />
                    </div>
                  </td>
                  <td className="px-5 py-3 font-medium text-ink-900">
                    {b.link_url ? (
                      <a href={b.link_url} target="_blank" rel="noreferrer" className="hover:text-primary-600">
                        {b.title}
                      </a>
                    ) : (
                      b.title
                    )}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{b.area_id ? areaById.get(b.area_id) ?? '—' : 'All areas'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-500">{b.sort_order}</td>
                  <td className="px-5 py-3 text-xs text-ink-500">
                    {b.starts_at ? formatIndiaDateTime(b.starts_at) : 'Any time'}
                    {b.ends_at ? ` – ${formatIndiaDateTime(b.ends_at)}` : ''}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          b.status === 'published' ? 'bg-primary-50 text-primary-700' : 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {b.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          b.is_active ? 'bg-mint-50 text-mint-700' : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {b.is_active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <BannerRowActions
                      bannerId={b.id}
                      isActive={b.is_active}
                      status={b.status}
                      isFirst={index === 0}
                      isLast={index === banners.length - 1}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
