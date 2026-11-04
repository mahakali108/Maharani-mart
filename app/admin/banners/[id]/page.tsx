import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePagePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { BannerEditForm } from '@/components/admin/banner-edit-form';

interface BannerDetail {
  id: string;
  title: string;
  subtitle?: string | null;
  cta_label?: string | null;
  image_url: string;
  image_url_mobile: string | null;
  status: 'draft' | 'published';
  link_url: string | null;
  area_id: string | null;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
}

export default async function EditBannerPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  await requirePagePermission('banners.manage');

  const supabase = (await createClient());
  const [{ data: banner, error: bannerError }, { data: areas }] = await Promise.all([
    supabase
      .from('banners')
      .select('*')
      .eq('id', params.id)
      .maybeSingle<BannerDetail>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
  ]);

  // A failed read is not a missing banner. `maybeSingle()` returns null data
  // for BOTH, and 404-ing on a query error told the operator the banner had
  // been deleted. Only a successful read with no row is a real 404.
  if (bannerError) {
    throw new Error(`Banner ${params.id} could not be loaded: ${bannerError.message}`);
  }
  if (!banner) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit banner</h1>
        <p className="mt-1 text-sm text-ink-500">{banner.title}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Banner details</CardTitle>
        </CardHeader>
        <BannerEditForm
          bannerId={banner.id}
          title={banner.title}
          subtitle={banner.subtitle}
          ctaLabel={banner.cta_label}
          imageUrl={banner.image_url}
          imageUrlMobile={banner.image_url_mobile}
          status={banner.status}
          linkUrl={banner.link_url}
          areaId={banner.area_id}
          sortOrder={banner.sort_order}
          startsAt={banner.starts_at}
          endsAt={banner.ends_at}
          areas={areas ?? []}
        />
      </Card>
    </div>
  );
}
