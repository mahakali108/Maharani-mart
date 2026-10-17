import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { getSignedUrl } from '@/lib/storage/signed-url';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/admin/status-badge';
import { SupplierReviewActions } from '@/components/admin/supplier-review-actions';
import { SupplierDocumentsManager, type SupplierDocument } from '@/components/admin/supplier-documents-manager';

export const dynamic = 'force-dynamic';

interface SupplierDetail {
  id: string;
  business_name: string;
  legal_name: string | null;
  contact_name: string;
  phone: string;
  email: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  gstin_verified: boolean;
  product_categories: string | null;
  status: string;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface DocRow {
  id: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  created_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Single supplier application — review, decision and private documents.
 * Same authorization as the queue (`suppliers.review` + RLS); document
 * downloads are signed URLs minted per-request for this reviewer only.
 */
export default async function SupplierApplicationDetailPage({ params }: { params: { id: string } }) {
  await requirePagePermission('suppliers.review');
  if (!UUID_RE.test(params.id)) notFound();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('suppliers' as never)
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (error || !data) notFound();
  const s = data as unknown as SupplierDetail;

  // Possible-duplicate warning (NOT a block): phone/email is contact data,
  // not a proven business identity — one business may legitimately share a
  // phone or accountant's email, and branches may differ. No unique index
  // is imposed on approved suppliers (see proposal); a human compares.
  const { data: dupeData } = await supabase
    .from('suppliers' as never)
    .select('id, business_name, status')
    .neq('id', s.id)
    .or(
      `phone.eq.${s.phone.replace(/[^0-9]/g, '')}` +
        (s.email ? `,email.eq.${s.email.replace(/[,()]/g, '')}` : '') +
        (s.gstin ? `,gstin.eq.${s.gstin.replace(/[^A-Z0-9]/g, '')}` : '')
    )
    .in('status', ['pending', 'approved'])
    .limit(5);
  const possibleDuplicates = (dupeData ?? []) as unknown as { id: string; business_name: string; status: string }[];

  const { data: docData } = await supabase
    .from('supplier_documents' as never)
    .select('id, doc_type, file_name, file_url, created_at')
    .eq('supplier_id', s.id)
    .order('created_at', { ascending: false });
  const documents: SupplierDocument[] = await Promise.all(
    ((docData ?? []) as unknown as DocRow[]).map(async (d) => ({
      id: d.id,
      doc_type: d.doc_type,
      file_name: d.file_name,
      created_at: d.created_at,
      signedUrl: await getSignedUrl('supplier-documents', d.file_url, 3600),
    }))
  );

  const fields: [string, string][] = [
    ['Business name', s.business_name],
    ['Legal name', s.legal_name ?? '—'],
    ['Contact person', s.contact_name],
    ['Phone', s.phone],
    ['Email', s.email ?? '—'],
    ['Address', [s.address_line, s.city, s.state, s.pincode].filter(Boolean).join(', ') || '—'],
    ['GSTIN (applicant-declared)', s.gstin ? `${s.gstin}${s.gstin_verified ? ' (documents checked by reviewer)' : ' (not verified)'}` : 'Not provided'],
    ['Supplies', s.product_categories ?? '—'],
    ['Applied', formatIndiaDateTime(s.created_at)],
    ['Reviewed', s.reviewed_at ? formatIndiaDateTime(s.reviewed_at) : '—'],
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/suppliers/applications" className="inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to applications
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink-950">{s.business_name}</h1>
        <StatusBadge status={s.status} />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Application details</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{k}</dt>
              <dd className="mt-0.5 text-sm text-ink-800">{v}</dd>
            </div>
          ))}
        </dl>
        {s.status === 'rejected' && s.rejection_reason ? (
          <p className="mt-4 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-700">
            Rejection reason: {s.rejection_reason}
          </p>
        ) : null}
      </Card>

      {possibleDuplicates.length > 0 ? (
        <Card role="alert" className="border-peach-200 bg-peach-50">
          <h2 className="text-sm font-semibold text-ink-900">Possible duplicate supplier</h2>
          <p className="mt-1 text-sm text-ink-600">
            Another application/supplier shares this phone, email or GSTIN. Phone/email alone does not prove
            it is the same business — compare before approving:
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-700">
            {possibleDuplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/suppliers/applications/${d.id}`} className="font-medium text-primary-700 hover:underline">
                  {d.business_name}
                </Link>{' '}
                ({d.status})
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {s.status === 'pending' ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Review decision</h2>
          <SupplierReviewActions supplierId={s.id} />
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Verification documents</h2>
        <p className="mb-3 text-xs text-ink-500">
          Uploaded by Maharani reviewers after receiving documents from the applicant. Stored privately;
          downloads are short-lived signed links. Uploading a GSTIN certificate does not by itself mark the
          GSTIN verified.
        </p>
        <SupplierDocumentsManager supplierId={s.id} documents={documents} />
      </Card>
    </div>
  );
}
