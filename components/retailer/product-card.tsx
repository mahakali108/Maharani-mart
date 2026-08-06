import Link from 'next/link';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function ProductCard({
  id,
  name,
  brandName,
  imageUrl,
  isNewLaunch,
  fromPrice,
}: {
  id: string;
  name: string;
  brandName?: string;
  imageUrl?: string;
  isNewLaunch: boolean;
  fromPrice: number | null;
}) {
  return (
    <Link href={`/retailer/catalog/${id}`}>
      <Card className="flex h-full flex-col gap-2 p-3 transition-shadow hover:shadow-premium">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-ink-50">
          {imageUrl ? (
            <Image src={imageUrl} alt={name} fill className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-300">
              <ImageOff className="h-8 w-8" />
            </div>
          )}
          {isNewLaunch ? (
            <span className="absolute left-2 top-2 rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
              New
            </span>
          ) : null}
        </div>
        <div>
          {brandName ? <p className="text-xs text-ink-400">{brandName}</p> : null}
          <p className="line-clamp-2 text-sm font-medium leading-snug text-ink-900">{name}</p>
        </div>
        <p className="mt-auto text-sm font-semibold text-primary-600">
          {fromPrice !== null ? `From ₹${fromPrice.toFixed(2)}` : 'Contact for price'}
        </p>
      </Card>
    </Link>
  );
}
