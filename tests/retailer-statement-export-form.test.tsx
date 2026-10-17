// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatementExportForm } from '@/components/retailer/statement-export-form';

afterEach(cleanup);

describe('retailer statement date-range form', () => {
  it('submits inclusive date filters to the existing authenticated statement route', () => {
    render(<StatementExportForm />);

    const form = screen.getByRole('form', { name: 'Download retailer statements' });
    expect(form.getAttribute('action')).toBe('/retailer/reports/statement');
    expect(form.getAttribute('method')).toBe('get');

    const from = screen.getByLabelText('From date');
    const to = screen.getByLabelText('To date');
    expect(from.getAttribute('type')).toBe('date');
    expect(from.getAttribute('name')).toBe('from');
    expect(to.getAttribute('type')).toBe('date');
    expect(to.getAttribute('name')).toBe('to');
  });

  it('offers separate purchase and payment-ledger CSV downloads', () => {
    render(<StatementExportForm />);

    const purchases = screen.getByRole('button', { name: /purchase statement csv/i });
    const ledger = screen.getByRole('button', { name: /payment ledger csv/i });
    expect(purchases.getAttribute('name')).toBe('type');
    expect(purchases.getAttribute('value')).toBe('orders');
    expect(ledger.getAttribute('name')).toBe('type');
    expect(ledger.getAttribute('value')).toBe('ledger');
    expect(screen.getByText(/inclusive calendar dates in ist, up to two years/i)).toBeTruthy();
    expect(screen.getByText(/leave both blank for the default recent 365 days/i)).toBeTruthy();
  });
});
