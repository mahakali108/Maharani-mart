import { MapPin, Phone, UserRound } from 'lucide-react';

/** Presentational address card. For a new order the saved address is frozen
 * at placement; a registered-shop fallback on historical orders is NOT proof
 * of the original delivery location or current PIN coverage. */
export interface DeliveryAddress {
  shopName: string | null;
  contactName: string | null;
  address: string | null;
  area: string | null;
  phone: string | null;
}

export function DeliveryAddressCard({
  address,
  title = 'Delivery address',
  note = 'Delivery coverage is checked for a saved address at checkout; shop profile text is not a delivery promise.',
}: {
  address: DeliveryAddress;
  title?: string;
  note?: string;
}) {
  const lines = [address.address, address.area].filter((line): line is string => !!line && line.trim().length > 0);
  const hasAddress = lines.length > 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
        <MapPin className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {address.shopName ? (
          <p className="text-xs font-bold text-slate-900">{address.shopName}</p>
        ) : null}

        {hasAddress ? (
          <address className="text-xs not-italic leading-5 text-slate-600">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-4 text-amber-800">
            No delivery address is recorded here. Add and select a saved address to check configured delivery coverage.
          </p>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3">
          {address.contactName ? (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {address.contactName}
            </p>
          ) : null}
          {address.phone ? (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              {address.phone}
            </p>
          ) : null}
        </div>

        {note ? <p className="text-[10px] leading-4 text-slate-400">{note}</p> : null}
      </div>
    </section>
  );
}
