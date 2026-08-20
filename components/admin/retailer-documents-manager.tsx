'use client';

import { useState, useTransition } from 'react';
import { FileText, Trash2, Download } from 'lucide-react';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { addRetailerDocumentAction, deleteRetailerDocumentAction } from '@/lib/admin/retailers-actions';
import { Select } from '@/components/ui/select';

const DOC_TYPES = [
  { value: 'gstin_certificate', label: 'GSTIN Certificate' },
  { value: 'shop_photo', label: 'Shop Photo' },
  { value: 'id_proof', label: 'ID Proof' },
  { value: 'other', label: 'Other' },
];

export interface RetailerDocument {
  id: string;
  doc_type: string;
  file_name: string;
  created_at: string;
  signedUrl: string | null;
}

export function RetailerDocumentsManager({
  retailerId,
  documents,
}: {
  retailerId: string;
  documents: RetailerDocument[];
}) {
  const [docType, setDocType] = useState('gstin_certificate');
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <p className="text-sm text-ink-500">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-ink-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{doc.file_name}</p>
                  <p className="text-xs text-ink-400">
                    {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label ?? doc.doc_type} ·{' '}
                    {new Date(doc.created_at).toLocaleDateString('en-IN')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {doc.signedUrl ? (
                  <a
                    href={doc.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                    aria-label="Download document"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (confirm('Delete this document?')) {
                      startTransition(() => deleteRetailerDocumentAction(doc.id, retailerId));
                    }
                  }}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
                  aria-label="Delete document"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="sm:max-w-[200px]">
          {DOC_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <MediaUploadField
          kind="retailer-document"
          ownerId={retailerId}
          label="Upload document"
          onUploaded={(media) =>
            addRetailerDocumentAction(retailerId, docType, media.ref, media.fileName)
          }
        />
      </div>
    </div>
  );
}
