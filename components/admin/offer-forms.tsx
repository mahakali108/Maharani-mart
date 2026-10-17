'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tag } from 'lucide-react';
import { createOfferAction, setOfferFloorAction, updateOfferAction } from '@/lib/admin/offer-actions';
import type { SellerOfferRow } from '@/types/marketplace.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface PackOption {
  packId: string;
  productId: string;
  label: string;
}

/**
 * Admin-managed offer authoring on behalf of a seller. New offers always start
 * in pending moderation; the DB floor trigger re-checks the admin minimum.
 */
export function CreateOfferForm({
  sellerId,
  packs,
}: {
  sellerId: string;
  packs: PackOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await createOfferAction(formData);
      if (result.ok) {
        setMessage('Offer created and queued for moderation.');
        formRef.current?.reset();
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <form ref={formRef} action={submit} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="sellerId" value={sellerId} />
      <Select name="packId" required className="sm:col-span-2" defaultValue="">
        <option value="" disabled>
          Choose a product pack…
        </option>
        {packs.map((pack) => (
          <option key={pack.packId} value={pack.packId} data-product={pack.productId}>
            {pack.label}
          </option>
        ))}
      </Select>
      {/* productId travels with the chosen pack; the server re-validates it. */}
      <Input name="unitPrice" placeholder="Offer price (₹ per piece) *" required inputMode="decimal" />
      <Input name="moq" placeholder="MOQ (pieces) *" required inputMode="numeric" defaultValue="1" />
      <Select name="fulfilmentType" defaultValue="seller">
        <option value="seller">Seller-fulfilled (seller stock)</option>
        <option value="maharani">Maharani-fulfilled (pack stock)</option>
      </Select>
      <Input name="stockQuantity" placeholder="Seller stock (pieces)" inputMode="numeric" />
      <Input name="sellerSku" placeholder="Seller SKU (optional)" maxLength={64} />
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          <Tag className="h-4 w-4" aria-hidden /> Create offer
        </Button>
        {message ? (
          <p role="status" className="mt-2 text-sm text-ink-600">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Inline edit for an existing offer's trading fields (identity is immutable). */
export function EditOfferForm({ offer }: { offer: SellerOfferRow }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateOfferAction(formData);
      if (result.ok) {
        setMessage('Offer updated.');
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <form action={submit} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="offerId" value={offer.id} />
      <Input
        name="unitPrice"
        defaultValue={(offer.unit_price_paise / 100).toFixed(2)}
        inputMode="decimal"
        aria-label="Offer price in rupees"
      />
      <Input name="moq" defaultValue={String(offer.moq)} inputMode="numeric" aria-label="MOQ in pieces" />
      <Input
        name="stockQuantity"
        defaultValue={String(offer.stock_quantity ?? 0)}
        inputMode="numeric"
        aria-label="Seller stock in pieces"
      />
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          Save offer changes
        </Button>
        {message ? (
          <p role="status" className="mt-2 text-sm text-ink-600">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Append-only admin price floor for a pack (history rows are never edited). */
export function OfferFloorForm({ packId }: { packId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const result = await setOfferFloorAction(
        packId,
        String(formData.get('floorRupees') ?? ''),
        String(formData.get('note') ?? '')
      );
      if (result.ok) {
        setMessage('Price floor saved (new history row).');
        formRef.current?.reset();
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  };

  return (
    <form ref={formRef} action={submit} className="flex flex-wrap items-end gap-3">
      <Input name="floorRupees" placeholder="Minimum price (₹) *" required inputMode="decimal" />
      <Input name="note" placeholder="Note (optional)" maxLength={300} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        Set price floor
      </Button>
      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}
        </p>
      ) : null}
    </form>
  );
}
