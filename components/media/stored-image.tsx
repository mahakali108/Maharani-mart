import Image, { type ImageProps } from 'next/image';
import { resolveMediaUrl } from '@/lib/storage/urls';

type StoredImageProps = Omit<ImageProps, 'src'> & {
  src: string | null | undefined;
};

/**
 * Renders a marketplace image whether the DB still holds a legacy
 * Supabase public URL or a new Firebase object path.
 */
export function StoredImage({ src, alt, unoptimized = true, ...rest }: StoredImageProps) {
  const resolved = resolveMediaUrl(src);
  if (!resolved) return null;
  return <Image src={resolved} alt={alt} unoptimized={unoptimized} {...rest} />;
}
