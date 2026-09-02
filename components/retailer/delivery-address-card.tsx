import { MapPin, Phone, UserRound } from 'lucide-react';

/**
 * The delivery address an order goes to.
 *
 * SCHEMA REALITY (audited): a retailer has exactly ONE address — the
 * `retailers.address` text column — plus their assigned `areas` row and the
 * contact name/phone on `profiles`. There is no address book, no per-order
 * address snapshot and no `orders.delivery_*` column anywhere in the 25
 * migrations.
 *
 * So this card renders the retailer's real registered shop address and says
 * plainly that it is the registered address. It does NOT pretend to be a
 * selectable address book, and on a historical order it does not claim the
 * value was captured at order time — because it was not. The safest path to a
 * real address book + per-order snapshot is documented in
 * docs/retailer-enterprise-upgrade.md §4.
 *
 * Presentational only: every value is read server-side from the caller's own
 * RLS-scoped row and passed in. Nothing is editable here, so no client state
 * can influence what an order is charged or where it is recorded as going.
 */
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
  note = 'Orders are delivered to your registered shop address. Contact your distributor to update it.',
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
            No delivery address is recorded on your account yet. Your distributor can add one — orders are still
            delivered to your assigned service area.
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
