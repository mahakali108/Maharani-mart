import { webRelease } from '@/lib/config/web-release';

// Workers compare imported script bytes on update. Only publish a public build label.
export function GET() {
  return new Response(`self.MAHA_RELEASE = ${JSON.stringify(webRelease)};`, {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' },
  });
}
