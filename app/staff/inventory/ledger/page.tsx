import { StockLedgerList } from '@/components/inventory/stock-ledger-list';

export default async function StaffInventoryLedgerPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  return <StockLedgerList warehouseFilter={searchParams.warehouse ?? ''} permission="inventory.view" />;
}
