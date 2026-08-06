'use client';

import { useRef, useState, useTransition } from 'react';
import { FileText, Upload, Trash2, Loader2, Download } from 'lucide-react';
import { uploadFile, buildPath } from '@/lib/storage/upload';
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
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const path = buildPath(retailerId, file);
      const { path: storedPath } = await uploadFile('retailer-documents', file, path);
      await addRetailerDocumentAction(retailerId, docType, storedPath, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}

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
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-600 hover:border-primary-400 hover:text-primary-600">
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {isUploading ? 'Uploading…' : 'Upload document'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={handleFileChange}
            disabled={isUploading}
          />
        </label>
      </div>
    </div>
  );
}
