'use client';

/**
 * The single image resolver for the whole app.
 *
 * Renders a stored column value (`product_images.image_url`,
 * `banners.image_url`, `brands.logo_url`, `categories.image_url`, …):
 *
 *   - `https://<ref>.supabase.co/storage/v1/...`  → rendered through next/image
 *   - any other absolute URL / root-relative path → rendered as-is
 *   - empty / unresolvable                         → neutral placeholder
 *   - broken at load time (onError)                → neutral placeholder
 *
 * No secrets, no SDK — URL handling is pure string inspection via
 * `lib/media/refs.ts`. Supabase public URLs are already covered by the
 * `images.remotePatterns` entry in `next.config.mjs`, so the Next.js optimizer
 * is used (no `unoptimized`).
 */

import { useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { ImageOff } from 'lucide-react';

import { resolveMediaUrl } from '@/lib/media/refs';
import { RENDER_WIDTHS, type RenderSize } from '@/lib/media/optimize';
import { cn } from '@/lib/utils/cn';

type BaseProps = Omit<ImageProps, 'src' | 'alt' | 'loader'>;

export interface StoredImageProps extends BaseProps {
  /** Raw column value: `product_images.image_url`, `banners.image_url`, … */
  src: string | null | undefined;
  alt: string;
  /**
   * Delivery size hint. Maps to the `sizes` attribute when the image is
   * rendered with `fill`, so the Next.js optimizer fetches an appropriately
   * sized render per viewport.
   */
  size?: RenderSize;
  /** Content shown when there is no usable image. */
  fallback?: React.ReactNode;
  className?: string;
}

/** Responsive `sizes` strings per surface, used with `fill`. */
const SIZES: Record<RenderSize, string> = {
  thumb: `${RENDER_WIDTHS.thumb}px`,
  card: `${RENDER_WIDTHS.card}px`,
  detail: `${RENDER_WIDTHS.detail}px`,
  banner: '100vw',
};

export function StoredImage({
  src,
  alt,
  size = 'card',
  fallback,
  className,
  fill,
  ...rest
}: StoredImageProps) {
  const [errored, setErrored] = useState(false);
  const resolved = resolveMediaUrl(src);

  if (!resolved || errored) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-ink-50 text-ink-300',
          className,
        )}
        aria-label={alt}
        role="img"
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  return (
    <Image
      {...rest}
      fill={fill}
      src={resolved}
      alt={alt}
      className={className}
      sizes={fill ? SIZES[size] : rest.sizes}
      onError={() => setErrored(true)}
    />
  );
}
