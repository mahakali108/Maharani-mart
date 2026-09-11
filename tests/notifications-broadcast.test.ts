import { describe, expect, it } from 'vitest';
import {
  BROADCAST_AUDIENCES,
  broadcastSchema,
  isBroadcastAudience,
} from '@/lib/notifications/broadcast';
import { can } from '@/lib/permissions/permissions';

describe('broadcast audiences', () => {
  it('is a closed set with stable values', () => {
    expect(BROADCAST_AUDIENCES.map((a) => a.value)).toEqual([
      'all_retailers',
      'active_retailers',
      'all_salesmen',
      'all_staff',
    ]);
  });

  it('accepts only known audiences', () => {
    expect(isBroadcastAudience('active_retailers')).toBe(true);
    expect(isBroadcastAudience('all_staff')).toBe(true);
    expect(isBroadcastAudience('everyone')).toBe(false);
    expect(isBroadcastAudience(null)).toBe(false);
    expect(isBroadcastAudience(undefined)).toBe(false);
  });
});

describe('broadcast input validation', () => {
  const valid = {
    title: 'Diwali scheme is live',
    body: 'Order before Friday to get the festival discount.',
    audience: 'active_retailers',
  };

  it('accepts a valid broadcast and defaults to transactional', () => {
    const parsed = broadcastSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.category).toBe('transactional');
  });

  it('rejects short titles/bodies and unknown audiences', () => {
    expect(broadcastSchema.safeParse({ ...valid, title: 'hi' }).success).toBe(false);
    expect(broadcastSchema.safeParse({ ...valid, body: '' }).success).toBe(false);
    expect(broadcastSchema.safeParse({ ...valid, audience: 'friends' }).success).toBe(false);
  });

  it('only allows internal links, never external URLs', () => {
    expect(broadcastSchema.safeParse({ ...valid, linkUrl: '/retailer/schemes' }).success).toBe(true);
    expect(broadcastSchema.safeParse({ ...valid, linkUrl: 'https://evil.example.com' }).success).toBe(false);
    expect(broadcastSchema.safeParse({ ...valid, linkUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('accepts promotional category explicitly', () => {
    const parsed = broadcastSchema.safeParse({ ...valid, category: 'promotional' });
    expect(parsed.success).toBe(true);
  });
});

describe('permission wiring for broadcasts (Phase 2)', () => {
  it('grants notifications.broadcast to admin+ only', () => {
    expect(can('super_admin', 'notifications.broadcast')).toBe(true);
    expect(can('admin', 'notifications.broadcast')).toBe(true);
    expect(can('staff', 'notifications.broadcast')).toBe(false);
    expect(can('salesman', 'notifications.broadcast')).toBe(false);
    expect(can('retailer', 'notifications.broadcast')).toBe(false);
  });
});
