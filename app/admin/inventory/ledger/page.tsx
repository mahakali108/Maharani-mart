import { StockLedgerList } from '@/components/inventory/stock-ledger-list';

export default async function InventoryLedgerPage({
  searchParams,
}: {
  searchParams: { warehouse?: string };
}) {
  return <StockLedgerList warehouseFilter={searchParams.warehouse ?? ''} />;
}
