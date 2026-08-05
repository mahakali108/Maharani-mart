import { NextResponse, type NextRequest } from 'next/server';

/**
 * Inbound webhook receiver — architecture stub for Phase 2+.
 *
 * Intended senders (wired up when the corresponding integration ships):
 *   - WhatsApp Cloud API delivery/read receipts -> update `notification_logs.status`
 *   - SMS gateway delivery reports -> update `notification_logs.status`
 *   - Payment gateway callbacks (if/when online payment is added)
 *
 * Verifies a shared-secret header so this can't be spammed by anyone
 * who finds the URL. No provider is wired yet, so today this endpoint
 * only authenticates and acknowledges — it does not fabricate a
 * response pretending an integration exists.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret');

  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Phase 2+: branch on a `source`/`type` field in the payload and update
  // the matching `notification_logs` row via createServiceRoleClient()
  // from '@/lib/supabase/server', e.g.:
  //
  //   const supabase = createServiceRoleClient();
  //   await supabase.from('notification_logs')
  //     .update({ status: 'delivered', provider_message_id: body.messageId })
  //     .eq('provider_message_id', body.originalMessageId);
  console.log('Webhook received (not yet processed by an integration):', body);

  return NextResponse.json({ received: true });
}
