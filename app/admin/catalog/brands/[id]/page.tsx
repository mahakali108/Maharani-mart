import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandEditForm } from '@/components/admin/brand-edit-form';

interface BrandDetail {
  id: string;
  name: string;
}

export default async function EditBrandPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: brand } = await supabase.from('brands').select('id, name').eq('id', params.id).single<BrandDetail>();

  if (!brand) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit brand</h1>
        <p className="mt-1 text-sm text-ink-500">{brand!.name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Brand details</CardTitle>
        </CardHeader>
        <BrandEditForm brandId={brand!.id} name={brand!.name} />
      </Card>
    </div>
  );
}
