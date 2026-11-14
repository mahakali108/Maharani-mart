import Link from 'next/link';
import { formatIndiaDate } from '@/lib/datetime/india';
import { acceptLegalDocumentsAction, getAcceptanceStatus, type AcceptanceAudience } from '@/lib/legal/acceptance';

/**
 * Shows which current policy versions the signed-in user has accepted and lets
 * them accept the rest. The checkbox is never pre-ticked. Renders nothing when
 * the acceptance table is not installed, so it cannot mislead before 0095.
 */
export async function PolicyAcceptanceCard({ audience }: { audience: AcceptanceAudience }) {
  const status = await getAcceptanceStatus(audience);
  if (!status.available) return null;

  return (
    <section aria-labelledby="policy-acceptance-heading" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="policy-acceptance-heading" className="text-sm font-bold text-slate-900">Policies you have accepted</h2>
      <ul className="mt-3 space-y-2 text-xs text-slate-700">
        {status.items.map(({ document, acceptedAt }) => (
          <li key={document.key} className="flex flex-wrap items-center justify-between gap-2">
            <Link href={document.href} className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline">
              {document.title} (version {document.version})
            </Link>
            <span className={acceptedAt ? 'font-semibold text-mint-700' : 'font-semibold text-amber-700'}>
              {acceptedAt
                ? `Accepted ${formatIndiaDate(acceptedAt)}`
                : 'Not yet accepted'}
            </span>
          </li>
        ))}
      </ul>
      {status.pending > 0 ? (
        <form action={acceptLegalDocumentsAction} className="mt-3 space-y-3">
          <input type="hidden" name="audience" value={audience} />
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
            <input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>I have read the documents listed above and I accept their current versions.</span>
          </label>
          <button type="submit" className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800">
            Record my acceptance
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-500">You have accepted the current version of every required document.</p>
      )}
    </section>
  );
}
