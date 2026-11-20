import Link from 'next/link';
import type { Database } from '@/types/database.types';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';
import { recordBrand } from './actions';

type Revision = Database['public']['Tables']['storefront_brand_versions']['Row'];
const pageSize = 50;

export default async function BrandingPage({ searchParams }: { searchParams: Promise<{ before?: string; verify?: string }> }) {
  await requireSuperAdminPage();
  const { before, verify } = await searchParams;
  const cursor = Number(before);
  const db = await createClient();
  let history = db.from('storefront_brand_versions').select('*').order('id', { ascending: false });
  if (Number.isSafeInteger(cursor) && cursor > 0) history = history.lt('id', cursor);
  const [page, current] = await Promise.all([
    history.limit(pageSize + 1).returns<Revision[]>(),
    db.from('storefront_brand_versions').select('*').eq('stage', 'published').order('id', { ascending: false }).limit(1).returns<Revision[]>(),
  ]);
  const live = current.data?.[0];
  const rows = (page.data ?? []).slice(0, pageSize);
  const readOnly = verify === '1';
  return <main className="mx-auto max-w-3xl space-y-6 p-4">
    <header><p className="text-sm font-semibold text-primary-700">Storefront settings</p><h1 className="text-3xl font-bold">Branding studio</h1>
      <p>Manage the name and introduction on the retailer home. Invoice and legal details do not change.</p></header>
    {readOnly && <p role="alert">The save could not be confirmed. Refresh publication history and verify the current revision before retrying. <Link href="/admin/branding" className="underline">Refresh history</Link></p>}
    {page.error || current.error ? <p role="alert">Branding storage unavailable. Changes cannot be saved.</p> : <>
      <section aria-label="Current publication" className="break-words rounded-xl border p-4"><h2 className="font-bold">Currently published</h2>
        {live ? <p>Revision #{live.id}: {live.display_name} — {live.tagline}</p> : <p>No publication yet. The default branding is in use.</p>}</section>
      {!readOnly && <form action={recordBrand} className="grid gap-4 rounded-xl border bg-white p-5">
        <label>Display name<input name="name" required maxLength={64} defaultValue={live?.display_name ?? BRAND.name} className="block w-full rounded border p-2" /></label>
        <label>Tagline<input name="tagline" required maxLength={140} defaultValue={live?.tagline ?? BRAND.tagline} className="block w-full rounded border p-2" /></label>
        <button className="min-h-11 rounded-lg bg-shopping-800 text-white">Save draft</button>
      </form>}
      <h2 className="text-xl font-semibold">Revision previews &amp; history</h2>
      {!rows.length && <p>No revisions on this page.</p>}
      {rows.map(v => <article key={v.id} className="space-y-2 rounded-xl border bg-white p-4">
        <p className="break-words text-xs">#{v.id} · {v.operation === 'restore' ? 'Restored' : v.stage === 'draft' ? 'Draft' : 'Published'} · {v.created_at} · {v.actor}{v.source_id && ` · from #${v.source_id}`}</p>
        <h3 className="break-words text-xl font-semibold">{v.display_name}</h3><p className="break-words">{v.tagline}</p>
        {!readOnly && live?.id !== v.id && <form action={recordBrand}><input type="hidden" name="expected" value={live?.id ?? ''}/><input type="hidden" name="revision" value={v.id}/><button className="min-h-11 font-semibold text-shopping-800">{v.stage === 'draft' ? 'Publish draft' : 'Restore publication'} #{v.id}</button></form>}
      </article>)}
      <nav aria-label="Revision history pages" className="flex flex-wrap gap-4 underline">
        {before && <Link href="/admin/branding">Latest revisions</Link>}
        {(page.data?.length ?? 0) > pageSize && <Link href={`/admin/branding?before=${rows[pageSize-1]!.id}${readOnly ? '&verify=1' : ''}`}>Older revisions</Link>}
      </nav>
    </>}
  </main>;
}
