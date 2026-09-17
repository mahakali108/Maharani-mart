'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2 } from 'lucide-react';
import { importProductsAction, type ImportResult } from '@/lib/admin/product-import-actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * Two-stage CSV importer.
 *
 * Stage 1 ("Check file") runs the analysis server-side and renders every row
 * with its problems. Stage 2 ("Import") re-submits the SAME file — the input is
 * never cleared between stages, so the operator confirms exactly the bytes they
 * checked. Clearing or replacing the file resets the preview, because a preview
 * of a different file would be a lie.
 */
export function ProductImportPanel() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [stage, setStage] = useState<'preview' | 'import'>('preview');

  const preview = result?.stage === 'preview' ? result.preview : null;
  const done = result?.stage === 'done' ? result : null;
  const failed = result?.stage === 'error' ? result.error : null;

  function run(mode: 'preview' | 'import') {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    formData.set('mode', mode);
    setStage(mode);
    startTransition(async () => {
      setResult(await importProductsAction(formData));
    });
  }

  return (
    <div className="space-y-4">
      <form
        ref={formRef}
        className="rounded-xl border border-ink-100 bg-white p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <label
          htmlFor="file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/50 px-4 py-8 text-center hover:border-primary-300"
        >
          <FileSpreadsheet className="h-6 w-6 text-ink-400" />
          <span className="text-sm font-medium text-ink-700">
            {fileName || 'Choose a CSV file'}
          </span>
          <span className="text-xs text-ink-400">UTF-8, up to 2 MB, at most 2000 rows</span>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              setFileName(event.target.files?.[0]?.name ?? '');
              // A different file invalidates any preview of the previous one.
              setResult(null);
            }}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending || !fileName} onClick={() => run('preview')}>
            {pending && stage === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Check file
          </Button>
          {preview ? (
            <Button
              type="button"
              size="sm"
              disabled={pending || preview.validCount === 0}
              onClick={() => run('import')}
            >
              {pending && stage === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import {preview.validCount} valid row{preview.validCount === 1 ? '' : 's'}
            </Button>
          ) : null}
        </div>
      </form>

      {failed ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{failed}</span>
        </div>
      ) : null}

      {done ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{done.summary}</span>
          </p>
          {done.failed.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs">
              {done.failed.slice(0, 10).map((row) => (
                <li key={`${row.rowNumber}-${row.message}`}>
                  Row {row.rowNumber}: {row.message}
                </li>
              ))}
              {done.failed.length > 10 ? <li>+{done.failed.length - 10} more</li> : null}
            </ul>
          ) : null}
          <p className="mt-3">
            <Link href="/admin/products" className="text-xs font-semibold text-emerald-800 underline">
              Go to the product list →
            </Link>
          </p>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold text-ink-800">Preview</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              {preview.validCount} will import
            </span>
            {preview.invalidCount > 0 ? (
              <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                {preview.invalidCount} will be skipped
              </span>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
            <div className="table-scroll">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-3 py-3 font-medium">Row</th>
                    <th className="px-3 py-3 font-medium">Product</th>
                    <th className="px-3 py-3 font-medium">Brand</th>
                    <th className="px-3 py-3 font-medium">Category</th>
                    <th className="px-3 py-3 font-medium">Case / piece</th>
                    <th className="px-3 py-3 font-medium">GST</th>
                    <th className="px-3 py-3 font-medium">HSN</th>
                    <th className="px-3 py-3 font-medium">MOQ</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className={cn(!row.valid && 'bg-rose-50/40')}>
                      <td className="px-3 py-3 text-ink-400">{row.rowNumber}</td>
                      <td className="px-3 py-3 font-medium text-ink-900">{row.name || <span className="text-ink-300">—</span>}</td>
                      <td className="px-3 py-3 text-ink-600">{row.brand || '—'}</td>
                      <td className="px-3 py-3 text-ink-600">{row.category || '—'}</td>
                      <td className="px-3 py-3 text-ink-600">
                        ₹{row.casePrice || '0'}
                        {row.piecePrice ? <span className="ml-1 text-xs text-ink-400">({row.piecePrice}/pc)</span> : null}
                      </td>
                      <td className="px-3 py-3 text-ink-600">{row.gst}%</td>
                      <td className="px-3 py-3 font-mono text-xs text-ink-500">{row.hsn || '—'}</td>
                      <td className="px-3 py-3 text-ink-600">{row.moq}</td>
                      <td className="px-3 py-3">
                        {row.valid ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            Ready
                          </span>
                        ) : (
                          <ul className="space-y-0.5 text-[11px] font-medium text-rose-600">
                            {row.issues.map((issue) => (
                              <li key={issue}>{issue}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.invalidCount > 0 ? (
            <p className="text-xs text-ink-500">
              Invalid rows are skipped, never silently accepted. Fix them in the file and check again to import them
              too.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
