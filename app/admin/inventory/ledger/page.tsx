import { StockLedgerList } from '@/components/inventory/stock-ledger-list';

export default async function InventoryLedgerPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  return <StockLedgerList warehouseFilter={searchParams.warehouse ?? ''} />;
}
