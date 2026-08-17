'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function ProductGallery({
  name,
  images,
  badges,
  favoriteSlot,
}: {
  name: string;
  images: { id: string; image_url: string }[];
  badges?: React.ReactNode;
  favoriteSlot?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0];

  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">
          {current ? (
            <Image
              src={current.image_url}
              alt={name}
              fill
              sizes="(max-width: 1024px) 100vw, 52vw"
              className="object-contain p-5 sm:p-8"
              unoptimized
              priority
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
              <ImageOff className="h-12 w-12" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Product image unavailable</span>
            </div>
          )}
          {badges ? <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">{badges}</div> : null}
          {favoriteSlot ? <div className="absolute right-3 top-3">{favoriteSlot}</div> : null}
        </div>
      </section>
      {images.length > 1 ? (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                'relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white',
                index === active ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-200'
              )}
              aria-label={`View image ${index + 1}`}
            >
              <Image src={image.image_url} alt={`${name} view ${index + 1}`} fill className="object-contain p-1" unoptimized />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
