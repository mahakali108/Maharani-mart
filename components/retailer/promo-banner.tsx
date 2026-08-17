import Image from 'next/image';
import { ArrowRight } from 'lucide-react';

export function PromoBanner({
  title,
  imageUrl,
  linkUrl,
}: {
  title: string;
  imageUrl: string;
  linkUrl?: string | null;
}) {
  const content = (
    <>
      <Image src={imageUrl} alt={title} fill className="object-cover transition duration-500 group-hover:scale-105" unoptimized />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/88 via-slate-950/55 to-slate-950/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-slate-950/10" />
      <div className="absolute inset-y-0 left-0 flex max-w-[78%] flex-col justify-end p-5 text-white sm:max-w-[70%] sm:p-7">
        <span className="mb-2 w-fit rounded-full bg-amber-400 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-950 shadow-sm">
          Featured
        </span>
        <h2 className="text-lg font-bold leading-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] sm:text-2xl">
          {title}
        </h2>
        <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-950 shadow-sm sm:text-xs">
          Explore offer <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </>
  );

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noreferrer"
        className="group relative aspect-[2/1] w-[92%] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-900 shadow-md sm:w-full"
      >
        {content}
      </a>
    );
  }

  return (
    <div className="group relative aspect-[2/1] w-[92%] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-900 shadow-md sm:w-full">
      {content}
    </div>
  );
}
