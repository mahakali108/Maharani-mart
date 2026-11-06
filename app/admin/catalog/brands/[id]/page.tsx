import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandEditForm } from '@/components/admin/brand-edit-form';

interface BrandDetail {
  id: string;
  name: string;
  logo_url: string | null;
}

export default async function EditBrandPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const supabase = (await createClient());
  const { data: brand, error: brandError } = await supabase.from('brands').select('id, name, logo_url').eq('id', params.id).single<BrandDetail>();

  // `.single()` also fails when the row is missing (PGRST116); a broken read
  // must not be reported to the operator as a deleted brand.
  throwIfReadFailed(brandError, 'Brand');
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
        <BrandEditForm brandId={brand!.id} name={brand!.name} logoUrl={brand!.logo_url} />
      </Card>
    </div>
  );
}
