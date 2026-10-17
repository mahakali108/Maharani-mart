'use client';

import { useState, useTransition } from 'react';
import { FileText, Download } from 'lucide-react';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { addSupplierDocumentAction } from '@/lib/admin/supplier-actions';
import { SUPPLIER_DOC_TYPES } from '@/lib/admin/supplier-application';
import { Select } from '@/components/ui/select';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export interface SupplierDocument {
  id: string;
  doc_type: string;
  file_name: string;
  created_at: string;
  signedUrl: string | null;
}

/**
 * Staff-managed supplier documents (V1). Uploads go through the media
 * pipeline into the PRIVATE `supplier-documents` bucket; only signed URLs
 * minted server-side for reviewers ever reach the browser.
 */
export function SupplierDocumentsManager({
  supplierId,
  documents,
}: {
  supplierId: string;
  documents: SupplierDocument[];
}) {
  const [docType, setDocType] = useState<string>('gstin_certificate');
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <p className="text-sm text-ink-500">No documents uploaded yet. Upload only documents received from the applicant.</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{doc.file_name}</p>
                  <p className="text-xs text-ink-400">
                    {SUPPLIER_DOC_TYPES.find((t) => t.value === doc.doc_type)?.label ?? doc.doc_type} ·{' '}
                    {formatIndiaDateTime(doc.created_at)}
                  </p>
                </div>
              </div>
              {doc.signedUrl ? (
                <a
                  href={doc.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                  aria-label={`Download ${doc.file_name}`}
                >
                  <Download className="h-4 w-4" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="supplier-doc-type" className="mb-1 block text-xs font-medium text-ink-600">
            Document type
          </label>
          <Select id="supplier-doc-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {SUPPLIER_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <MediaUploadField
          kind="supplier-document"
          ownerId={supplierId}
          label="Upload document"
          onUploaded={(media) => {
            startTransition(async () => {
              const result = await addSupplierDocumentAction(supplierId, docType, media.path, media.fileName);
              setMessage(result.ok ? 'Document saved.' : result.error);
            });
          }}
        />
      </div>
      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}
