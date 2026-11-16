import type { Metadata } from 'next';
import { ManagedPublicPage, managedMetadata } from '@/components/legal/managed-page';

/**
 * Contact and support. Business name, address, phone, email, grievance officer
 * and support wording are published content managed in Super Admin → Website
 * content, so no contact detail is hardcoded in the application.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return managedMetadata('contact', 'Contact and support');
}

export default function ContactPage() {
  return <ManagedPublicPage slug="contact" />;
}
