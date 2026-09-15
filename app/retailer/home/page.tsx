import { createClient } from '@/lib/supabase/server';
import { getRetailerShoppingContext } from '@/lib/retailer/shopping-context';
import { loadRetailerHome } from '@/lib/retailer/home-data';
import { homeServices } from '@/lib/retailer/home-services';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { HomeContent } from '@/components/retailer/home-content';

export const metadata = { title: 'Wholesale shopping | Maharani Traders' };

export default async function RetailerHomePage() {
  const { user, retailer, areaName, profileUnavailable } = await getRetailerShoppingContext();
  const supabase = createClient();
  const [data, wallet] = await Promise.all([
    loadRetailerHome(supabase, user.id, retailer?.area_id ?? null, process.env.NEXT_PUBLIC_SITE_URL, !!retailer && !profileUnavailable),
    retailer ? getRetailerWalletSummary(supabase, user.id).catch(() => null) : Promise.resolve(null),
  ]);
  const services = homeServices({
    dispatch: process.env.COMPANY_DISPATCH_NOTE,
    deliveryEstimate: process.env.COMPANY_DELIVERY_ESTIMATE,
    gstin: process.env.COMPANY_GSTIN,
    supportPhone: process.env.COMPANY_PHONE,
    hasWholesalePrices: data.products.some((product) => product.fromPrice !== null),
  });

  return <HomeContent data={data} retailerName={user.fullName} shopName={retailer?.shop_name}
    areaName={areaName} address={retailer?.address} profileUnavailable={profileUnavailable}
    wallet={wallet} services={services} />;
}
