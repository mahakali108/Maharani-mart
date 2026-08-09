import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { BannerEditForm } from '@/components/admin/banner-edit-form';

interface BannerDetail {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  area_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export default async function EditBannerPage({ params }: { params: { id: string } }) {
  await requirePermission('banners.manage');

  const supabase = createClient();
  const [{ data: banner }, { data: areas }] = await Promise.all([
    supabase
      .from('banners')
      .select('id, title, image_url, link_url, area_id, starts_at, ends_at')
      .eq('id', params.id)
      .maybeSingle<BannerDetail>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
  ]);

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
          imageUrl={banner.image_url}
          linkUrl={banner.link_url}
          areaId={banner.area_id}
          startsAt={banner.starts_at}
          endsAt={banner.ends_at}
          areas={areas ?? []}
        />
      </Card>
    </div>
  );
}
