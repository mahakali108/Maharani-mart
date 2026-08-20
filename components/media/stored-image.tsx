'use client';

/**
 * The single image resolver for the whole app.
 *
 * Renders BOTH storage generations from the same column value, which is what
 * makes the Appwrite rollout non-destructive:
 *
 *   - `appwrite://<bucket>/<fileId>`                    → Appwrite delivery URL
 *   - `https://<ref>.supabase.co/storage/v1/...`        → rendered as-is (legacy)
 *   - any other absolute URL / root-relative path       → rendered as-is
 *   - unresolvable / empty                              → neutral placeholder
 *
 * No Appwrite SDK, no secrets — URL construction only uses the public
 * endpoint + project id, which appear in every delivered file URL anyway.
 */

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
   * Delivery size hint. For Appwrite-backed files this requests a resized
   * WebP render; legacy Supabase URLs ignore it and serve the original.
   */
  size?: RenderSize;
  /** Content shown when there is no usable image. */
  fallback?: React.ReactNode;
  className?: string;
}

export function StoredImage({
  src,
  alt,
  size = 'card',
  fallback,
  className,
  fill,
  ...rest
}: StoredImageProps) {
  const resolved = resolveMediaUrl(src, { width: RENDER_WIDTHS[size] });

  if (!resolved) {
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
      // Matches the existing convention across the app: images are served
      // already-optimised by the storage provider, so Next's optimizer is
      // bypassed and no extra remotePatterns entry is strictly required.
      unoptimized
    />
  );
}
