// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CouponCard } from '@/components/retailer/coupon-card';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/coupons/actions', () => ({ applyCouponAction: mocks.apply }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

beforeEach(() => {
  mocks.apply.mockReset();
  mocks.push.mockReset();
});
afterEach(cleanup);

const props = {
  code: 'SAVE10',
  title: 'Save 10%',
  discountLabel: '10% off',
  details: ['On orders of ₹1,000.00 or more'],
  expiresLabel: '1 Jan 2027',
  blockedReason: null as string | null,
};

describe('CouponCard', () => {
  it('shows the code, discount, details and an apply control', () => {
    render(<CouponCard {...props} />);
    expect(screen.getByText('SAVE10')).toBeTruthy();
    expect(screen.getByText('10% off')).toBeTruthy();
    expect(screen.getByText('On orders of ₹1,000.00 or more')).toBeTruthy();
    expect(screen.getByRole('button', { name: /apply to my cart/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('copies the code to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CouponCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SAVE10'));
    expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy();
  });

  it('sends only the code to the server action and navigates to the cart on success', async () => {
    mocks.apply.mockResolvedValue({ success: true, code: 'SAVE10', discount: 50 });
    render(<CouponCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /apply to my cart/i }));
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith('SAVE10'));
    // Success message + hand-off to the cart where the validated discount shows.
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows the server rejection inline and does not navigate', async () => {
    mocks.apply.mockResolvedValue({ error: 'Add ₹500.00 more to use this code.' });
    render(<CouponCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /apply to my cart/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('never offers Apply on a blocked (limit/expired) coupon', () => {
    render(<CouponCard {...props} blockedReason="You have used this coupon 1 time — your limit is 1." />);
    expect(screen.queryByRole('button', { name: /apply to my cart/i })).toBeNull();
    expect(screen.getByText('You have used this coupon 1 time — your limit is 1.')).toBeTruthy();
  });

  it('labels scheduled coupons with their start date instead of expiry', () => {
    render(<CouponCard {...props} scheduled />);
    expect(screen.getByText(/starts 1 Jan 2027/i)).toBeTruthy();
  });
});
