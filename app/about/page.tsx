import type { Metadata } from 'next';
import { ManagedPublicPage, managedMetadata } from '@/components/legal/managed-page';

/**
 * About Us. The whole page — heading, introduction, sections, images, buttons and
 * contact details — is published content managed in Super Admin → Website
 * content. Changing it needs no code change and no deploy.
 */
export const dynamic = 'force-dynamic';

export function generateMetadata(): Promise<Metadata> {
  return managedMetadata('about', 'About');
}

export default function AboutPage() {
  return <ManagedPublicPage slug="about" />;
}
