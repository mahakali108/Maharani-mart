/** Only real navigation targets: rooted app routes or HTTP(S) URLs.
 * Shared by admin validation and the storefront; never allow script URLs. */
export function resolveBannerTarget(value: string | null | undefined, siteUrl?: string | null): { href: string; external: boolean } | null {
  const target = value?.trim();
  if (!target || /[\\\u0000-\u001f\u007f]/.test(target)) return null;
  if (target.startsWith('/') && !target.startsWith('//')) return { href: target, external: false };
  try {
    const url = new URL(target);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (siteUrl && url.origin === new URL(siteUrl).origin) {
      return { href: `${url.pathname}${url.search}${url.hash}`, external: false };
    }
    return { href: url.href, external: true };
  } catch {
    return null;
  }
}

export interface ScheduledBanner {
  is_active: boolean;
  area_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export function isBannerVisible(banner: ScheduledBanner, areaId: string | null, now: number): boolean {
  const hasStarted = !banner.starts_at || Date.parse(banner.starts_at) <= now;
  const hasNotEnded = !banner.ends_at || Date.parse(banner.ends_at) >= now;
  return banner.is_active && (!banner.area_id || banner.area_id === areaId) && hasStarted && hasNotEnded;
}
