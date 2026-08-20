import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { parseMediaRef, readAppwriteFile } from '@/lib/media';
import { authorizePrivateMediaRead } from '@/lib/media/access';

/**
 * Authorised streaming endpoint for PRIVATE media (retailer KYC documents).
 *
 * Private Appwrite files carry no read permission for any role, so the only
 * way to reach their bytes is through this handler, which re-checks the
 * Supabase session and mirrors the `retailer_documents` RLS policy:
 * staff and above, or the retailer the document belongs to.
 *
 * GET /api/media/private?ref=appwrite://<bucket>/<fileId>
 */
export async function GET(request: NextRequest) {
  const refValue = request.nextUrl.searchParams.get('ref');

  const ref = parseMediaRef(refValue);
  if (!ref || ref.provider !== 'appwrite') {
    return NextResponse.json({ error: 'Invalid media reference.' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // The reference must belong to a real document row — this both proves the
  // file is ours to serve and tells us which retailer owns it. RLS on
  // `retailer_documents` already scopes this read to the caller.
  const { data: document } = await supabase
    .from('retailer_documents')
    .select('retailer_id, file_name')
    .eq('file_url', refValue as string)
    .maybeSingle<{ retailer_id: string; file_name: string }>();

  if (!document) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const access = await authorizePrivateMediaRead(document.retailer_id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const file = await readAppwriteFile(refValue as string);
  if (!file) {
    return NextResponse.json({ error: 'File is unavailable.' }, { status: 404 });
  }

  const safeName = (document.file_name || file.fileName).replace(/["\\\r\n]/g, '');

  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `inline; filename="${safeName}"`,
      // Confidential paperwork must never be cached by a shared proxy.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
