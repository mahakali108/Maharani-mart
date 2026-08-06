'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Invoice "download PDF" is implemented via the browser's native
 * print-to-PDF, not a server-side PDF library — this avoids adding a
 * heavy rendering dependency (puppeteer/pdf-lib) for Phase 2B while
 * still giving retailers a real, correctly laid-out PDF. If a
 * server-generated PDF becomes a hard requirement later (e.g. for
 * emailing invoices automatically), that's a contained addition to
 * this one button/page, not a rearchitecture.
 */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()} size="sm" variant="outline">
      <Printer className="h-4 w-4" />
      Print / Save as PDF
    </Button>
  );
}
