import { ArrowDownToLine, FileText } from 'lucide-react';

/**
 * Date-range controls for the existing server-side retailer statement route.
 * A native GET form keeps the download usable without client JavaScript and
 * leaves identity, date validation and data scoping to the authenticated route.
 */
export function StatementExportForm() {
  return (
    <section
      aria-labelledby="statement-export-heading"
      className="rounded-2xl border border-lavender-200 bg-lavender-50 p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <p className="shop-eyebrow">Business records</p>
          <h2 id="statement-export-heading" className="mt-1 text-sm font-bold text-slate-950 sm:text-base">
            Download statements
          </h2>
          <p id="statement-export-help" className="mt-1 max-w-md text-[10px] leading-4 text-slate-600 sm:text-xs">
            Choose inclusive calendar dates in IST, up to two years. Leave both blank for the default recent 365 days.
          </p>
        </div>

        <form
          action="/retailer/reports/statement"
          method="get"
          aria-label="Download retailer statements"
          aria-describedby="statement-export-help"
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <label className="min-w-0 space-y-1">
              <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-600">From date</span>
              <input
                type="date"
                name="from"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </label>
            <label className="min-w-0 space-y-1">
              <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-600">To date</span>
              <input
                type="date"
                name="to"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="submit"
              name="type"
              value="orders"
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-600 px-3 text-[10px] font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
            >
              <ArrowDownToLine className="h-4 w-4" aria-hidden="true" /> Purchase statement CSV
            </button>
            <button
              type="submit"
              name="type"
              value="ledger"
              className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
            >
              <FileText className="h-4 w-4" aria-hidden="true" /> Payment ledger CSV
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
