'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Product image card for the retailer product detail page.
 *
 * - Large rounded card on a soft light-gray background, centered
 *   contain-fit image (packaging is never stretched or cropped).
 * - The main image opens a native `<dialog>` lightbox (Esc / backdrop /
 *   close button all dismiss it; prev-next when several images exist).
 * - `badges` (discount / NEW / OFFER), `shareSlot` and `favoriteSlot` are
 *   supplied by the page so this component stays a pure presentation
 *   surface with no data of its own.
 */
export function ProductGallery({
  name,
  images,
  badges,
  favoriteSlot,
  shareSlot,
}: {
  name: string;
  images: { id: string; image_url: string }[];
  badges?: React.ReactNode;
  favoriteSlot?: React.ReactNode;
  shareSlot?: React.ReactNode;
}) {
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = images[active] ?? images[0];
  const multi = images.length > 1;

  function openLightbox() {
    dialogRef.current?.showModal();
  }

  function closeLightbox() {
    dialogRef.current?.close();
  }

  function step(delta: number) {
    if (!multi) return;
    setActive((prev) => (prev + delta + images.length) % images.length);
  }

  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-50">
          {current ? (
            <button
              type="button"
              onClick={openLightbox}
              aria-label={`Open image viewer for ${name}`}
              className="absolute inset-0 flex h-full w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300"
            >
              <Image
                src={current.image_url}
                alt={name}
                fill
                sizes="(max-width: 1024px) 100vw, 52vw"
                className="object-contain p-5 sm:p-8"
                unoptimized
                priority
              />
              <span
                className="absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-400 shadow-sm backdrop-blur"
                aria-hidden="true"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
              <ImageOff className="h-12 w-12" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Product image unavailable</span>
            </div>
          )}
          {badges ? <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">{badges}</div> : null}
          {shareSlot || favoriteSlot ? (
            <div className="absolute right-3 top-3 flex flex-col items-center gap-1.5">
              {shareSlot}
              {favoriteSlot}
            </div>
          ) : null}
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
                'relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                index === active ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-200 hover:border-primary-300'
              )}
              aria-label={`View image ${index + 1}`}
              aria-pressed={index === active}
            >
              <Image src={image.image_url} alt={`${name} view ${index + 1}`} fill className="object-contain p-1" unoptimized />
            </button>
          ))}
        </div>
      ) : null}

      {/* Lightbox — a native <dialog> so Esc, focus trapping and modal
          semantics come from the browser with no animation library. */}
      <dialog
        ref={dialogRef}
        aria-label={`${name} — image ${active + 1} of ${images.length}`}
        className="m-auto h-[100dvh] w-screen max-w-none rounded-none border-0 bg-slate-950/95 p-0 shadow-none backdrop-blur-sm [&::-webkit-backdrop-close]:hidden"
        onClick={(event) => {
          // Tap anywhere outside the controls closes the viewer; the close /
          // prev / next buttons handle their own clicks.
          if ((event.target as HTMLElement).closest('button')) return;
          closeLightbox();
        }}
      >
        <div className="relative h-full w-full">
          {current ? (
            <Image
              src={current.image_url}
              alt={name}
              fill
              sizes="100vw"
              className="object-contain p-4 pb-14 pt-12 sm:p-8 sm:pb-16"
              unoptimized
            />
          ) : null}

          {/* Top bar: counter + close */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 py-2.5 sm:px-5">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white">
              {active + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={closeLightbox}
              aria-label="Close image viewer"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Prev / next */}
          {multi ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
