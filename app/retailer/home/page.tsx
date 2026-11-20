import { createClient } from '@/lib/supabase/server';
import { getRetailerShoppingContext } from '@/lib/retailer/shopping-context';
import { loadRetailerHome } from '@/lib/retailer/home-data';
import { homeServices } from '@/lib/retailer/home-services';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { HomeContent } from '@/components/retailer/home-content';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Wholesale shopping | ${BRAND.name}` };

export default async function RetailerHomePage() {
  const { user, retailer, areaName, profileUnavailable } = await getRetailerShoppingContext();
  const supabase = (await createClient());
  const [data, wallet, branding] = await Promise.all([
    loadRetailerHome(supabase, user.id, retailer?.area_id ?? null, process.env.NEXT_PUBLIC_SITE_URL, !!retailer && !profileUnavailable),
    retailer ? getRetailerWalletSummary(supabase, user.id).catch(() => null) : Promise.resolve(null),
    supabase.rpc("published_storefront_brand").returns<{ display_name: string; tagline: string }[]>(),
  ]);
  const services = homeServices({
    dispatch: process.env.COMPANY_DISPATCH_NOTE,
    deliveryEstimate: process.env.COMPANY_DELIVERY_ESTIMATE,
    gstin: process.env.COMPANY_GSTIN,
    supportPhone: process.env.COMPANY_PHONE,
    hasWholesalePrices: data.products.some((product) => product.fromPrice !== null),
  });

  return <HomeContent branding={branding.data?.[0]} data={data} retailerName={user.fullName} shopName={retailer?.shop_name}
    areaName={areaName} address={retailer?.address} profileUnavailable={profileUnavailable}
    wallet={wallet} services={services} />;
}
