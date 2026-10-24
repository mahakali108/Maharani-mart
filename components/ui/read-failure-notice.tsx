import { AlertTriangle } from 'lucide-react';

/**
 * "This list could not be loaded" — shown INSTEAD of an empty state when the
 * read failed.
 *
 * The defect this prevents: a list page destructured `{ data }` and dropped
 * `error`, so a schema drift (`42703`), an RLS denial or a timeout rendered the
 * page's empty state — "No return requests yet", "No coupons yet" — which is a
 * false statement about the operator's data and hides a real fault. See
 * `lib/supabase/read-guard.ts` for the detail-page variant (`notFound()`).
 *
 * Deliberately a server component with no interactivity: the honest recovery
 * for a server-side read failure is a reload, and the route's `error.tsx`
 * exists for a thrown failure. This is the softer path for pages whose other
 * sections did load.
 *
 * Styling uses the design-system `status.warning.*` semantic pair (amber):
 * the repository's colour contract forbids red/rose/pink utilities outright
 * (tests/design-system-contract.test.ts), and amber is the sanctioned
 * attention surface. It is deliberately NOT `status.error.*`, which is a
 * navy/lavender pair meant for field validation, not "we could not read".
 *
 * `detail` is the database message. It contains no customer rows — PostgREST
 * errors describe the query — and it is what makes a `42703` immediately
 * obvious to an engineer, so it is included but kept visually secondary.
 */
export function ReadFailureNotice({
  what,
  detail,
  hint,
}: {
  /** Short label of the data, e.g. "Return requests", "Coupons". */
  what: string;
  /** `error.message` (and code, when present) from the failed read. */
  detail?: string | null;
  /** Optional operator-facing next step. */
  hint?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">{what} could not be loaded.</p>
          <p className="text-warning-700">
            This is a read failure, not an empty list — nothing has been deleted.
            {hint ? ` ${hint}` : ' Reload the page to try again.'}
          </p>
          {detail ? (
            <p className="break-words font-mono text-[11px] leading-relaxed text-warning-700">{detail}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
