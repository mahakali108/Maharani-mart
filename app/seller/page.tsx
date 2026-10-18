import { redirect } from 'next/navigation';
import { requireSellerPage } from '@/lib/seller/guard';

export default async function SellerRootPage() {
  await requireSellerPage();
  redirect('/seller/dashboard');
}
