// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CartOrderSummary } from '@/components/retailer/cart-order-summary';
import { CouponApplyForm } from '@/components/retailer/coupon-apply-form';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/coupons/actions', () => ({
  applyCouponAction: mocks.apply,
  removeCouponAction: mocks.remove,
}));

beforeEach(() => {
  mocks.apply.mockReset();
  mocks.remove.mockReset();
});
afterEach(cleanup);

describe('CartOrderSummary coupon row', () => {
  const base = {
    subtotal: 1000,
    gstByRate: [{ rate: 18, amount: 180 }],
    savings: 0,
    grandTotal: 1180,
    orderableCount: 2,
  };

  it('shows a validated coupon discount row when present', () => {
    render(<CartOrderSummary {...base} coupon={{ code: 'SAVE10', discount: 100 }} />);
    expect(screen.getByText('Coupon · SAVE10')).toBeTruthy();
    expect(screen.getByText('−₹100.00')).toBeTruthy();
  });

  it('does not show a coupon row when no coupon is applied', () => {
    render(<CartOrderSummary {...base} />);
    expect(screen.queryByText(/Coupon/)).toBeNull();
  });
});

describe('CouponApplyForm', () => {
  it('renders the applied coupon with its server-computed savings and a remove control', () => {
    render(<CouponApplyForm applied={{ code: 'WELCOME', discount: 250 }} />);
    expect(screen.getByText('WELCOME')).toBeTruthy();
    expect(screen.getByText('You save ₹250.00 on this order')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Enter code')).toBeNull();
  });

  it('removes the applied coupon through the server action', async () => {
    mocks.remove.mockResolvedValue({ success: true, removed: true });
    render(<CouponApplyForm applied={{ code: 'WELCOME', discount: 250 }} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
  });

  it('submits only the entered code and surfaces the server rejection message', async () => {
    mocks.apply.mockResolvedValue({ error: 'This coupon has expired.' });
    render(<CouponApplyForm />);
    const input = screen.getByPlaceholderText('Enter code');
    fireEvent.change(input, { target: { value: 'expired' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith('EXPIRED'));
    expect((await screen.findByRole('alert')).textContent).toContain('This coupon has expired.');
  });

  it('normalizes the submitted code to uppercase before it reaches the server', async () => {
    mocks.apply.mockResolvedValue({ success: true, code: 'SAVE10', discount: 50 });
    render(<CouponApplyForm />);
    fireEvent.change(screen.getByPlaceholderText('Enter code'), { target: { value: 'save10' } });
    fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith('SAVE10'));
    expect((await screen.findByRole('status')).textContent).toContain('SAVE10 applied');
  });

  it('shows the stale-coupon warning without offering it as a discount', () => {
    render(<CouponApplyForm warning="Coupon OLD no longer applies: This coupon has expired." />);
    expect(screen.getByRole('status').textContent).toContain('no longer applies');
  });
});
